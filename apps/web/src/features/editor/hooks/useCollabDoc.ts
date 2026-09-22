import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { HocuspocusProvider } from '@hocuspocus/provider'
import type { AwarenessUser } from '@online-word/shared'

export interface CollabHandles {
  ydoc: Y.Doc
  provider: HocuspocusProvider
}

export type CollabStatus = 'connecting' | 'connected' | 'disconnected'

export interface CollabState {
  handles: CollabHandles | null
  status: CollabStatus
  synced: boolean
}

/** M0 固定 token（collab 桩鉴权：非空即放行）；M1 换登录态 token */
const STUB_TOKEN = 'm0-token'

/**
 * 创建并管理一篇文档的协同连接生命周期：
 * Y.Doc(gc:true) → IndexeddbPersistence（本地离线/秒开）→ HocuspocusProvider
 *
 * 卸载时对称销毁 provider 与 ydoc，避免连接泄漏。
 * user 需由调用方保持引用稳定（M0 为常量；M1 用 useMemo 包裹登录态）。
 */
export function useCollabDoc(docId: string, user: AwarenessUser): CollabState {
  const [handles, setHandles] = useState<CollabHandles | null>(null)
  const [status, setStatus] = useState<CollabStatus>('connecting')
  const [synced, setSynced] = useState(false)

  useEffect(() => {
    setStatus('connecting')
    setSynced(false)

    const ydoc = new Y.Doc({ gc: true })
    // 本地持久化：离线编辑 + 秒开历史文档
    new IndexeddbPersistence(docId, ydoc)

    const provider = new HocuspocusProvider({
      url: 'ws://localhost:8080', // M0 直连 collab 网关（Vite 代理对二进制 WS 双向转发不稳）
      name: docId,
      document: ydoc,
      token: STUB_TOKEN,
      onStatus: ({ status }: { status: string }) => {
        setStatus(status === 'connected' ? 'connected' : 'disconnected')
      },
      onSynced: () => setSynced(true),
      onAuthenticationFailed: () => {
        // M1：跳转登录 / 申请权限
        console.warn('[collab] authentication failed')
      },
    })

    // 上报本地用户信息到 awareness（用于在线用户展示 / M1 远程光标）
    provider.awareness?.setLocalStateField('user', {
      userId: user.userId,
      name: user.name,
      color: user.color,
      avatar: user.avatar,
    })

    setHandles({ ydoc, provider })

    return () => {
      provider.destroy()
      ydoc.destroy()
    }
  }, [docId, user])

  return { handles, status, synced }
}
