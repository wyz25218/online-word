import type { AuthResult, AwarenessUser } from '@online-word/shared'

/**
 * 鉴权服务（M0 桩实现）。
 * M1-T1.5 时替换为：调业务后端 GET /internal/docs/:id/membership + Redis 短 TTL 缓存。
 * 此处保留函数签名，避免 M0→M1 大改结构。
 */

const STUB_USER: AwarenessUser = {
  userId: 'm0-stub-user',
  name: 'M0 测试用户',
  color: '#2563eb',
  role: 'editor',
}

/**
 * 校验 token 并返回鉴权结论。
 * M0：有 token 即放行，固定返回 editor 权限的测试用户。
 */
export async function verifyToken(
  token: string | null | undefined,
  _documentName: string,
): Promise<AuthResult> {
  if (!token) {
    return { ok: false, permission: 'none', user: STUB_USER, ttlMs: 0 }
  }
  return { ok: true, permission: 'write', user: STUB_USER, ttlMs: 60_000 }
}
