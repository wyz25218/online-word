import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'

/**
 * Redis client（collab 专属）：
 * - T1.3：房间级分布式锁（appendUpdate 串行化）
 * - T1.5：鉴权缓存；T1.8：踢人 Pub/Sub
 */

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 2,
  // ioredis 6 默认启用离线队列；网关启动时 Redis 未就绪应尽快暴露错误而非无限缓冲
  enableOfflineQueue: true,
  retryStrategy: (times: number) => Math.min(times * 200, 2000),
})

redis.on('error', (err: Error) => {
  console.error('[redis] error:', err.message)
})

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 释放锁：Lua 比对 token 防止误删他人的锁（过期后被第二持有者接管时） */
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
 * 房间级互斥：SET NX PX + 自旋重试。
 * 典型：lock:doc:{docId}（追加）与 lock:doc:compact:{docId}（压缩，T1.4）互斥靠不同 key 不成立——
 * 压缩也必须先拿追加锁再加压缩锁（或统一使用同一把锁），M1-T1.4 采用"同一把锁"方案。
 */
export async function withLock<T>(key: string, fn: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  const { ttlMs = 10_000, waitMs = 2_000 } = options
  const token = randomUUID()
  const deadline = Date.now() + waitMs

  for (;;) {
    const acquired = await redis.set(key, token, 'PX', ttlMs, 'NX')
    if (acquired === 'OK') break
    if (Date.now() >= deadline) {
      throw new Error(`acquire lock timeout: ${key}`)
    }
    await sleep(25)
  }

  try {
    return await fn()
  } finally {
    await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token).catch(() => {})
  }
}

export async function closeRedis(): Promise<void> {
  redis.disconnect()
}
