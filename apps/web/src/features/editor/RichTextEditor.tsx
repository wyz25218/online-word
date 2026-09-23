import { useEffect, useState } from 'react'
import { EditorContent } from '@tiptap/react'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type { AwarenessUser } from '@online-word/shared'
import { useCollabDoc } from './hooks/useCollabDoc'
import { useTiptapEditor } from './hooks/useTiptapEditor'

interface Props {
  docId: string
  user: AwarenessUser
  /** GET /collab/token 换取的 WS token；空串时不建连接 */
  token: string
}

const STATUS_LABEL: Record<string, string> = {
  connecting: '连接中…',
  connected: '已连接',
  disconnected: '已断开',
}

export default function RichTextEditor({ docId, user, token }: Props) {
  const { handles, status, synced } = useCollabDoc(docId, user, token)

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
      <div className={`editor-statusbar status-${status}`}>
        <span>
          <span className="status-dot" />
          {STATUS_LABEL[status] ?? status}
          {synced ? ' · 已同步' : ' · 同步中'}
        </span>
        <OnlineUsers provider={handles.provider} me={user} />
        <span style={{ marginLeft: 'auto' }}>文档 ID：{docId}</span>
      </div>
      <EditorView handles={handles} user={user} />
    </div>
  )
}

/** 内层组件：handles 已保证非空，可安全调用 useTiptapEditor */
function EditorView({ handles, user }: { handles: NonNullable<ReturnType<typeof useCollabDoc>['handles']>; user: AwarenessUser }) {
  const editor = useTiptapEditor(handles, user)
  return <EditorContent editor={editor} className="ProseMirror" />
}

/** 基于 awareness 展示在线用户（M0 替代精确远程光标） */
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
