import { Body, Controller, Get, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common'
import { UsersService } from '../users/users.service.js'
import { CurrentUser } from './current-user.decorator.js'
import { AuthService } from './auth.service.js'
import { DocIdSchema, LoginSchema, RefreshSchema, type CollabTokenResponse, type LoginResponse, type LoginInput, type RefreshInput } from './auth.dto.js'
import { JwtAuthGuard } from './jwt-auth.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'

/**
 * 认证相关接口（docs/06 §2 认证 + §3 JWT 细节）：
 * - POST /auth/login      桩用户表校验 → 签发 access(15min)/refresh(7d)
 * - POST /auth/refresh    刷新令牌
 * - GET  /collab/token    换取绑定 docId 的一次性 WS token（5min、jti）
 */
@Controller()
export class AuthController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @Post('auth/login')
  async login(@Body(new ZodValidationPipe(LoginSchema)) dto: LoginInput): Promise<LoginResponse> {
    const user = this.users.verifyCredentials(dto.username, dto.password)
    if (user === undefined) throw new UnauthorizedException('用户名或密码错误')
    return await this.auth.issueTokens(user)
  }

  @Post('auth/refresh')
  async refresh(@Body(new ZodValidationPipe(RefreshSchema)) dto: RefreshInput): Promise<LoginResponse> {
    return await this.auth.rotateRefresh(dto)
  }

  @UseGuards(JwtAuthGuard)
  @Get('collab/token')
  async collabToken(
    @CurrentUser() user: { userId: string; name: string; color: string },
    @Query('docId', new ZodValidationPipe(DocIdSchema)) docId: string,
  ): Promise<CollabTokenResponse> {
    return await this.auth.issueCollabToken(user, docId)
  }
}
