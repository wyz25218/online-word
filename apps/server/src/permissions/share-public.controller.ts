import { Controller, Get, Param, Query } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SharePublicService } from './share-public.service.js'

/**
 * 匿名分享公开入口（docs/06 §2 / docs/09 T2.5）：
 * - 不走 JwtAuthGuard（公开端点），校验仅靠 share-link token
 * - GET /share/:token → 返回文档标题 + 匿名身份 + collab JWT，前端据此挂载只读/可写编辑器
 * - token 无效 / 文档已删 / 模式切回私有 → 404 / 403
 * - ?anonId=xxx 可选参数（续签用）：传入上一次返回的 anonymousUser.userId，
 *   端点复用它签新 JWT，避免 awareness 用户跳变
 */
@Controller('share')
export class AnonymousShareController {
  constructor(private readonly service: SharePublicService) {}

  @Get(':token')
  async resolve(
    @Param('token', new ZodValidationPipe(z.string().min(8).max(128))) token: string,
    @Query('anonId', new ZodValidationPipe(z.string().min(37).max(80).optional())) anonId?: string,
  ) {
    return await this.service.resolveAnonymous(token, anonId)
  }
}
