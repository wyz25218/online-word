import { jwtVerify, type JWTPayload } from 'jose'
import type { AuthResult } from '@online-word/shared'
import { redis } from './redis.client.js'
import { INTERNAL_API_KEY, INTERNAL_URL } from './env.js'

/**
 * 鉴权服务（M1-T1.5 真实实现，docs/09 T1.5）：
 * 1. 本地验签 WS token（HS256，JWT_COLLAB_SECRET 与 server 共享）：
 *    要求 use=collab 且 docId 与房间绑定，exp 由 jose 自动校验。
 * 2. 调业务后端 GET /internal/docs/:docId/membership 查角色 → 映射网关写权限。
 * 3. Redis 缓存放行结论（TTL 用 server 下发的 ttlMs，60s）；拒绝结论不缓存，
 *    管理员加成员后立即可连。
 * 4. 后端不可达时保守拒绝（fail closed）；Redis 不可用则降级直查后端（缓存是优化不是依赖）。
 */

function requireEnv(key: string): string {
  const value = process.env[key]
  if (value === undefined || value === '') {
    throw new Error(`环境变量 ${key} 未配置（检查 apps/collab/.env）`)
  }
  return value
}

const collabSecret = new TextEncoder().encode(requireEnv('JWT_COLLAB_SECRET'))
const MEMBERSHIP_TIMEOUT_MS = 3_000

interface CollabClaims extends JWTPayload {
  use: 'collab'
  sub: string
  docId: string
  jti: string
}

/** 拒绝结论的占位 user（AuthResult 契约要求 user 必填；网关拒绝后不会进入连接上下文） */
const DENIED: AuthResult = {
  ok: false,
  permission: 'none',
  user: { userId: '', name: '未授权用户', color: '#8a8f99', role: 'viewer' },
  ttlMs: 0,
}

function membershipCacheKey(docId: string, userId: string): string {
  return `collab:membership:${docId}:${userId}`
}

async function fetchMembership(docId: string, userId: string): Promise<AuthResult> {
  const res = await fetch(
    `${INTERNAL_URL}/internal/docs/${docId}/membership?userId=${encodeURIComponent(userId)}`,
    {
      headers: { 'x-internal-key': INTERNAL_API_KEY },
      signal: AbortSignal.timeout(MEMBERSHIP_TIMEOUT_MS),
    },
  )
  if (!res.ok) throw new Error(`membership 接口返回 ${res.status}`)
  return (await res.json()) as AuthResult
}

async function getMembershipCached(docId: string, userId: string): Promise<AuthResult> {
  const key = membershipCacheKey(docId, userId)
  const cached = await redis.get(key).catch((err: unknown) => {
    console.warn(`[auth] Redis 缓存读取失败，降级直查后端:`, err instanceof Error ? err.message : err)
    return null
  })
  if (cached !== null) return JSON.parse(cached) as AuthResult

  const result = await fetchMembership(docId, userId)
  if (result.ok && result.ttlMs > 0) {
    await redis.set(key, JSON.stringify(result), 'PX', result.ttlMs).catch(() => {})
  }
  return result
}

/**
 * 校验 WS token 并返回鉴权结论。
 * 签名/有效期/绑定关系任一不满足、或后端不可达 → 一律拒绝（ok:false）。
 */
export async function verifyToken(
  token: string | null | undefined,
  documentName: string,
): Promise<AuthResult> {
  if (!token) return DENIED

  let claims: CollabClaims
  try {
    const verified = await jwtVerify(token, collabSecret, { algorithms: ['HS256'] })
    claims = verified.payload as CollabClaims
  } catch {
    return DENIED
  }
  if (claims.use !== 'collab' || claims.docId !== documentName || typeof claims.sub !== 'string') {
    return DENIED
  }

  try {
    return await getMembershipCached(documentName, claims.sub)
  } catch (err) {
    console.error(`[auth] membership 查询失败，保守拒绝:`, err instanceof Error ? err.message : err)
    return DENIED
  }
}
