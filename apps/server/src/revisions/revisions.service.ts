import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { prisma } from '../prisma.js'
import { PermissionsService } from '../permissions/permissions.service.js'
import type {
  CreateRevisionInput,
  InternalRevisionPayload,
  RevisionDetail,
  RevisionSummary,
} from './revisions.dto.js'

/** revisions 列表/详情/保存/恢复（T2.4 版本历史） */
@Injectable()
export class RevisionsService {
  constructor(private readonly permissions: PermissionsService) {}

  /** 版本列表（viewer+，按 createdAt 倒序，不返回二进制 state） */
  async list(docId: string, userId: string): Promise<RevisionSummary[]> {
    const role = await this.permissions.getMemberRole(docId, userId)
    if (role === undefined) throw new NotFoundException('文档不存在或无权访问')

    const rows = await prisma.docRevision.findMany({
      where: { docId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        authorId: true,
        label: true,
        plainText: true,
        wordCount: true,
        createdAt: true,
      },
    })
    return rows.map((r) => ({
      id: r.id,
      authorId: r.authorId,
      label: r.label,
      plainText: r.plainText,
      wordCount: r.wordCount,
      createdAt: r.createdAt,
    }))
  }

  /**
   * 版本详情（viewer+）：返回 ProseMirror JSON 供只读预览。
   * 恢复时 owner 也从此端点或内部接口取内容。
   */
  async getDetail(docId: string, revId: string, userId: string): Promise<RevisionDetail> {
    const role = await this.permissions.getMemberRole(docId, userId)
    if (role === undefined) throw new NotFoundException('文档不存在或无权访问')

    const row = await prisma.docRevision.findUnique({ where: { id: revId } })
    if (row === null || row.docId !== docId) throw new NotFoundException('版本不存在')

    return {
      id: row.id,
      authorId: row.authorId,
      label: row.label,
      plainText: row.plainText,
      wordCount: row.wordCount,
      createdAt: row.createdAt,
      proseMirrorJson: row.proseMirrorJson ?? '',
    }
  }

  /**
   * 手动保存版本（client 驱动）：client 编码本地 Y.Doc 后 POST，
   * server 以 base64 → Buffer 存 state，JSON 存 proseMirrorJson。
   * editor+ 可手动保存（viewer/commenter 不允许产生 revision）。
   */
  async create(docId: string, userId: string, input: CreateRevisionInput): Promise<RevisionSummary> {
    const role = await this.permissions.getMemberRole(docId, userId)
    if (role === undefined) throw new NotFoundException('文档不存在或无权访问')
    if (role === 'viewer' || role === 'commenter') {
      throw new ForbiddenException('无权手动保存版本')
    }

    const stateBuf = new Uint8Array(Buffer.from(input.stateBase64, 'base64'))
    const revision = await prisma.docRevision.create({
      data: {
        docId,
        state: stateBuf,
        proseMirrorJson: input.proseMirrorJson,
        plainText: input.plainText ?? null,
        wordCount: input.wordCount ?? null,
        authorId: userId,
        label: input.label ?? null,
      },
      select: {
        id: true,
        authorId: true,
        label: true,
        plainText: true,
        wordCount: true,
        createdAt: true,
      },
    })
    console.log(`[revision] doc=${docId} userId=${userId} 手动保存 label=${input.label ?? '(无)'} revId=${revision.id}`)
    return revision
  }

  /**
   * collab 网关定时保存（内部接口调用，直接传 Buffer state）。
   * 内部接口调用方已由 InternalApiKeyGuard 保护，不再做成员检查。
   * authorId 为 null 表示系统自动保存；proseMirrorJson 可空（collab 无 Tiptap schema）。
   */
  async createFromCollab(
    docId: string,
    stateBuffer: Buffer,
    payload: InternalRevisionPayload,
  ): Promise<{ id: string }> {
    // Node 22 Buffer<ArrayBufferLike> 与 Prisma Bytes(Uint8Array<ArrayBuffer>) 类型不兼容
    // new Uint8Array(buf) 拷贝内容并返回 Uint8Array<ArrayBuffer>，类型语义精确（一次浅拷贝开销可忽略）
    const state = new Uint8Array(stateBuffer)
    const rev = await prisma.docRevision.create({
      data: {
        docId,
        state,
        proseMirrorJson: payload.proseMirrorJson ?? '',
        plainText: payload.plainText ?? null,
        wordCount: payload.wordCount ?? null,
        authorId: null,
        label: null,
      },
      select: { id: true },
    })
    console.log(`[revision] doc=${docId} 定时保存 bytes=${stateBuffer.byteLength} revId=${rev.id}`)
    return rev
  }

  /**
   * 恢复：仅 owner 可执行（docs/06 §2 权限表）。
   * client 驱动模式：返回 ProseMirror JSON 给 client，client 以
   * editor.commands.setContent(json, { emitUpdate: true }) 整体替换，
   * 经 y-prosemirror 广播为正常 Yjs update，所有在线人自然收敛。
   *
   * 零服务器侧 Yjs/prosemirror 依赖——server 只存二进制 + 透传 JSON。
   */
  async restore(docId: string, revId: string, userId: string): Promise<RevisionDetail> {
    const role = await this.permissions.getMemberRole(docId, userId)
    if (role === undefined) throw new NotFoundException('文档不存在或无权访问')
    if (role !== 'owner') {
      throw new ForbiddenException('仅文档拥有者可执行版本恢复')
    }
    return await this.getDetail(docId, revId, userId)
  }

  /** 内部接口用：取 revision 的 state Buffer（collab 网关需要完整 Y.Doc 状态做内部处理） */
  async getStateBuffer(docId: string, revId: string): Promise<Buffer | null> {
    const row = await prisma.docRevision.findUnique({ where: { id: revId } })
    if (row === null || row.docId !== docId) return null
    return Buffer.from(row.state)
  }
}
