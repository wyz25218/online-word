import { Server } from '@hocuspocus/server'
import type { AwarenessUser, CollabContext } from '@online-word/shared'
import { verifyToken } from './auth.service.js'

/** M0 允许的前端来源（M1 改为从配置读取） */
const ALLOWED_ORIGINS = new Set(['http://localhost:5173'])

const server = new Server<CollabContext>({
  port: 8080,
  name: 'online-word-collab',

  /**
   * 连接建立时校验 Origin，拒绝未知来源（替代内置 CORS）。
   * M0 仅允许本地 Vite 开发服务器；M1 改为环境变量配置。
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
   * TODO(M1-T1.5): 接业务后端 GET /internal/docs/:id/membership + Redis 缓存。
   */
  async onAuthenticate({ token, documentName }): Promise<Partial<CollabContext>> {
    const auth = await verifyToken(token, documentName)
    if (!auth.ok || auth.permission === 'none') {
      throw new Error('permission denied')
    }
    console.log(`[auth] ok room=${documentName} user=${auth.user.userId}`)
    return { user: auth.user, permission: auth.permission }
  },

  async onListen({ port }) {
    console.log(`[collab] Hocuspocus listening on ws://localhost:${port}`)
  },

  async onDisconnect({ documentName, context }) {
    const user = context?.user as AwarenessUser | undefined
    console.log(`[disconnect] room=${documentName} user=${user?.userId ?? 'unknown'}`)
  },

  /** M0 调试：记录 awareness 广播，确认在线状态同步 */
  async onAwarenessUpdate({ documentName, connection, added, updated, removed }) {
    const user = connection?.context?.user as AwarenessUser | undefined
    console.log(`[awareness] room=${documentName} user=${user?.userId ?? 'unknown'} added=${added.length} updated=${updated.length} removed=${removed.length}`)
  },
})

// 启动
await server.listen()
