-- T2.3：评论冗余表（docs/03 §2 DDL；权威数据在 Y.Doc comments 命名空间，
-- 由 collab 网关经内部接口抽取回写，仅供跨文档查询/通知/未读数）
CREATE TABLE comments (
  id          UUID PRIMARY KEY,                     -- Y 侧评论 id（线程 id = 首评 id），upsert 幂等依据
  doc_id      UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  thread_id   UUID NOT NULL,
  author_id   UUID NOT NULL,
  body        TEXT NOT NULL,
  resolved    BOOLEAN NOT NULL DEFAULT false,       -- 线程级状态冗余到该线程每行
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_doc ON comments(doc_id, created_at);
CREATE INDEX idx_comments_unread ON comments(doc_id) WHERE resolved = false;
