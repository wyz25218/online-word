import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { HocuspocusProvider } from '@hocuspocus/provider'
import type { AwarenessUser } from '@online-word/shared'
import { createCollabStore, type CollabStore } from '../collab.store'

export interface CollabHandles {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  /** 连接状态切片（docs/05 §3：由 provider 事件写入，组件订阅） */
  store: CollabStore
}

/**
 * 创建并管理一篇文档的协同连接生命周期：
 * Y.Doc(gc:true) → IndexeddbPersistence（本地离线/秒开）→ HocuspocusProvider
 *
 * getToken 由编辑页注入（GET /collab/token，带新鲜度检查的回调）。
 * provider 的 token 支持函数形式：每次 WS open（含断线自动重连）都会重新调用，
 * token 过期后重连即自动续签，无需销毁重建连接。
 *
 * 认证失败（token 无效/被移除权限）→ disconnect 停止自动重试，状态置 denied，
 * 由用户手动点击「重新连接」触发 provider.connect()（connect 内自动续签 token）。
 *
 * 卸载时对称销毁 provider 与 ydoc，避免连接泄漏。
 * user/getToken 需由调用方保持引用稳定（useMemo/useCallback），否则连接会被反复重建。
 */
export function useCollabDoc(docId: string, user: AwarenessUser, getToken: () => Promise<string>): CollabHandles | null {
  const [handles, setHandles] = useState<CollabHandles | null>(null)

  useEffect(() => {
    const store = createCollabStore(user)
    const ydoc = new Y.Doc({ gc: true })
    // 本地持久化：离线编辑 + 秒开历史文档（offline 期间的编辑先落 IndexedDB，
    // 重连后由 y 同步协议将本地增量推给服务端，双向收敛）
    new IndexeddbPersistence(docId, ydoc)

    // 认证失败后 disconnect() 会再触发一次 disconnected 状态事件，用标志位防止覆盖 denied
    let denied = false
    let providerRef: HocuspocusProvider | undefined

    const provider = new HocuspocusProvider({
      url: 'ws://localhost:8080', // M0 直连 collab 网关（Vite 代理对二进制 WS 双向转发不稳）
      name: docId,
      document: ydoc,
      token: getToken,
      onStatus: ({ status }: { status: string }) => {
        if (denied) return
        store.setState((s) => ({ status: status === 'connected' ? (s.synced ? 'connected' : 'syncing') : 'offline' }))
      },
      onSynced: () => {
        if (denied) return
        store.setState({ synced: true, status: 'connected' })
      },
      onAuthenticationFailed: () => {
        console.warn('[collab] authentication failed, stop retrying')
        denied = true
        store.setState({ status: 'denied' })
        // provider 内部认证失败不会停止重连（源码 permissionDeniedHandler 只发事件），
        // 必须主动断开，避免无效 token 下的无限重连循环
        providerRef?.disconnect()
      },
    })
    providerRef = provider

    // T1.7 Presence：awareness 字段按 shared AwarenessState 固化（docs/04 §5），
    // user.color 由编辑页按 colorForUser(userId) 稳定取色
    const aw = provider.awareness
    aw?.setLocalStateField('user', {
      userId: user.userId,
      name: user.name,
      color: user.color,
      avatar: user.avatar,
    })
    aw?.setLocalStateField('cursor', null)
    aw?.setLocalStateField('lastUpdate', Date.now())

    // lastUpdate 心跳（docs/04 §5 字段契约）；离线端由 y-protocols 内置 30s 超时清除
    const heartbeat = setInterval(() => aw?.setLocalStateField('lastUpdate', Date.now()), 15_000)

    // awareness 变化 → 按 userId 聚合去重写入 store（同一账号多标签只显示一个头像）
    const collectUsers = () => {
      const map = new Map<string, AwarenessUser>()
      aw?.getStates().forEach((state) => {
        const u = state.user as AwarenessUser | undefined
        if (u && u.userId) map.set(u.userId, u)
      })
      // 确保自己始终在列表中（即使 awareness 尚未广播回来）
      if (!map.has(user.userId)) map.set(user.userId, user)
      store.setState({ onlineUsers: Array.from(map.values()) })
    }
    aw?.on('change', collectUsers)

    setHandles({ ydoc, provider, store })

    return () => {
      clearInterval(heartbeat)
      aw?.off('change', collectUsers)
      provider.destroy()
      ydoc.destroy()
    }
  }, [docId, user, getToken])

  return handles
}
