import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getCollabToken, getDoc, type DocDetail } from '../../api/docs'
import { ApiError, getSession } from '../../api/client'
import type { AwarenessUser } from '@online-word/shared'
import RichTextEditor from '../editor/RichTextEditor'
import { UserBadge } from './DocsListPage'

/**
 * 编辑页：先查文档元数据与我的角色（无权限态绝不建 WS 连接），
 * 再用 docId 换 WS token，最后才挂载协同编辑器。
 */
export default function DocEditorPage() {
  const { id } = useParams<{ id: string }>()
  const user = getSession()!.user

  const docQuery = useQuery({
    queryKey: ['doc', id],
    queryFn: () => getDoc(id!),
    enabled: id !== undefined,
    retry: (_failureCount, error) => !(error instanceof ApiError) || error.status >= 500,
  })

  const tokenQuery = useQuery({
    queryKey: ['collab-token', id],
    queryFn: () => getCollabToken(id!),
    enabled: docQuery.isSuccess,
    // token 5min 过期：本次会话只取一次；断线重连的续签策略在 T1.6 处理
    staleTime: 4 * 60 * 1000,
    retry: false,
  })

  const awarenessUser = useMemo<AwarenessUser | null>(() => {
    const doc = docQuery.data
    if (doc === undefined) return null
    return { userId: user.userId, name: user.name, color: user.color, role: doc.role as AwarenessUser['role'] }
  }, [docQuery.data, user])

  if (id === undefined) return <DeniedState title="链接无效" hint="缺少文档 ID" />

  if (docQuery.isPending) return <LoadState text="正在打开文档…" />

  if (docQuery.isError) {
    const status = docQuery.error instanceof ApiError ? docQuery.error.status : 0
    return (
      <DeniedState
        title={status === 404 ? '无权访问或文档不存在' : '打开失败'}
        hint={status === 404 ? '你可能不是该文档的协作者，或文档已被删除' : (docQuery.error as Error).message}
      />
    )
  }

  const doc: DocDetail = docQuery.data

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="app-link">
          ← 文档列表
        </Link>
        <span className="app-title">{doc.title}</span>
        <UserBadge user={user} />
      </header>
      {tokenQuery.isPending && <LoadState text="正在建立协同连接…" />}
      {tokenQuery.isError && <DeniedState title="获取协同凭证失败" hint={(tokenQuery.error as Error).message} />}
      {tokenQuery.isSuccess && awarenessUser !== null && (
        <RichTextEditor docId={id} user={awarenessUser} token={tokenQuery.data.token} />
      )}
    </div>
  )
}

function LoadState({ text }: { text: string }) {
  return (
    <div className="page-state">
      <span className="status-dot" style={{ background: '#ff9f0a' }} />
      {text}
    </div>
  )
}

function DeniedState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="page-state">
      <p className="page-state-title">{title}</p>
      <p className="page-state-hint">{hint}</p>
      <Link to="/" className="app-link">
        ← 返回文档列表
      </Link>
    </div>
  )
}
