import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import type { DocRole } from '@online-word/shared'
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js'
import { requireRole } from '../permissions/doc-role.guard.js'
import { CommentsService } from './comments.service.js'
import type { CommentRow } from './comments.dto.js'

/**
 * 评论服务端视图（docs/06 §评论）：GET /docs/:id/comments（viewer+，unresolvedOnly 可选）。
 * 实时编辑视图来自 Y.Doc（web 端不经此接口）；本接口用于通知/未读数/跨文档检索。
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('docs/:id/comments')
  @requireRole('viewer' satisfies DocRole)
  async list(
    @Param('id') docId: string,
    @Query('unresolvedOnly') unresolvedOnly?: string,
  ): Promise<CommentRow[]> {
    return await this.comments.listThreads(docId, unresolvedOnly === 'true')
  }
}
