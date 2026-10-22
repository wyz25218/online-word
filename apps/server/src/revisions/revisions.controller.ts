import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common'
import type { DocRole } from '@online-word/shared'
import { CurrentUser } from '../auth/current-user.decorator.js'
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { requireRole } from '../permissions/doc-role.guard.js'
import { RevisionsService } from './revisions.service.js'
import { CreateRevisionSchema, type CreateRevisionInput, type RevisionDetail, type RevisionSummary } from './revisions.dto.js'

/**
 * 版本历史（docs/06 §2 版本，T2.4）：
 * - GET    /docs/:id/revisions              版本列表（viewer+，不含二进制 state）
 * - POST   /docs/:id/revisions              手动保存版本（editor+，client 编码 Y.Doc 后 POST）
 * - GET    /docs/:id/revisions/:revId       版本详情（viewer+，含 ProseMirror JSON 供只读预览）
 * - POST   /docs/:id/revisions/:revId/restore  恢复（owner 专属，返回 ProseMirror JSON 供 client 驱动 setContent）
 *
 * 恢复为 client 驱动：拿到 JSON → setContent({ emitUpdate: true }) → 自然广播收敛，
 * 服务器侧零 Yjs / prosemirror 依赖。
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class RevisionsController {
  constructor(private readonly revisions: RevisionsService) {}

  @Get('docs/:id/revisions')
  async list(
    @CurrentUser() user: { userId: string },
    @Param('id') docId: string,
  ): Promise<RevisionSummary[]> {
    return await this.revisions.list(docId, user.userId)
  }

  @Post('docs/:id/revisions')
  @requireRole('editor' satisfies DocRole)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: { userId: string },
    @Param('id') docId: string,
    @Body(new ZodValidationPipe(CreateRevisionSchema)) dto: CreateRevisionInput,
  ): Promise<RevisionSummary> {
    return await this.revisions.create(docId, user.userId, dto)
  }

  @Get('docs/:id/revisions/:revId')
  async detail(
    @CurrentUser() user: { userId: string },
    @Param('id') docId: string,
    @Param('revId') revId: string,
  ): Promise<RevisionDetail> {
    return await this.revisions.getDetail(docId, revId, user.userId)
  }

  @Post('docs/:id/revisions/:revId/restore')
  @requireRole('owner' satisfies DocRole)
  async restore(
    @CurrentUser() user: { userId: string },
    @Param('id') docId: string,
    @Param('revId') revId: string,
  ): Promise<RevisionDetail> {
    return await this.revisions.restore(docId, revId, user.userId)
  }
}
