import { Redis } from 'ioredis'

/**
 * Redis client（server 侧最小使用，T1.8）：
 * - DEL collab:membership:{docId}:{userId}（删网关鉴权缓存）
 * - PUBLISH collab:control:{docId}（通知网关断开目标用户连接，迫使其重新鉴权）
 */
export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 2,
  enableOfflineQueue: true,
  retryStrategy: (times: number) => Math.min(times * 200, 2000),
})

redis.on('error', (err: Error) => {
  console.error('[redis] error:', err.message)
})
