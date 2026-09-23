import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import type { PublicUser } from '../users/users.service.js'

/** 取 JwtAuthGuard 挂载的当前用户（未经过 Guard 的路由使用会抛 401） */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PublicUser => {
    const req = ctx.switchToHttp().getRequest<{ authUser?: PublicUser }>()
    if (req.authUser === undefined) throw new UnauthorizedException('未认证')
    return req.authUser
  },
)
