# 01 · 总体架构

## 1. 四条架构铁律（不可违背）

1. **协作文档主干必须是 `Y.XmlFragment`**
   Tiptap 的 `@tiptap/extension-collaboration` 经 y-prosemirror 将 ProseMirror 文档映射到 `Y.XmlFragment`。禁止自行设计 `Y.Map/Y.Array/Y.Text` 文档树作为编辑器数据源，否则远程光标、选区、节点同步无法复用官方绑定。业务需要的"块表/索引"只能作为**从文档树派生的只读索引**存在。

2. **单一写入口**
   - 协作网关（Hocuspocus）：只写 `doc_snapshots`、`doc_updates` 两类二进制表。
   - 业务后端（NestJS）：写所有业务表（docs、权限、评论冗余、修订元数据等）。
   - 评论线程等随文档同步的业务数据，由网关在持久化 update 时**抽取并经业务后端 API 回写**，网关不获得业务表写权限。

3. **持久化只做增量追加 + 阈值压缩，禁止定时全量覆盖**
   每次 `update` 事件落一行增量二进制；达到阈值（增量条数/字节数/房间关闭）才在锁+事务内做 snapshot 压缩。

4. **Y.Doc 不是业务查询源**
   列表、搜索、统计、未读评论数一律查业务库/索引库；需要的文本与元数据在持久化链路上一次性抽取，不在查询时解析二进制文档。

---

## 2. 系统拓扑

```
┌──────────────────────────────────────────────────────────────┐
│ 浏览器（apps/web，React SPA）                                 │
│                                                              │
│  Tiptap v3 (ProseMirror)                                     │
│    └─ @tiptap/extension-collaboration ←→ Y.Doc (XmlFragment) │
│    └─ collaboration-cursor / awareness（远程光标、在线用户）  │
│  y-indexeddb（本地缓存：秒开 + 离线编辑）                     │
│  @hocuspocus/provider（自动重连/鉴权）                        │
└──────────────┬───────────────────────────┬───────────────────┘
               │ HTTPS（REST）              │ WSS（y-protocols）
┌──────────────▼──────────────┐  ┌─────────▼─────────────────────┐
│ 业务后端 apps/server         │  │ 协作网关 apps/collab           │
│ NestJS + Prisma             │  │ @hocuspocus/server（多实例）   │
│ 文档CRUD/权限/评论/分享/     │◄─┤ onAuthenticate（内部接口验权） │
│ 通知/导入导出/上传签名       │  │ Redis Pub/Sub 跨实例广播       │
└──────────┬──────────────────┘  │ 分布式锁 → 增量追加/快照压缩   │
           │                     └──────────┬─────────────────────┘
           │ HTTP（仅内部）                  │
           ▼                                ▼
┌──────────────────────────────────────────────────────────────┐
│ PostgreSQL                Redis                 MinIO/S3      │
│ 业务表 + doc_snapshots    缓存/PubSub/锁        图片附件       │
│ + doc_updates + 全文索引                                    │
└──────────────────────────────────────────────────────────────┘
           ▲
           │ 可选：Meilisearch（中文全文检索，M3）
┌──────────┴───────────────────────────────────────────────────┐
│ 转换服务（M2）：LibreOffice headless / Pandoc（docx 导入导出） │
└──────────────────────────────────────────────────────────────┘
```

### 为什么协作网关独立成进程
- WebSocket 长连接吃内存，生命周期与 HTTP 请求完全不同。
- 扩缩容指标不同（按连接数 vs 按 QPS）。
- 网关无状态化后可水平扩展，重启/发布不影响业务后端。

---

## 3. 三个应用的职责边界

| 能力 | apps/web（React） | apps/collab（网关） | apps/server（业务后端） |
|---|---|---|---|
| 渲染/编辑文档 | ✅ 唯一执行处 | ❌ | ❌ |
| CRDT 合并 | ✅ 本地合并 | 只转发，不解释语义 | ❌ |
| WebSocket 连接管理 | 作为 client | ✅ | ❌ |
| 连接鉴权 | 携带 JWT | ✅ 校验（调 server） | 提供内部验权接口 |
| 二进制增量落库 | ❌ | ✅ 唯一写入方 | ❌ |
| 快照压缩 | ❌ | ✅ 调度执行 | ❌ |
| 文档/权限/评论业务表 | 调用 API | ❌ 不直写 | ✅ 唯一写入方 |
| 附件上传 | 签名直传 MinIO | ❌ | 发签名 |
| 导入导出 | 发起请求 | ❌ | ✅ 调度转换服务 |
| 在线 Presence | 发/收 awareness | ✅ 房间内广播（不落库） | ❌ |
| 踢人/中途降权 | 处理断连 | ✅ 收指令断连 | ✅ 经 Redis 发指令 |

---

## 4. 关键数据流

### 4.1 编辑写入流（在线）
```
用户键入
 → ProseMirror Transaction
 → y-prosemirror 映射为 Yjs update（二进制）
 → HocuspocusProvider 经 WSS 发出
 → 网关 onAuthenticate 已通过 → 房间内广播（含 Redis 跨实例）
 → 各客户端 Y.Doc 合并（CRDT 保证收敛）→ 视图更新
 → 网关 onChange：追加写入 doc_updates（分布式锁保护）
 → （异步）抽取纯文本/评论线程 → 调业务后端 API 更新索引/冗余表
```

### 4.2 新加入/重连读取流
```
客户端连接房间
 → 网关 onLoadDocument：
     取 doc_snapshots.state（最新快照）
     + 取 doc_updates 中 version > 快照点的全部增量
     依次 Y.applyUpdate 合并到内存 Y.Doc
 → 走 y-protocols sync（状态向量差分），只下发客户端缺失部分
 → awareness 状态互换，展示在线用户
```

### 4.3 离线编辑流
```
断网期间：本地编辑写入 Y.Doc（继续）→ y-indexeddb 持久化
重连：provider 自动重连 → sync 协议交换状态向量
     → 离线 update 与服务端 update 在客户端/服务端双向合并（CRDT 可交换）
     → 收敛后正常落库
注意：撤销栈按 origin 隔离，离线期间 undo 不会撤销他人操作
```

### 4.4 权限变更流（编辑中途降权）
```
owner 在 server 把 A 降为 viewer
 → server 写业务表 → Redis PUBLISH collab:kick:{docId} {userId, socketIds?}
 → 持有该房间的网关实例收到 → 关闭 A 的连接
 → A 的前端收到连接关闭/鉴权失败事件 → editor.setEditable(false) + 提示
双保险：即使 A 的某条 update 在断连前到达，网关在 onChange 前再次校验上下文角色
```

---

## 5. 部署形态

| 环境 | 形态 |
|---|---|
| 本地开发 | docker-compose：PostgreSQL + Redis + MinIO；三个 app 分别 `pnpm dev` |
| 测试/生产 | web 静态资源走 CDN；server 与 collab 容器化（K8s 或 Docker 编排）；collab 按连接数 HPA |
| 端口约定（dev） | web 5173 / server 3000 / collab 8080；网关路径经反向代理统一为 `/collab` 域名 |

详见 [08-quality-ops.md](./08-quality-ops.md) 部署章节。
