import './env.js'
import { Server } from '@hocuspocus/server'
import type { AwarenessUser, CollabContext } from '@online-word/shared'
import { startControlSubscriber } from './control.subscriber.js'
import { verifyToken } from './auth.service.js'
import { affectsProsemirror, syncUpdateOf } from './comment-guard.js'
import { flushCommentsExtract, scheduleCommentsExtract } from './extract.js'
import { compactOnUnload, loadDocState, persistChange } from './persistence.js'
import { isRoomReadOnly } from './room-state.js'
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
   * T1.5 真实鉴权：JWT 验签（use=collab、绑定 docId）+ server membership 内部接口（Redis 缓存 60s）。
   * viewer → 连接级只读（Hocuspocus 丢弃该连接的写消息）；
   * T2.3：commenter → 保持连接可写，由 beforeHandleMessage 按命名空间粒度过滤
   * （仅放行 comments 通道，正文写入直接断连）；
   * T1.4 房间写路径降级时，任何角色都以只读建立。
   * 返回的对象会被合并到 connection context（CollabContext）。
   */
  async onAuthenticate({ token, documentName, connectionConfig }): Promise<Partial<CollabContext>> {
    const auth = await verifyToken(token, documentName)
    if (!auth.ok || auth.permission === 'none') {
      throw new Error('permission denied')
    }
    if (auth.permission === 'read' && auth.user.role !== 'commenter') {
      connectionConfig.readOnly = true
    }
    if (isRoomReadOnly(documentName)) {
      connectionConfig.readOnly = true
      console.warn(`[auth] room=${documentName} 房间只读降级中 user=${auth.user.userId}`)
    }
    console.log(
      `[auth] ok room=${documentName} user=${auth.user.userId} role=${auth.user.role} permission=${auth.permission}${connectionConfig.readOnly ? ' (readOnly)' : ''}`,
    )
    return { user: auth.user, permission: auth.permission }
  },

  /**
   * T2.3 commenter 命名空间级写权限（docs/04 §3/§6）：
   * 仅对 commenter 连接生效——把携带写入内容的 SyncStep2/Update 消息应用到房间文档的
   * 影子副本上，若正文（prosemirror 命名空间）可见内容发生变化则拒绝该消息。
   * 拒绝方式为抛错：Hocuspocus 会关闭该连接（诚实客户端永不触发，等价踢出恶意客户端）。
   * SyncStep1（请求 diff）与 Awareness 消息不携带写入内容，直接放行。
   */
  async beforeHandleMessage({ documentName, document, update, connection }) {
    const user = connection?.context?.user as AwarenessUser | undefined
    if (user?.role !== 'commenter') return
    const writeUpdate = syncUpdateOf(update)
    if (writeUpdate === null) return
    if (!affectsProsemirror(document, writeUpdate)) return
    console.error(`[guard] room=${documentName} commenter=${user.userId} 尝试写入正文，已拒收并断开`)
    throw new Error('commenter cannot write to document body')
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
   * T1.4：追加重试耗尽 → 房间只读降级 + 断开在场连接（重连后以只读建立）；
   *       积压达阈值在 persistChange 内触发快照压缩。
   */
  async onChange({ documentName, update, document }) {
    try {
      await persistChange(documentName, update, document)
    } catch (err) {
      console.error(`[persist] room=${documentName} 踢出在场连接以触发只读重连:`, err instanceof Error ? err.message : err)
      server.hocuspocus.closeConnections(documentName)
    }
    // T2.3：评论抽取回写（防抖；线程快照未变化时内部自动跳过）
    scheduleCommentsExtract(documentName, document)
  },

  /**
   * T1.4 快照压缩（docs/03 §5）：房间卸载前（最后一个连接关闭）强制压缩积压增量，
   * 防止"无人房间积压"长期占表；此时内存 Y.Doc 尚未 destroy，可 encode 后随水位一并固化。
   * 注：Hocuspocus v4 的 onDestroy 仅在 Server.destroy 时触发且无 document 引用，
   * 房间卸载的对应 hook 是 beforeUnloadDocument（文档销毁前最后时机）。
   */
  async beforeUnloadDocument({ documentName, document }) {
    await compactOnUnload(documentName, document)
    // T2.3：未回写的评论快照兜底落库（不走防抖）
    await flushCommentsExtract(documentName)
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

// T1.8：订阅 server 的权限变更控制事件（踢人/降权 → 断开目标连接强制重新鉴权）
const controlSub = startControlSubscriber(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  getConnections: (docId) => server.hocuspocus.documents.get(docId)?.connections.keys(),
})

// 优雅退出：释放 Redis 连接（进程由 tsx watch / nodeman 管理生命周期）
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[collab] ${signal} received, shutting down`)
    controlSub.disconnect()
    void closeRedis().then(() => process.exit(0))
  })
}
