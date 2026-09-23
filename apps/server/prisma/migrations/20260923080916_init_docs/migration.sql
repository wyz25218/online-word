-- CreateTable
CREATE TABLE "docs" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT '未命名文档',
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "current_version" BIGINT NOT NULL DEFAULT 0,
    "last_active_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_members" (
    "doc_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_members_pkey" PRIMARY KEY ("doc_id","user_id")
);

-- CreateIndex（按 docs/03 DDL：仅索引未删除文档的部分索引）
CREATE INDEX "idx_docs_owner" ON "docs"("owner_id") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "idx_doc_members_user" ON "doc_members"("user_id");

-- AddForeignKey
ALTER TABLE "doc_members" ADD CONSTRAINT "doc_members_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 角色枚举 CHECK（docs/03 DDL；Prisma schema 无法表达，写入迁移）
ALTER TABLE "doc_members" ADD CONSTRAINT "doc_members_role_check" CHECK ("role" IN ('owner','editor','commenter','viewer'));
