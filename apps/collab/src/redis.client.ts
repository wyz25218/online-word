import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'

/**
 * Redis client（collab 专属）：
 * - T1.3：房间级分布式锁（appendUpdate 串行化）
 * - T1.5：鉴权缓存；T1.8：踢人 Pub/Sub
 *
 * 单机开发验证 fallback：Redis 不可达时自动降级为进程内 Map 锁，
 * 仅保证单进程串行化（生产多实例必须有 Redis）。
 */

const LOCK_FALLBACK_ENABLED = process.env.REDIS_FALLBACK_INMEM !== 'false'

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 2,
  enableOfflineQueue: true,
  retryStrategy: (times: number) => Math.min(times * 200, 2000),
})

let redisAvailable = false
redis.on('connect', () => { redisAvailable = true })
redis.on('ready', () => { redisAvailable = true })
redis.on('error', (err: Error) => {
  console.error('[redis] error:', err.message)
  redisAvailable = false
})

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ───── 内存锁 fallback（仅单机开发验证） ─────
const memLocks = new Map<string, { token: string; expiresAt: number }>()

function tryAcquireMemLock(key: string, token: string, ttlMs: number): boolean {
  const existing = memLocks.get(key)
  if (existing && existing.expiresAt > Date.now() && existing.token !== token) return false
  memLocks.set(key, { token, expiresAt: Date.now() + ttlMs })
  return true
}

function releaseMemLock(key: string, token: string): boolean {
  const existing = memLocks.get(key)
  if (!existing) return false
  if (existing.token !== token) return false
  memLocks.delete(key)
  return true
}

// 定期清理过期内存锁（每 5s）
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of memLocks) if (v.expiresAt <= now) memLocks.delete(k)
}, 5_000).unref?.()

// ───── Redis 锁（与 fallback 共用同一套 API，按可用性切换） ─────

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`

export interface LockOptions {
  /** 租期（ms），超时自动释放防死锁 */
  ttlMs?: number
  /** 获取失败时的最长等待（ms） */
  waitMs?: number
}

/**
 * 房间级互斥：Redis SET NX PX + 自旋重试。
 * Redis 不可用时 fallback 到进程内 Map 锁（单机串行化）。
 */
export async function withLock<T>(key: string, fn: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  const { ttlMs = 10_000, waitMs = 2_000 } = options
  const token = randomUUID()
  const deadline = Date.now() + waitMs

  const tryAcquire = async () => {
    if (!redisAvailable && LOCK_FALLBACK_ENABLED) {
      return tryAcquireMemLock(key, token, ttlMs)
    }
    const r = await redis.set(key, token, 'PX', ttlMs, 'NX')
    return r === 'OK'
  }

  for (;;) {
    let acquired = false
    try {
      acquired = await tryAcquire()
    } catch {
      acquired = false
    }
    if (acquired) break
    if (Date.now() >= deadline) {
      throw new Error(`acquire lock timeout: ${key}`)
    }
    await sleep(25)
  }

  try {
    return await fn()
  } finally {
    try {
      if (!redisAvailable && LOCK_FALLBACK_ENABLED) {
        releaseMemLock(key, token)
      } else {
        await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token)
      }
    } catch {
      // release 失败不影响主流程（锁会在 ttl 后自动过期）
    }
  }
}

export async function closeRedis(): Promise<void> {
  redis.disconnect()
}
