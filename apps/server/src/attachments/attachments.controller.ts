import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common'
import type { DocRole } from '@online-word/shared'
import { CurrentUser } from '../auth/current-user.decorator.js'
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { requireRole } from '../permissions/doc-role.guard.js'
import { AttachmentsService } from './attachments.service.js'
import {
  RegisterAttachmentSchema,
  SignUploadSchema,
  type AttachmentItem,
  type RegisterAttachmentInput,
  type SignUploadInput,
  type SignUploadResponse,
} from './attachments.dto.js'

/**
 * 附件上传（docs/06 §2 附件）：
 * - POST /upload/sign             签名直传 URL（仅登录；白名单类型；不绑定文档）
 * - POST /docs/:id/attachments    直传完成登记（editor+；HEAD 校验对象存在）
 * - GET  /docs/:id/attachments    附件列表（viewer+）
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post('upload/sign')
  @HttpCode(HttpStatus.CREATED)
  async sign(
    @Body(new ZodValidationPipe(SignUploadSchema)) dto: SignUploadInput,
  ): Promise<SignUploadResponse> {
    return await this.attachments.sign(dto)
  }

  @Post('docs/:id/attachments')
  @requireRole('editor' satisfies DocRole)
  @HttpCode(HttpStatus.CREATED)
  async register(
    @CurrentUser() user: { userId: string },
    @Param('id') docId: string,
    @Body(new ZodValidationPipe(RegisterAttachmentSchema)) dto: RegisterAttachmentInput,
  ): Promise<AttachmentItem> {
    return await this.attachments.register(docId, user.userId, dto)
  }

  @Get('docs/:id/attachments')
  async list(@Param('id') docId: string): Promise<AttachmentItem[]> {
    return await this.attachments.list(docId)
  }
}
