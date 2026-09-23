import { useEffect } from 'react'
import { EditorContent, useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
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
  const authorizedScope = useStore(handles.store, (s) => s.authorizedScope)
  // 被降权：本地角色以为可写但网关下发只读连接（T1.8 权限变更即时生效）
  const downgraded = authorizedScope === 'readonly' && roleAtLeast(user.role, 'editor')

  return (
    <div className={`editor-statusbar status-${status}`}>
      <span>
        <span className="status-dot" />
        {STATUS_LABEL[status] ?? status}
      </span>
      {!roleAtLeast(user.role, 'editor') && <span className="badge-readonly">只读模式</span>}
      {downgraded && <span className="badge-readonly">权限已调整：只读</span>}
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
  // T1.8：网关 scope 联动编辑态——降权（scope=readonly）立即置只读，恢复写权限后可继续编辑
  const authorizedScope = useStore(handles.store, (s) => s.authorizedScope)
  const editable = authorizedScope !== 'readonly' && roleAtLeast(user.role, 'editor')

  useEffect(() => {
    if (editor === null) return
    editor.setEditable(editable)
  }, [editor, editable])

  return (
    <div className="editor-body">
      <Toolbar editor={editor} editable={editable} />
      <EditorContent editor={editor} className="ProseMirror" />
    </div>
  )
}

/** 工具栏按钮组 + 字数统计；active/disabled 态经 useEditorState 选择器按需订阅（docs/05 §5） */
function Toolbar({ editor, editable }: { editor: Editor | null; editable: boolean }) {
  const s = useEditorState({
    editor,
    selector: (ctx) => {
      const e = ctx.editor
      if (e === null) return null
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        strike: e.isActive('strike'),
        h1: e.isActive('heading', { level: 1 }),
        h2: e.isActive('heading', { level: 2 }),
        h3: e.isActive('heading', { level: 3 }),
        bulletList: e.isActive('bulletList'),
        orderedList: e.isActive('orderedList'),
        blockquote: e.isActive('blockquote'),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        chars: e.storage.characterCount.characters() as number,
      }
    },
  })

  if (editor === null || s === null) return null

  interface TbItem {
    key: string
    label?: string
    disabled?: boolean
    active?: boolean
    onClick?: () => void
  }
  const buttons: TbItem[] = [
    { key: 'undo', label: '撤销', disabled: !s.canUndo, onClick: () => editor.chain().focus().undo().run() },
    { key: 'redo', label: '重做', disabled: !s.canRedo, onClick: () => editor.chain().focus().redo().run() },
    { key: 'sep-1' },
    { key: 'bold', label: 'B', active: s.bold, onClick: () => editor.chain().focus().toggleBold().run() },
    { key: 'italic', label: 'I', active: s.italic, onClick: () => editor.chain().focus().toggleItalic().run() },
    { key: 'strike', label: 'S', active: s.strike, onClick: () => editor.chain().focus().toggleStrike().run() },
    { key: 'sep-2' },
    { key: 'h1', label: 'H1', active: s.h1, onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { key: 'h2', label: 'H2', active: s.h2, onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { key: 'h3', label: 'H3', active: s.h3, onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { key: 'sep-3' },
    { key: 'bulletList', label: '• 列表', active: s.bulletList, onClick: () => editor.chain().focus().toggleBulletList().run() },
    { key: 'orderedList', label: '1. 列表', active: s.orderedList, onClick: () => editor.chain().focus().toggleOrderedList().run() },
    { key: 'sep-4' },
    { key: 'blockquote', label: '引用', active: s.blockquote, onClick: () => editor.chain().focus().toggleBlockquote().run() },
  ]

  return (
    <div className={`editor-toolbar${editable ? '' : ' readonly'}`}>
      {buttons.map((b) =>
        b.label === undefined ? (
          <span key={b.key} className="tb-sep" />
        ) : (
          <button
            key={b.key}
            type="button"
            className={`tb-btn${b.active ? ' active' : ''}`}
            disabled={b.disabled === true || !editable}
            title={b.key}
            onClick={b.onClick}
          >
            {b.label}
          </button>
        ),
      )}
      <span className="tb-wordcount">字数 {s.chars}</span>
    </div>
  )
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
