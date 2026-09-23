import { Redis } from 'ioredis'
import type { AwarenessUser, CollabControlEvent } from '@online-word/shared'

/**
 * T1.8 踢人/降权订阅器（docs/09）：
 * server 权限变更 → DEL 鉴权缓存 + PUBLISH collab:control:{docId}；
 * 本订阅器收到事件后断开目标用户在该房间的连接 → 客户端自动重连 →
 * onAuthenticate 重新查 membership（缓存已删，实时结论）：
 * 被移除 → 拒绝（前端 denied 停止重试）；降权 → 以 readonly 连接重建。
 */

interface ClosableConnection {
  context?: { user?: AwarenessUser }
  close: (event?: { code: number; reason: string }) => void
}

export function startControlSubscriber(
  redisUrl: string,
  hooks: {
    /** 按房间名取 Hocuspocus documents（main.ts 注入 server.hocuspocus.documents） */
    getConnections: (docId: string) => IterableIterator<ClosableConnection> | undefined
  },
): Redis {
  const sub = new Redis(redisUrl, {
    maxRetriesPerRequest: null, // 订阅连接要求 null（ioredis 约束）
    retryStrategy: (times: number) => Math.min(times * 200, 2000),
  })
  sub.on('error', (err: Error) => {
    console.error('[control] redis error:', err.message)
  })

  sub.psubscribe('collab:control:*', (err) => {
    if (err) console.error('[control] psubscribe failed:', err.message)
    else console.log('[control] subscribed to collab:control:*')
  })

  sub.on('pmessage', (_pattern, _channel, raw) => {
    let event: CollabControlEvent
    try {
      event = JSON.parse(raw) as CollabControlEvent
    } catch {
      console.warn('[control] invalid message:', raw.slice(0, 120))
      return
    }
    if (event.action !== 'membership-changed') return

    let kicked = 0
    const connections = hooks.getConnections(event.docId)
    if (connections !== undefined) {
      for (const conn of connections) {
        const uid = conn.context?.user?.userId
        if (uid === event.userId) {
          // 自定义关闭码 4003：客户端 onClose 可识别"权限变更被断开"（当前重连逻辑无需特判）
          conn.close({ code: 4003, reason: 'membership-changed' })
          kicked++
        }
      }
    }
    console.log(`[control] membership-changed doc=${event.docId} user=${event.userId} kicked=${kicked}`)
  })

  return sub
}
