import { useCallback, useEffect, useMemo, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { TaskList } from '@tiptap/extension-list/task-list'
import { TaskItem } from '@tiptap/extension-list/task-item'
import { Highlight } from '@tiptap/extension-highlight'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import * as Y from 'yjs'
import type { Editor } from '@tiptap/core'
import type { AwarenessUser } from '@online-word/shared'
import { encodeRevisionSnapshot, createRevision, getRevisionDetail, listRevisions, restoreRevision, type RevisionDetail, type RevisionSummary } from '../../api/revisions'

/** 最小 schema 集合——与 useTiptapEditor 一致（仅去掉 Collaboration/CommentMark 等协同依赖） */
const lowlight = createLowlight(common)

interface Props {
  docId: string
  user: AwarenessUser
  /** 当前协同 Y.Doc 引用（手动保存时 encodeStateAsUpdate） */
  ydoc: Y.Doc
  /** 当前协同 Tiptap editor（手动保存时 getJSON()；恢复时 setContent()） */
  editor: Editor | null
  editable: boolean
  isOwner: boolean
}

/** 构建只读预览编辑器所需的 extensions 数组（每次调用都返回新数组，避免 React 依赖坑） */
function buildPreviewExtensions() {
  return [
    StarterKit.configure({ undoRedo: false, codeBlock: false }),
    Placeholder.configure({ placeholder: '（空文档）' }),
    Image.configure({ inline: false, allowBase64: false }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight,
    CodeBlockLowlight.configure({ lowlight }),
  ]
}

/**
 * T2.4 版本历史侧栏（docs/06 §2 版本）：
 * - 时间轴列表 + 手动保存按钮（editor+）
 * - 点击版本 → 预览面板（独立只读 Tiptap 实例渲染 proseMirrorJson）
 * - 恢复按钮（owner 专属）：POST restore → server 返回 proseMirrorJson
 *   → editor.commands.setContent({ emitUpdate: true }) 整体替换
 *   → y-prosemirror 广播正常 Yjs update → 所有在线人自然收敛
 */
export default function RevisionsPanel({ docId, ydoc, editor, editable, isOwner }: Props) {
  const [revisions, setRevisions] = useState<RevisionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [activeDetail, setActiveDetail] = useState<RevisionDetail | null>(null)
  const [saving, setSaving] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const items = await listRevisions(docId)
      setRevisions(items)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [docId])

  useEffect(() => {
    void loadList()
  }, [loadList])

  const onClickRevision = useCallback(async (rev: RevisionSummary) => {
    setActiveDetail(null)
    try {
      const detail = await getRevisionDetail(docId, rev.id)
      setActiveDetail(detail)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [docId])

  const onManualSave = useCallback(async () => {
    if (!editor || !editable) return
    setSaving(true)
    setError(null)
    try {
      const snapshot = encodeRevisionSnapshot(ydoc)
      const proseMirrorJson = JSON.stringify(editor.getJSON())
      const saved = await createRevision({
        docId,
        stateBase64: snapshot.stateBase64,
        proseMirrorJson,
        plainText: snapshot.plainText,
        wordCount: snapshot.wordCount,
      })
      setRevisions((prev) => [saved, ...prev])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [docId, ydoc, editor, editable])

  const onRestore = useCallback(async () => {
    if (!activeDetail || !editor || !isOwner || restoring) return
    setRestoring(true)
    setError(null)
    try {
      const detail = await restoreRevision(docId, activeDetail.id)
      const parsed = JSON.parse(detail.proseMirrorJson)
      // 整体替换：emitUpdate=true → y-prosemirror 生成正常 Yjs update 广播
      // 所有人自然收敛（docs/04 §7 版本恢复正确姿势）
      editor.commands.setContent(parsed, { emitUpdate: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRestoring(false)
    }
  }, [activeDetail, editor, isOwner, restoring, docId])

  // 预览编辑器：每次 activeDetail 变化都重建（用 React.useMemo 保证只在内容变时重配）
  const previewEditor = useEditor({
    extensions: buildPreviewExtensions(),
    content: activeDetail?.proseMirrorJson ? JSON.parse(activeDetail.proseMirrorJson) : '',
    editable: false,
    immediatelyRender: false,
  }, [activeDetail?.id])

  return (
    <aside className="revisions-panel">
      <div className="revisions-header">
        <h3>版本历史</h3>
        <div className="revisions-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!editable || saving}
            onClick={() => void onManualSave()}
            title={!editable ? '仅可编辑者可手动保存' : '保存当前版本快照'}
          >
            {saving ? '保存中…' : '保存版本'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={loading}
            onClick={() => void loadList()}
            title="刷新列表"
          >
            ↻
          </button>
        </div>
      </div>

      {error !== null && (
        <div className="revisions-error" role="alert">{error}</div>
      )}

      <div className="revisions-list">
        {loading && revisions.length === 0 && (
          <div className="revisions-empty">加载中…</div>
        )}
        {!loading && revisions.length === 0 && (
          <div className="revisions-empty">
            暂无历史版本。
            <br />
            点击「保存版本」创建第一条快照。
          </div>
        )}
        {revisions.map((rev) => (
          <RevisionRow
            key={rev.id}
            rev={rev}
            active={activeDetail?.id === rev.id}
            onClick={() => void onClickRevision(rev)}
          />
        ))}
      </div>

      {activeDetail !== null && previewEditor && (
        <div className="revision-preview">
          <div className="revision-preview-header">
            <span className="revision-preview-title">
              {activeDetail.label ?? `版本 ${formatTime(activeDetail.createdAt)}`}
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!isOwner || restoring}
              onClick={() => void onRestore()}
              title={!isOwner ? '仅文档拥有者可恢复版本' : '将该版本整体替换到当前文档'}
            >
              {restoring ? '恢复中…' : '恢复此版本'}
            </button>
          </div>
          <div className="revision-preview-body">
            <EditorContent editor={previewEditor} className="ProseMirror revision-preview-content" />
          </div>
        </div>
      )}
    </aside>
  )
}

function RevisionRow({
  rev,
  active,
  onClick,
}: {
  rev: RevisionSummary
  active: boolean
  onClick: () => void
}) {
  const time = useMemo(() => formatTime(rev.createdAt), [rev.createdAt])
  const authorLabel = rev.authorId === null ? '（系统定时）' : '手动保存'
  return (
    <button
      type="button"
      className={`rev-row${active ? ' active' : ''}`}
      onClick={onClick}
    >
      <span className="rev-time">{time}</span>
      <span className="rev-meta">
        {rev.label ?? authorLabel}
        {rev.wordCount !== null && rev.wordCount !== undefined && ` · ${rev.wordCount}字`}
      </span>
    </button>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (sameDay) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (diffDays === 1) return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (diffDays < 7) return `${diffDays} 天前`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
