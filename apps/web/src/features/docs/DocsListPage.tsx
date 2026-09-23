import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createDoc, deleteDoc, listDocs, renameDoc } from '../../api/docs'
import { clearSession, getSession, type SessionUser } from '../../api/client'

const ROLE_LABEL: Record<string, string> = {
  owner: '拥有者',
  editor: '编辑者',
  commenter: '评论者',
  viewer: '只读',
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

export default function DocsListPage() {
  const user = getSession()!.user
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [newTitle, setNewTitle] = useState('')

  const docsQuery = useQuery({
    queryKey: ['docs', keyword],
    queryFn: () => listDocs({ keyword: keyword || undefined }),
  })

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['docs'] })
  }

  const createMutation = useMutation({
    mutationFn: () => createDoc(newTitle.trim() || undefined),
    onSuccess: invalidate,
    onSettled: () => setNewTitle(''),
  })
  const renameMutation = useMutation({
    mutationFn: ({ docId, current }: { docId: string; current: string }) => {
      const title = window.prompt('重命名文档', current)?.trim()
      return title ? renameDoc(docId, title) : Promise.reject(new Error('cancelled'))
    },
    onSuccess: invalidate,
  })
  const deleteMutation = useMutation({
    mutationFn: (docId: string) => {
      if (!window.confirm('确认删除该文档？（软删除，可在列表外恢复前找回数据）')) {
        return Promise.reject(new Error('cancelled'))
      }
      return deleteDoc(docId)
    },
    onSuccess: invalidate,
  })

  const isBusy = createMutation.isPending || renameMutation.isPending || deleteMutation.isPending

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">Online Word · M1</span>
        <UserBadge user={user} />
      </header>
      <main className="docs-page">
        <div className="docs-toolbar">
          <form
            className="docs-new"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              createMutation.mutate()
            }}
          >
            <input
              className="docs-new-input"
              placeholder="新文档标题（可留空）"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              maxLength={200}
            />
            <button className="btn btn-primary" type="submit" disabled={isBusy}>
              新建文档
            </button>
          </form>
          <input
            className="docs-search"
            placeholder="搜索标题关键字…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            maxLength={100}
          />
        </div>

        {docsQuery.isPending && <p className="docs-empty">加载中…</p>}
        {docsQuery.isError && <p className="docs-empty">加载失败：{(docsQuery.error as Error).message}</p>}
        {docsQuery.data && docsQuery.data.items.length === 0 && <p className="docs-empty">还没有文档，新建一篇试试</p>}

        <ul className="docs-list">
          {docsQuery.data?.items.map((doc) => (
            <li key={doc.id} className="doc-card">
              <Link to={`/docs/${doc.id}`} className="doc-card-title">
                {doc.title}
              </Link>
              <span className={`role-badge role-${doc.role}`}>{ROLE_LABEL[doc.role] ?? doc.role}</span>
              <span className="doc-card-time">更新于 {formatTime(doc.updatedAt)}</span>
              <span className="doc-card-actions">
                <button
                  className="btn btn-ghost"
                  disabled={isBusy || (doc.role !== 'owner' && doc.role !== 'editor')}
                  onClick={() => renameMutation.mutate({ docId: doc.id, current: doc.title })}
                >
                  重命名
                </button>
                <button
                  className="btn btn-ghost btn-danger"
                  disabled={isBusy || doc.role !== 'owner'}
                  onClick={() => deleteMutation.mutate(doc.id)}
                >
                  删除
                </button>
              </span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}

export function UserBadge({ user }: { user: SessionUser }) {
  return (
    <span className="user-badge">
      <span className="user-dot" style={{ background: user.color }} />
      {user.name}
      <button
        className="btn btn-ghost"
        onClick={() => {
          clearSession()
          window.location.assign('/login')
        }}
      >
        退出
      </button>
    </span>
  )
}
