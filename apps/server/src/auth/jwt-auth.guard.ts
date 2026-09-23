import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { UsersService, type PublicUser } from '../users/users.service.js'
import { AuthService } from './auth.service.js'

/** 鉴权成功后由 Guard 挂载当前用户（避免依赖 express 类型，保持最小类型面） */
interface AuthedRequest {
  headers: { authorization?: string }
  authUser?: PublicUser
}

/** Bearer access token 校验：解析成功后将 PublicUser 挂到 req.authUser（配合 @CurrentUser） */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>()
    const header = req.headers.authorization
    if (header === undefined || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少 Bearer token')
    }
    const claims = await this.auth.verifyAccess(header.slice(7))
    const user = this.users.findById(claims.sub)
    if (user === undefined) throw new UnauthorizedException('用户不存在')
    req.authUser = this.users.toPublic(user)
    return true
  }
}
