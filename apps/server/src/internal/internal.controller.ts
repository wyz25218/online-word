import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { permissionOf, type AuthResult } from '@online-word/shared'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { PermissionsService } from '../permissions/permissions.service.js'
import { UsersService } from '../users/users.service.js'
import { InternalApiKeyGuard } from './internal-key.guard.js'
import { InternalDocIdSchema, InternalUserIdSchema } from './internal.dto.js'

/** 鉴权结论缓存 TTL（毫秒）：网关按此值设置 Redis 过期（docs/09 T1.5：60s） */
export const MEMBERSHIP_TTL_MS = 60_000

const FALLBACK_COLOR = '#8a8f99'

/** 无权访问结论（ttlMs=0，网关不缓存） */
function denyResult(userId: string): AuthResult {
  return {
    ok: false,
    permission: 'none',
    user: { userId, name: '未授权用户', color: FALLBACK_COLOR, role: 'viewer' },
    ttlMs: 0,
  }
}

/**
 * 服务间内部接口（x-internal-key 保护，禁止暴露给浏览器）。
 * 非成员返回 200 + ok:false：让网关能区分"业务上无权"（正常结论）与"服务异常"（非 200）。
 */
@UseGuards(InternalApiKeyGuard)
@Controller('internal')
export class InternalController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly users: UsersService,
  ) {}

  /** 网关验权：查用户在文档中的角色 → 映射网关写权限 */
  @Get('docs/:docId/membership')
  async membership(
    @Param('docId', new ZodValidationPipe(InternalDocIdSchema)) docId: string,
    @Query('userId', new ZodValidationPipe(InternalUserIdSchema)) userId: string,
  ): Promise<AuthResult> {
    const role = await this.permissions.getMemberRole(docId, userId)
    if (role === undefined) {
      console.log(`[internal] membership denied docId=${docId} userId=${userId}`)
      return denyResult(userId)
    }
    const user = this.users.findById(userId)
    console.log(`[internal] membership docId=${docId} userId=${userId} role=${role}`)
    return {
      ok: true,
      permission: permissionOf(role),
      user: {
        userId,
        name: user?.name ?? '未知用户',
        color: user?.color ?? FALLBACK_COLOR,
        role,
      },
      ttlMs: MEMBERSHIP_TTL_MS,
    }
  }
}
