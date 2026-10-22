import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put, UseGuards } from '@nestjs/common'
import type { DocRole } from '@online-word/shared'
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { requireRole } from './doc-role.guard.js'
import { PermissionsService } from './permissions.service.js'
import { UpdateShareLinkSchema, type UpdateShareLinkInput } from './share-links.dto.js'

/**
 * 分享与链接（docs/06 §2 权限与分享）：owner 专属。
 * 匿名访问入口见 AnonymousShareController（公开 GET /share/:token）。
 */
@Controller('docs/:id/share-link')
@UseGuards(JwtAuthGuard)
export class ShareLinksController {
  constructor(private readonly permissions: PermissionsService) {}

  /** 查看当前分享模式 + token */
  @Get()
  @requireRole('owner' satisfies DocRole)
  async get(@Param('id') docId: string) {
    return await this.permissions.getShareLink(docId)
  }

  /** 更新分享模式（切到 anyone_view/edit 时自动生成/保留 token；resetToken=true 强制换新） */
  @Put()
  @requireRole('owner' satisfies DocRole)
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') docId: string,
    @Body(new ZodValidationPipe(UpdateShareLinkSchema)) dto: UpdateShareLinkInput,
  ) {
    return await this.permissions.setShareLink(docId, dto.mode, { resetToken: dto.resetToken })
  }
}
