import { useEffect, useState } from 'react'
import { EditorContent } from '@tiptap/react'
import { useStore } from 'zustand'
import { roleAtLeast, type AwarenessUser } from '@online-word/shared'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import { useCollabDoc, type CollabHandles } from './hooks/useCollabDoc'
import { useTiptapEditor } from './hooks/useTiptapEditor'

interface Props {
  docId: string
  user: AwarenessUser
  /** 获取 WS token 的回调（带新鲜度检查，过期自动续签），由编辑页注入 */
  getToken: () => Promise<string>
}

const STATUS_LABEL: Record<string, string> = {
  syncing: '同步中…',
  connected: '已连接',
  offline: '离线（重连中）',
  denied: '连接被拒绝',
}

export default function RichTextEditor({ docId, user, getToken }: Props) {
  const handles = useCollabDoc(docId, user, getToken)

  if (!handles) {
    return (
      <div className="editor-shell">
        <div className="editor-statusbar">
          <span className="status-dot" style={{ background: '#ff9f0a' }} />
          正在加载协同文档…
        </div>
      </div>
    )
  }

  return (
    <div className="editor-shell">
      <StatusBar handles={handles} user={user} docId={docId} />
      <EditorView handles={handles} user={user} />
    </div>
  )
}

/** 连接状态条：四态（connected/syncing/offline/denied），由 provider 事件写入 store */
function StatusBar({ handles, user, docId }: { handles: CollabHandles; user: AwarenessUser; docId: string }) {
  const status = useStore(handles.store, (s) => s.status)

  return (
    <div className={`editor-statusbar status-${status}`}>
      <span>
        <span className="status-dot" />
        {STATUS_LABEL[status] ?? status}
      </span>
      {!roleAtLeast(user.role, 'editor') && <span className="badge-readonly">只读模式</span>}
      {status === 'denied' && (
        <button
          type="button"
          className="reconnect-btn"
          onClick={() => {
            // connect() 会重新触发 WS open → getToken 续签 → 重新鉴权
            handles.provider.connect()
          }}
        >
          重新连接
        </button>
      )}
      <OnlineUsers provider={handles.provider} me={user} />
      <span style={{ marginLeft: 'auto' }}>文档 ID：{docId}</span>
    </div>
  )
}

/** 内层组件：handles 已保证非空，可安全调用 useTiptapEditor */
function EditorView({ handles, user }: { handles: CollabHandles; user: AwarenessUser }) {
  const editor = useTiptapEditor(handles, user)
  return <EditorContent editor={editor} className="ProseMirror" />
}

/** 基于 awareness 展示在线用户（M0 替代精确远程光标；T1.7 迁入 zustand 并做聚合去重） */
function OnlineUsers({ provider, me }: { provider: HocuspocusProvider; me: AwarenessUser }) {
  const [users, setUsers] = useState<AwarenessUser[]>([me])

  useEffect(() => {
    const aw = provider.awareness
    if (!aw) return
    const collect = () => {
      const map = new Map<string, AwarenessUser>()
      aw.getStates().forEach((state) => {
        const u = state.user as AwarenessUser | undefined
        if (u && u.userId) map.set(u.userId, u)
      })
      // 确保自己始终在列表中（即使 awareness 尚未上报）
      if (!map.has(me.userId)) map.set(me.userId, me)
      setUsers(Array.from(map.values()))
    }
    aw.on('change', collect)
    collect()
    return () => { aw.off('change', collect) }
  }, [provider, me])

  return (
    <span className="online-users">
      在线 {users.length} 人：
      {users.map((u) => (
        <span key={u.userId} className="user-chip" style={{ borderColor: u.color }}>
          <span className="user-dot" style={{ background: u.color }} />
          {u.name}
          {u.userId === me.userId ? '(我)' : ''}
        </span>
      ))}
    </span>
  )
}
