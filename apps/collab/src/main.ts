import './env.js'
import { Server } from '@hocuspocus/server'
import type { AwarenessUser, CollabContext } from '@online-word/shared'
import { verifyToken } from './auth.service.js'
import { loadDocState, persistChange } from './persistence.js'
import { closeRedis } from './redis.client.js'

/** 允许的前端来源（逗号分隔，默认本地 Vite） */
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)

const server = new Server<CollabContext>({
  port: Number(process.env.PORT ?? 8080),
  name: 'online-word-collab',

  /**
   * 连接建立时校验 Origin，拒绝未知来源（替代内置 CORS）。
   */
  async onConnect({ requestHeaders, documentName }) {
    const origin = requestHeaders.get('origin')
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      throw new Error(`origin not allowed: ${origin}`)
    }
    console.log(`[connect] room=${documentName} origin=${origin ?? '(none)'}`)
  },

  /**
   * M0 桩鉴权：有 token 即放行，返回固定测试用户。
   * 返回的对象会被合并到 connection context（CollabContext）。
   * TODO(M1-T1.5): 接业务后端 GET /internal/docs/:id/membership + Redis 缓存 + JWT 验签。
   */
  async onAuthenticate({ token, documentName }): Promise<Partial<CollabContext>> {
    const auth = await verifyToken(token, documentName)
    if (!auth.ok || auth.permission === 'none') {
      throw new Error('permission denied')
    }
    console.log(`[auth] ok room=${documentName} user=${auth.user.userId}`)
    return { user: auth.user, permission: auth.permission }
  },

  /**
   * T1.3 持久化读取协议（docs/03 §3）：
   * 快照 + 增量回放到房间 Y.Doc；与客户端的差异由 y 同步协议（状态向量）处理。
   */
  async onLoadDocument({ documentName, document }) {
    await loadDocState(documentName, document)
  },

  /**
   * T1.3 持久化写入协议（docs/03 §4）：
   * 每次变更幂等追加到 doc_updates（Redis 锁 + 水位行 FOR UPDATE + UNIQUE 兜底）。
   * 失败向上抛错由 Hocuspocus 记录；房间只读降级在 T1.4 落地。
   */
  async onChange({ documentName, update, document }) {
    await persistChange(documentName, update, document.clientID)
  },

  async onListen({ port }) {
    console.log(`[collab] Hocuspocus listening on ws://localhost:${port}`)
  },

  async onDisconnect({ documentName, context }) {
    const user = context?.user as AwarenessUser | undefined
    console.log(`[disconnect] room=${documentName} user=${user?.userId ?? 'unknown'}`)
  },

  /** 调试：记录 awareness 广播，确认在线状态同步 */
  async onAwarenessUpdate({ documentName, connection, added, updated, removed }) {
    const user = connection?.context?.user as AwarenessUser | undefined
    console.log(`[awareness] room=${documentName} user=${user?.userId ?? 'unknown'} added=${added.length} updated=${updated.length} removed=${removed.length}`)
  },
})

// 启动
await server.listen()

// 优雅退出：释放 Redis 连接（进程由 tsx watch / nodeman 管理生命周期）
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[collab] ${signal} received, shutting down`)
    void closeRedis().then(() => process.exit(0))
  })
}
