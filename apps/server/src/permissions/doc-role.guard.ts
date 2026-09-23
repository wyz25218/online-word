import {
  applyDecorators,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
  UseGuards,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { roleAtLeast, type DocRole } from '@online-word/shared'
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import type { PublicUser } from '../users/users.service.js'
import { PermissionsService } from './permissions.service.js'

const ROLE_KEY = 'minDocRole'

interface DocScopedRequest {
  params: { id?: string }
  authUser?: PublicUser
}

/**
 * 文档角色 Guard：读取路由 :id 与当前用户，查 doc_members 判定角色。
 * - 非成员 → 404（不泄露文档存在性）
 * - 角色不足 → 403
 */
@Injectable()
export class DocRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const minRole = this.reflector.get<DocRole>(ROLE_KEY, context.getHandler())
    if (minRole === undefined) return true

    const req = context.switchToHttp().getRequest<DocScopedRequest>()
    const docId = req.params.id
    const user = req.authUser
    if (docId === undefined || user === undefined) {
      throw new NotFoundException('文档不存在或无权访问')
    }

    const role = await this.permissions.getMemberRole(docId, user.userId)
    if (role === undefined) throw new NotFoundException('文档不存在或无权访问')
    if (!roleAtLeast(role, minRole)) throw new ForbiddenException(`需要 ${minRole} 及以上权限`)
    return true
  }
}

/**
 * 文档级权限装饰器：@requireRole(DocRole.Editor)。
 * 必须配合 JwtAuthGuard 使用（依赖 req.authUser）。
 */
export function requireRole(minRole: DocRole): MethodDecorator & ClassDecorator {
  return applyDecorators(UseGuards(DocRoleGuard), SetMetadata(ROLE_KEY, minRole))
}
