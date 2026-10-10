import { useState } from 'react'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { roleAtLeast, type AwarenessUser } from '@online-word/shared'
import { findThreadRange, type CommentsApi } from './hooks/useComments'

/**
 * 评论侧栏（docs/05 §布局/§锚点交互，T2.3）：
 * - 实时线程列表（来自 comments 命名空间，评论/回复/解决即时多端同步）
 * - 锚点存活性来自正文 doc：无对应 mark 的线程显示「上下文已删除」
 * - 点击线程定位正文锚点；resolved 线程折叠置灰
 * - 权限：commenter+ 可回复/解决；删除仅限线程作者或 editor+；viewer 不渲染本面板
 */
interface Props {
  editor: Editor
  user: AwarenessUser
  comments: CommentsApi
  activeThreadId: string | null
  onSelectThread: (threadId: string) => void
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}

export default function CommentsPanel({ editor, user, comments, activeThreadId, onSelectThread }: Props) {
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({})
  const canReply = roleAtLeast(user.role, 'commenter')

  // 正文锚点存活集合（任何编辑事务都会触发重算，deepEqual 去重渲染）
  const anchoredIds = useEditorState({
    editor,
    selector: (ctx) => {
      const ids = new Set<string>()
      ctx.editor.state.doc.descendants((node) => {
        for (const m of node.marks) {
          if (m.type.name === 'comment' && typeof m.attrs.threadId === 'string') ids.add(m.attrs.threadId)
        }
      })
      return ids
    },
  })

  const locate = (threadId: string) => {
    onSelectThread(threadId)
    const range = findThreadRange(editor, threadId)
    if (range !== null) {
      editor.chain().setTextSelection(range).scrollIntoView().run()
    }
  }

  const submitReply = (threadId: string) => {
    const body = (replyDraft[threadId] ?? '').trim()
    if (body === '') return
    comments.addReply(threadId, {
      id: crypto.randomUUID(),
      authorId: user.userId,
      body,
      createdAt: Date.now(),
    })
    setReplyDraft((d) => ({ ...d, [threadId]: '' }))
  }

  if (comments.threads.length === 0) {
    return (
      <aside className="comments-panel">
        <div className="comments-head">评论</div>
        <div className="comments-empty">选中一段文字，点工具栏「评论」开始讨论</div>
      </aside>
    )
  }

  return (
    <aside className="comments-panel">
      <div className="comments-head">
        评论 <span className="comments-count">{comments.threads.length}</span>
      </div>
      <div className="comments-list">
        {comments.threads.map((t) => {
          const anchored = anchoredIds.has(t.id)
          const mine = t.authorId === user.userId
          return (
            <div
              key={t.id}
              className={`thread-card${t.resolved ? ' resolved' : ''}${activeThreadId === t.id ? ' active' : ''}`}
              onClick={() => locate(t.id)}
            >
              <div className="thread-body">
                {t.body}
                {!anchored && <span className="thread-orphan">（上下文已删除）</span>}
              </div>
              <div className="thread-meta">
                <span className="thread-author">{mine ? '我' : t.authorId.slice(0, 8)}</span>
                <span>{fmtTime(t.createdAt)}</span>
              </div>

              {t.resolved ? (
                <div className="thread-resolved-tag">已解决</div>
              ) : (
                <>
                  {t.replies.length > 0 && (
                    <div className="thread-replies">
                      {t.replies.map((r) => (
                        <div key={r.id} className="thread-reply">
                          <span className="thread-author">{r.authorId === user.userId ? '我' : r.authorId.slice(0, 8)}</span>
                          {r.body}
                        </div>
                      ))}
                    </div>
                  )}
                  {canReply && (
                    <div className="thread-input-row" onClick={(e) => e.stopPropagation()}>
                      <input
                        className="thread-input"
                        placeholder="回复…"
                        value={replyDraft[t.id] ?? ''}
                        onChange={(e) => setReplyDraft((d) => ({ ...d, [t.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submitReply(t.id)
                        }}
                      />
                      {(mine || roleAtLeast(user.role, 'editor')) && (
                        <button
                          type="button"
                          className="thread-icon-btn"
                          title="删除线程"
                          onClick={(e) => {
                            e.stopPropagation()
                            editor.commands.removeCommentMark(t.id)
                            comments.deleteThread(t.id)
                          }}
                        >
                          删
                        </button>
                      )}
                      <button
                        type="button"
                        className="thread-icon-btn"
                        title="标记为已解决"
                        onClick={(e) => {
                          e.stopPropagation()
                          comments.setResolved(t.id, true)
                        }}
                      >
                        ✓
                      </button>
                    </div>
                  )}
                </>
              )}
              {t.resolved && canReply && (
                <button
                  type="button"
                  className="thread-reopen"
                  onClick={(e) => {
                    e.stopPropagation()
                    comments.setResolved(t.id, false)
                  }}
                >
                  重新打开
                </button>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
