import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common'

interface InternalRequest {
  headers: Record<string, string | string[] | undefined>
}

/**
 * 服务间调用鉴权：x-internal-key 必须与 INTERNAL_API_KEY 一致。
 * INTERNAL_API_KEY 未配置时恒拒绝（fail closed）。
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<InternalRequest>()
    const key = req.headers['x-internal-key']
    const expected = process.env.INTERNAL_API_KEY
    if (typeof key !== 'string' || expected === undefined || key !== expected) {
      throw new UnauthorizedException('invalid internal key')
    }
    return true
  }
}
