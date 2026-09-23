import { EditorContent } from '@tiptap/react'
import { useStore } from 'zustand'
import { roleAtLeast, type AwarenessUser } from '@online-word/shared'
import { useCollabDoc, type CollabHandles } from './hooks/useCollabDoc'
import type { CollabStore } from './collab.store'
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
      <OnlineUsers store={handles.store} me={user} />
      <span style={{ marginLeft: 'auto' }}>文档 ID：{docId}</span>
    </div>
  )
}

/** 内层组件：handles 已保证非空，可安全调用 useTiptapEditor */
function EditorView({ handles, user }: { handles: CollabHandles; user: AwarenessUser }) {
  const editor = useTiptapEditor(handles, user)
  return <EditorContent editor={editor} className="ProseMirror" />
}

/** 在线用户：订阅 store（useCollabDoc 已按 userId 聚合去重，T1.7 迁入 zustand） */
function OnlineUsers({ store, me }: { store: CollabStore; me: AwarenessUser }) {
  const users = useStore(store, (s) => s.onlineUsers)

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
