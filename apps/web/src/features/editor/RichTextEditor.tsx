import { useEffect, useState } from 'react'
import { EditorContent, useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useStore } from 'zustand'
import { roleAtLeast, type AwarenessUser } from '@online-word/shared'
import { useCollabDoc, type CollabHandles } from './hooks/useCollabDoc'
import type { CollabStore } from './collab.store'
import { useTiptapEditor } from './hooks/useTiptapEditor'
import { startImageUploads } from './uploader'

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
      <EditorView handles={handles} user={user} docId={docId} />
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
function EditorView({ handles, user, docId }: { handles: CollabHandles; user: AwarenessUser; docId: string }) {
  const editor = useTiptapEditor(handles, user, docId)
  // T1.8：网关 scope 联动编辑态——降权（scope=readonly）立即置只读，恢复写权限后可继续编辑
  const authorizedScope = useStore(handles.store, (s) => s.authorizedScope)
  const editable = authorizedScope !== 'readonly' && roleAtLeast(user.role, 'editor')

  useEffect(() => {
    if (editor === null) return
    editor.setEditable(editable)
  }, [editor, editable])

  // 自动化验证钩子：暴露 editor 实例（事务 API 不依赖 DOM 焦点，供 headless 浏览器验证使用）
  useEffect(() => {
    ;(window as unknown as { __owEditor?: Editor | null }).__owEditor = editor
  }, [editor])

  return (
    <div className="editor-body">
      <Toolbar editor={editor} editable={editable} docId={docId} />
      <EditorContent editor={editor} className="ProseMirror" />
    </div>
  )
}

/** 工具栏按钮组 + 字数统计；active/disabled 态经 useEditorState 选择器按需订阅（docs/05 §5） */
function Toolbar({ editor, editable, docId }: { editor: Editor | null; editable: boolean; docId: string }) {
  // T2.2：链接编辑浮层（不用 window.prompt，自动化测试与用户体验都更可控）
  const [linkEdit, setLinkEdit] = useState<{ url: string } | null>(null)

  const s = useEditorState({
    editor,
    selector: (ctx) => {
      const e = ctx.editor
      if (e === null) return null
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        strike: e.isActive('strike'),
        // T2.2：富格式 active 态
        underline: e.isActive('underline'),
        highlight: e.isActive('highlight'),
        codeBlock: e.isActive('codeBlock'),
        link: e.isActive('link'),
        linkHref: (e.getAttributes('link').href as string | undefined) ?? '',
        taskList: e.isActive('taskList'),
        // T2.2：表格上下文（光标在表格内才允许行/列操作）
        inTable: e.isActive('table'),
        canAddRow: e.can().addRowAfter(),
        canDeleteRow: e.can().deleteRow(),
        canAddCol: e.can().addColumnAfter(),
        canDeleteCol: e.can().deleteColumn(),
        canToggleHeaderRow: e.can().toggleHeaderRow(),
        canDeleteTable: e.can().deleteTable(),
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

  const applyLink = () => {
    if (linkEdit === null) return
    const raw = linkEdit.url.trim()
    if (raw === '') {
      // 清空 = 移除链接（保留选区文本）
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      const href = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw) ? raw : `https://${raw}`
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
    setLinkEdit(null)
  }

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
    { key: 'underline', label: 'U', active: s.underline, onClick: () => editor.chain().focus().toggleUnderline().run() },
    { key: 'highlight', label: '高亮', active: s.highlight, onClick: () => editor.chain().focus().toggleHighlight().run() },
    { key: 'sep-2' },
    { key: 'h1', label: 'H1', active: s.h1, onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { key: 'h2', label: 'H2', active: s.h2, onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { key: 'h3', label: 'H3', active: s.h3, onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { key: 'sep-3' },
    { key: 'bulletList', label: '• 列表', active: s.bulletList, onClick: () => editor.chain().focus().toggleBulletList().run() },
    { key: 'orderedList', label: '1. 列表', active: s.orderedList, onClick: () => editor.chain().focus().toggleOrderedList().run() },
    { key: 'taskList', label: '☑ 任务', active: s.taskList, onClick: () => editor.chain().focus().toggleTaskList().run() },
    { key: 'sep-4' },
    { key: 'blockquote', label: '引用', active: s.blockquote, onClick: () => editor.chain().focus().toggleBlockquote().run() },
    { key: 'codeBlock', label: '代码块', active: s.codeBlock, onClick: () => editor.chain().focus().toggleCodeBlock().run() },
    { key: 'horizontalRule', label: '分割线', onClick: () => editor.chain().focus().setHorizontalRule().run() },
    {
      key: 'link',
      label: '链接',
      active: s.link,
      onClick: () => setLinkEdit({ url: s.linkHref }),
    },
    { key: 'sep-5' },
    { key: 'tableInsert', label: '插表', disabled: !editable, onClick: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { key: 'tableAddRow', label: '+行', disabled: !s.canAddRow, onClick: () => editor.chain().focus().addRowAfter().run() },
    { key: 'tableDeleteRow', label: '-行', disabled: !s.canDeleteRow, onClick: () => editor.chain().focus().deleteRow().run() },
    { key: 'tableAddCol', label: '+列', disabled: !s.canAddCol, onClick: () => editor.chain().focus().addColumnAfter().run() },
    { key: 'tableDeleteCol', label: '-列', disabled: !s.canDeleteCol, onClick: () => editor.chain().focus().deleteColumn().run() },
    { key: 'tableHeader', label: '表头', disabled: !s.canToggleHeaderRow, active: s.inTable, onClick: () => editor.chain().focus().toggleHeaderRow().run() },
    { key: 'tableDelete', label: '删表', disabled: !s.canDeleteTable, onClick: () => editor.chain().focus().deleteTable().run() },
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
      {/* T2.1 拦截 3/3：工具栏选图 → 统一上传器 */}
      <label className={`tb-btn tb-file${editable ? '' : ' disabled'}`} title="插入图片">
        图片
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
          multiple
          hidden
          disabled={!editable}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0 && editor) startImageUploads(editor.view, docId, files)
            e.target.value = '' // 允许连续选择同一文件
          }}
        />
      </label>
      {/* T2.2：链接编辑浮层（锚定工具栏左下） */}
      {linkEdit !== null && (
        <div className="tb-popover">
          <input
            className="tb-popover-input"
            value={linkEdit.url}
            autoFocus
            placeholder="https://example.com"
            onChange={(e) => setLinkEdit({ url: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyLink()
              if (e.key === 'Escape') setLinkEdit(null)
            }}
          />
          <button type="button" className="btn btn-primary tb-popover-btn" onClick={applyLink}>
            确定
          </button>
          <button type="button" className="btn tb-popover-btn" onClick={() => setLinkEdit(null)}>
            取消
          </button>
        </div>
      )}
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
