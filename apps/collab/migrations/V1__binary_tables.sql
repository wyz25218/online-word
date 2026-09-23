-- T1.3 协同二进制表（docs/03 §2 DDL 节选）
--
-- 职责划分：
--   - 本迁移由 PostgreSQL 超级用户执行（表上有指向 docs 的外键，需 REFERENCES 权限）；
--     Prisma 迁移（ow_app）不管理这些表，schema.prisma 不得出现对应 model。
--   - collab 网关用最小权限账号 ow_collab：仅以下三张表的 DML。
--   - 业务后端 ow_app 仅获 doc_snapshots 的 INSERT，用于"新建文档"事务写入空快照基线。
--
-- 应用方式：
--   psql "postgresql://postgres:<密码>@localhost:5432/online_word" -f apps/collab/migrations/V1__binary_tables.sql

CREATE TABLE IF NOT EXISTS doc_snapshots (
  doc_id     UUID PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  version    BIGINT NOT NULL,                      -- 快照合并到的最新 update version
  state      BYTEA NOT NULL,                       -- Y.encodeStateAsUpdate 结果
  size_bytes INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS doc_updates (
  id         BIGSERIAL PRIMARY KEY,
  doc_id     UUID NOT NULL,
  version    BIGINT NOT NULL,                      -- 房间维度单调递增
  update     BYTEA NOT NULL,
  client_id  BIGINT,                               -- Yjs clientID，排障用
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doc_id, version)                         -- 幂等：重复追加直接冲突拒绝
);
CREATE INDEX IF NOT EXISTS idx_updates_doc_version ON doc_updates(doc_id, version);

-- 房间级版本水位（写入事务内 FOR UPDATE 行锁串行化）
CREATE TABLE IF NOT EXISTS doc_sync_cursors (
  doc_id        UUID PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  next_version  BIGINT NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 权限收敛（幂等）
GRANT SELECT, INSERT, UPDATE, DELETE ON doc_snapshots, doc_updates, doc_sync_cursors TO ow_collab;
GRANT USAGE, SELECT ON SEQUENCE doc_updates_id_seq TO ow_collab;
GRANT INSERT ON doc_snapshots TO ow_app;
