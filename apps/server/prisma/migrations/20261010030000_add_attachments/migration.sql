-- T2.1 attachments 表（业务表，ow_app 账号）
-- 说明：因 collab 二进制三表不在 Prisma 迁移链中，prisma migrate dev 会报 drift 并要求 reset（绝不可），
-- 故本迁移手工编写：db execute 应用 + migrate resolve 登记为已应用。

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "doc_id" UUID NOT NULL,
    "uploader_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attachments_object_key_key" ON "attachments"("object_key");

-- CreateIndex
CREATE INDEX "idx_attachments_doc" ON "attachments"("doc_id");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
