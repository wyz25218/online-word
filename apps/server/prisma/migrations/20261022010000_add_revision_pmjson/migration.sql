-- T2.4 补充迁移：doc_revisions 增加 prose_mirror_json 列
-- 原因：初版迁移漏加，作为独立 ALTER TABLE 追加。
ALTER TABLE "doc_revisions" ADD COLUMN "prose_mirror_json" TEXT NOT NULL DEFAULT '';
