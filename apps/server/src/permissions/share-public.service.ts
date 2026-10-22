import { randomUUID } from 'node:crypto'
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { colorForUser, type LinkShare } from '@online-word/shared'
import { AuthService } from '../auth/auth.service.js'
import { prisma } from '../prisma.js'
import { PermissionsService } from '../permissions/permissions.service.js'
import type { AnonymousShareResponse } from '../permissions/share-links.dto.js'

/**
 * 匿名分享公开端点业务逻辑（docs/09 T2.5）：
 * ① 按 token 查 share-link；不存在 → 404；private/org → 403
 * ② anyone_view/edit → 生成匿名身份（session 级 userId + 随机名 + 稳定取色）
 * ③ 签 collab JWT（sub='anon:<session>'，权限由 collab internal membership 接口按 mode 下发）
 */
@Injectable()
export class SharePublicService {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly auth: AuthService,
  ) {}

  /**
   * 匿名分享公开端点业务逻辑（docs/09 T2.5）：
   * ① 按 token 查 share-link；不存在 → 404；private/org → 403
   * ② anyone_view/edit → 生成匿名身份（session 级 userId + 随机名 + 稳定取色）
   * ③ 签 collab JWT（sub='anon:<session>'，权限由 collab internal membership 接口按 mode 下发）
   *
   * @param reuseAnonId 续签用：传入上一次返回的 anonymousUser.userId（'anon:<uuid>'），
   *   端点复用它签新 JWT，避免 awareness 用户在续签时跳变消失。首次访问不传时生成新身份。
   */
  async resolveAnonymous(token: string, reuseAnonId?: string): Promise<AnonymousShareResponse> {
    const link = await this.permissions.findByToken(token)
    if (link === undefined) {
      console.warn(`[share] anonymous attempt with invalid token=${token.slice(0, 8)}…`)
      throw new NotFoundException('分享链接无效或已失效')
    }
    if (link.mode === 'private' || link.mode === 'org') {
      console.warn(`[share] anonymous denied mode=${link.mode} doc=${link.docId}`)
      throw new ForbiddenException('该文档未开启公开分享')
    }

    const doc = await prisma.doc.findFirst({
      where: { id: link.docId, deletedAt: null },
      select: { title: true },
    })
    if (doc === null) throw new NotFoundException('文档不存在或已被删除')

    // 复用传入的 anonId（续签场景）；否则生成新 session 身份
    const anonymousId = (reuseAnonId !== undefined && reuseAnonId.startsWith('anon:'))
      ? reuseAnonId
      : `anon:${randomUUID()}`
    const displayName = `访客 ${anonymousId.slice(-4)}`
    const color = colorForUser(anonymousId)

    const collabToken = await this.auth.issueAnonymousCollabToken({
      anonymousId,
      docId: link.docId,
      displayName,
      linkToken: token,
    })

    const logPrefix = reuseAnonId !== undefined ? 'renewed' : 'granted'
    console.log(`[share] anonymous ${logPrefix} doc=${link.docId} mode=${link.mode} anonId=${anonymousId}`)
    return {
      docId: link.docId,
      docTitle: doc.title,
      mode: link.mode as LinkShare,
      anonymousUser: { userId: anonymousId, name: displayName, color },
      collabToken: collabToken.token,
      expiresIn: collabToken.expiresIn,
    }
  }
}
