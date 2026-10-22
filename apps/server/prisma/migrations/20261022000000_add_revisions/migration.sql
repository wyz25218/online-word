-- T2.4 doc_revisions 表（业务表，ow_app 账号）
-- 说明：同 attachments/comments，手写迁移 → db execute 应用 → migrate resolve 登记。

-- CreateTable
CREATE TABLE "doc_revisions" (
    "id" UUID NOT NULL,
    "doc_id" UUID NOT NULL,
    "state" BYTEA NOT NULL,
    "plain_text" TEXT,
    "word_count" INTEGER,
    "author_id" UUID,
    "label" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_revisions_doc_time" ON "doc_revisions"("doc_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "doc_revisions" ADD CONSTRAINT "doc_revisions_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
