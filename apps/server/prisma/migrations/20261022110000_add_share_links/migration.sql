-- T2.5 分享与链接：docs/03 §2 DDL
CREATE TABLE IF NOT EXISTS doc_share_links (
  doc_id      UUID PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL DEFAULT 'private'
              CHECK (mode IN ('private','org','anyone_view','anyone_edit')),
  token       TEXT UNIQUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
