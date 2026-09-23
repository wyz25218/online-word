import { Injectable, NotFoundException } from '@nestjs/common'
import type { DocRole } from '@online-word/shared'
import { prisma } from '../prisma.js'
import { PermissionsService } from '../permissions/permissions.service.js'
import type { CreateDocInput, DocDetail, DocListResponse, DocSummary, ListDocsQuery, UpdateDocInput } from './docs.dto.js'

@Injectable()
export class DocsService {
  constructor(private readonly permissions: PermissionsService) {}

  /** 我的文档列表：按 doc_members 圈定可见范围，updatedAt 倒序 + 关键字过滤 */
  async list(userId: string, query: ListDocsQuery): Promise<DocListResponse> {
    const { page, pageSize, keyword } = query
    const where = {
      deletedAt: null,
      ...(keyword !== undefined && keyword !== '' ? { title: { contains: keyword, mode: 'insensitive' as const } } : {}),
      members: { some: { userId } },
    }
    const [rows, total] = await prisma.$transaction([
      prisma.doc.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { members: { where: { userId }, select: { role: true } } },
      }),
      prisma.doc.count({ where }),
    ])
    return {
      items: rows.map((doc) => this.toSummary(doc, doc.members[0]?.role)),
      total,
      page,
      pageSize,
    }
  }

  /**
   * 新建文档：事务内写 docs + doc_members(owner) + 空快照基线（docs/03 §3，
   * 保证外键存在、网关 onLoadDocument 永远能读到基线）。
   * 二进制表不走 Prisma 模型（账号权限隔离），用原生 SQL；ow_app 仅 doc_snapshots INSERT。
   * 空文档的 Yjs update 恒为两字节 0x00 0x00（= Y.encodeStateAsUpdate(new Y.Doc())）。
   * 注意 1：bytea 字面量 '\x0000' 会被 Prisma 7 的 SQL 编译器错误解析（协议报错
   * "insufficient data left in message"），必须用 decode('0000','hex') 表达。
   * 注意 2：带索引推断的 ON CONFLICT (doc_id) 要求 SELECT 权限（PG 冲突检查需读索引列），
   * ow_app 仅有 INSERT，故用无 arbiter 的 ON CONFLICT DO NOTHING（防御性场景语义等价）。
   */
  async create(userId: string, input: CreateDocInput): Promise<DocDetail> {
    const doc = await prisma.$transaction(async (tx) => {
      const created = await tx.doc.create({ data: { title: input.title, ownerId: userId } })
      await tx.docMember.create({ data: { docId: created.id, userId, role: 'owner' } })
      await tx.$executeRaw`
        INSERT INTO doc_snapshots (doc_id, version, state, size_bytes)
        VALUES (${created.id}::uuid, 0, decode('0000', 'hex'), 2)
        ON CONFLICT DO NOTHING`
      return created
    })
    return this.toDetail(doc, 'owner')
  }

  /** 详情：非成员/已删除统一 404，避免泄露存在性 */
  async getDetail(docId: string, userId: string): Promise<DocDetail> {
    const doc = await prisma.doc.findFirst({
      where: { id: docId, deletedAt: null },
    })
    if (doc === null) throw new NotFoundException('文档不存在或无权访问')
    const role = await this.permissions.getMemberRole(docId, userId)
    if (role === undefined) throw new NotFoundException('文档不存在或无权访问')
    return this.toDetail(doc, role)
  }

  /** 重命名（editor+）；updateMany 带 deletedAt 条件，软删除后的文档不可再改 */
  async rename(docId: string, userId: string, input: UpdateDocInput): Promise<DocDetail> {
    const result = await prisma.doc.updateMany({
      where: { id: docId, deletedAt: null },
      data: { title: input.title },
    })
    if (result.count === 0) throw new NotFoundException('文档不存在')
    return await this.getDetail(docId, userId)
  }

  /** 软删除（owner）：置 deletedAt，业务查询全部过滤 */
  async softDelete(docId: string): Promise<void> {
    const result = await prisma.doc.updateMany({
      where: { id: docId, deletedAt: null },
      data: { deletedAt: new Date() },
    })
    if (result.count === 0) throw new NotFoundException('文档不存在')
  }

  private toSummary(doc: { id: string; title: string; ownerId: string; createdAt: Date; updatedAt: Date }, role: string | undefined): DocSummary {
    return {
      id: doc.id,
      title: doc.title,
      ownerId: doc.ownerId,
      role: role ?? 'viewer',
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }
  }

  private toDetail(doc: { id: string; title: string; ownerId: string; createdAt: Date; updatedAt: Date; currentVersion: bigint; lastActiveAt: Date }, role: DocRole): DocDetail {
    return {
      ...this.toSummary(doc, role),
      currentVersion: doc.currentVersion.toString(),
      lastActiveAt: doc.lastActiveAt,
    }
  }
}
