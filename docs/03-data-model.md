# 03 · 数据模型与持久化

## 1. 存储职责划分

| 存储 | 内容 | 写入方（唯一） |
|---|---|---|
| PostgreSQL 业务表 | 文档元数据、成员权限、评论冗余、附件元数据、修订记录 | apps/server |
| PostgreSQL 二进制表 | `doc_snapshots` / `doc_updates`（Yjs 状态） | apps/collab（锁+事务） |
| Redis | 验权缓存、分布式锁、房间 Pub/Sub、presence 临时态 | collab / server 各按约定 key |
| MinIO/S3 | 图片、附件原始文件 | 客户端签名直传 |
| 浏览器 IndexedDB | Y.Doc 本地副本 | y-indexeddb |

---

## 2. PostgreSQL DDL

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========== 业务表（仅 apps/server 可写） ==========
CREATE TABLE docs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           TEXT NOT NULL DEFAULT '未命名文档',
  owner_id        UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,                       -- 软删除
  current_version BIGINT NOT NULL DEFAULT 0,         -- 最新快照点版本（由 collab 经内部接口回写）
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_docs_owner ON docs(owner_id) WHERE deleted_at IS NULL;

CREATE TABLE doc_members (
  doc_id   UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  user_id  UUID NOT NULL,
  role     TEXT NOT NULL CHECK (role IN ('owner','editor','commenter','viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_id, user_id)
);
CREATE INDEX idx_doc_members_user ON doc_members(user_id);

CREATE TABLE doc_share_links (
  doc_id      UUID PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL DEFAULT 'private'
              CHECK (mode IN ('private','org','anyone_view','anyone_edit')),
  token       TEXT UNIQUE,                          -- 可预测性低的随机 token
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE attachments (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  doc_id     UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  uploader_id UUID NOT NULL,
  object_key TEXT NOT NULL,                        -- MinIO/S3 key
  mime_type  TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE comments (                            -- 从 Y.Doc 抽取的冗余，供跨文档查询/通知
  id          UUID PRIMARY KEY,
  doc_id      UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  thread_id   UUID NOT NULL,
  author_id   UUID NOT NULL,
  body        TEXT NOT NULL,
  resolved    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_doc ON comments(doc_id, created_at);
CREATE INDEX idx_comments_unread ON comments(doc_id) WHERE resolved = false;

CREATE TABLE doc_revisions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  doc_id     UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  state      BYTEA NOT NULL,                       -- 该时刻的 Y.Doc 完整状态
  plain_text TEXT,
  word_count INT,
  author_id  UUID,                                 -- 手动保存时的操作人；定时保存为空
  label      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_revisions_doc_time ON doc_revisions(doc_id, created_at DESC);

-- ========== 协同二进制表（仅 apps/collab 可写） ==========
CREATE TABLE doc_snapshots (
  doc_id     UUID PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  version    BIGINT NOT NULL,                      -- 快照合并到的最新 update version
  state      BYTEA NOT NULL,                       -- Y.encodeStateAsUpdate 结果
  size_bytes INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE doc_updates (
  id         BIGSERIAL PRIMARY KEY,
  doc_id     UUID NOT NULL,
  version    BIGINT NOT NULL,                      -- 房间维度单调递增
  update     BYTEA NOT NULL,
  client_id  BIGINT,                               -- Yjs clientID，排障用
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doc_id, version)                         -- 幂等：重复追加直接冲突拒绝
);
CREATE INDEX idx_updates_doc_version ON doc_updates(doc_id, version);

-- 房间级版本水位（独立连接事务外更新，也可放 Redis；PG 实现以行为准）
CREATE TABLE doc_sync_cursors (
  doc_id        UUID PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  next_version  BIGINT NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

> Prisma 中二进制字段用 `Bytes`。应用侧访问这两张表走独立的最小 client（`prisma.collab` 数据源配置），与业务 Prisma client 物理隔离，便于权限收敛（数据库账号只授这两张表的 SELECT/INSERT/UPDATE/DELETE）。

---

## 3. 读取协议：onLoadDocument

```
1. SELECT state, version FROM doc_snapshots WHERE doc_id = $1
2. SELECT update FROM doc_updates
   WHERE doc_id = $1 AND version > $snapshotVersion
   ORDER BY version ASC
3. 新建内存 Y.Doc：
   - 有快照 → Y.applyUpdate(doc, snapshot)
   - 依次 applyUpdate 各增量（数量通常已被压缩控制在阈值内）
4. 将 doc 交给 Hocuspocus 房间；与客户端的实际差异由 y 同步协议（状态向量）处理
```

首次打开的新文档：由业务后端"新建文档"事务中插入一条空文档初始快照，保证外键存在、网关永远读到基线。

---

## 4. 写入协议：onChange 增量追加（幂等）

```
对每次 change 的 update：
1. 取 Redis 分布式锁 lock:doc:{docId}（阻塞等待上限 2s，租期 10s 自动续期）
2. SELECT next_version FROM doc_sync_cursors ... FOR UPDATE
3. INSERT INTO doc_updates(doc_id, version, update, client_id)
   VALUES ($1, $next_version, $2, $3)
   —— UNIQUE(doc_id, version) 兜底，重复提交不产生脏数据
4. 水位 +1 后更新游标，提交事务，释放锁
5. 失败重试最多 3 次；仍失败则记录告警并强制房间只读（防止静默丢更新）
```

为什么不靠"只在 onStoreDocument 落库"：Hocuspocus 的 store 是防抖触发，进程崩溃会丢失最后一个防抖窗口内的所有编辑。**onChange 追加是数据安全底线**，onStoreDocument 只负责触发压缩。

---

## 5. 快照压缩（compaction）

触发条件（满足任一）：
- 自上次快照后增量条数 ≥ 200（M0 先用 100 便于观察）
- 增量总字节 ≥ 2 MB
- 房间内最后一个连接关闭（onDestroy）
- 定时任务扫描"无人房间但积压未压缩"（兜底，每 5 分钟）

压缩过程（必须在同一事务 + 分布式锁内）：
```
1. 加锁 lock:doc:compact:{docId}（与追加锁互斥）
2. 从房间内存 Y.Doc 计算 state = Y.encodeStateAsUpdate(doc)
   —— 保证 GC 开启（Y.Doc gc: true，默认值），删除内容可被回收
3. INSERT/UPSERT doc_snapshots(state, version=当前水位)
4. DELETE FROM doc_updates WHERE doc_id=$1 AND version <= $水位
5. 经内部接口通知 server 更新 docs.current_version / updated_at / last_active_at
6. 提交事务 → 释放锁
```

监控阈值与告警：
- 单文档快照 > 5MB：告警，排查是否误把大对象写入文档
- 单房间积压增量 > 1000 条：压缩任务可能卡死，告警
- onLoadDocument 回放耗时 > 500ms：告警

---

## 6. 历史版本（doc_revisions）与全文索引

- **生成时机**：手动"保存版本"；以及定时任务（每 10 分钟，仅有变更时）每个活跃文档落一条。
- **生成方式**：在网关侧对房间内存 Y.Doc `encodeStateAsUpdate` 后投递到 server（内部接口），server 用 prosemirror JSON 抽纯文本与字数（转换在 server 端复用 shared 的 schema 定义）。
- **全文检索**：
  - M2：PostgreSQL `tsvector` + zhparser（中文分词），更新随 revision 一起写入 `docs.search_tsv`。
  - M3（可选增强）：Meilisearch，索引字段 docId/title/plainText/updatedAt，权限过滤在查询侧二次校验。
- **恢复**：见 [04-collab-core.md](./04-collab-core.md) 第 7 节，禁止"清空重建 Y.Doc"。

---

## 7. 绝不进入 Y.Doc 的数据

| 数据 | 存放位置 |
|---|---|
| 图片/附件二进制 | MinIO/S3；文档节点仅存 `{ attachmentId, url, width, height }` |
| 用户权限、角色 | 业务库 + 网关连接上下文 |
| Presence（光标位置、选区、瞬时状态） | awareness 通道，不落库、不进 Y.Doc |
| 评论"未读状态"等用户维度状态 | 业务库 |
| 密码、密钥等敏感信息 | 任何文档体系内均禁止出现 |
