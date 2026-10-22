import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getCollabToken, getDoc, type DocDetail } from '../../api/docs'
import { ApiError, getSession } from '../../api/client'
import { colorForUser, type AwarenessUser } from '@online-word/shared'
import RichTextEditor from '../editor/RichTextEditor'
import { UserBadge } from './DocsListPage'
import SharePanel from './SharePanel'

/**
 * 编辑页：先查文档元数据与我的角色（无权限态绝不建 WS 连接），
 * 再挂载协同编辑器。WS token 由 getToken 回调按需获取：
 * 初始连接与断线重连共用该回调，token 过期时自动重新换取（T1.6 续签）。
 *
 * T2.5：owner 可点击头部「分享」按钮打开 SharePanel（成员管理 + 链接分享）。
 */
export default function DocEditorPage() {
  const { id } = useParams<{ id: string }>()
  const user = getSession()!.user
  const [showShare, setShowShare] = useState(false)

  const docQuery = useQuery({
    queryKey: ['doc', id],
    queryFn: () => getDoc(id!),
    enabled: id !== undefined,
    retry: (_failureCount, error) => !(error instanceof ApiError) || error.status >= 500,
  })

  // token 缓存：5min 过期，预留 30s 网络缓冲。命中新鲜缓存直接复用（避免每次重连都请求），
  // 过期则重新 GET /collab/token（403 = 无权限 → getToken 抛错 → provider 认证失败 → denied）
  const tokenRef = useRef<{ token: string; expiresAt: number } | null>(null)

  const tokenQuery = useQuery({
    queryKey: ['collab-token', id],
    queryFn: () => getCollabToken(id!),
    enabled: docQuery.isSuccess,
    staleTime: 4 * 60 * 1000,
    retry: false,
  })

  useEffect(() => {
    const data = tokenQuery.data
    if (data) tokenRef.current = { token: data.token, expiresAt: Date.now() + (data.expiresIn - 30) * 1000 }
  }, [tokenQuery.data])

  const getToken = useCallback(async (): Promise<string> => {
    if (id === undefined) throw new Error('缺少文档 ID')
    const cached = tokenRef.current
    if (cached && Date.now() < cached.expiresAt) return cached.token
    const data = await getCollabToken(id)
    tokenRef.current = { token: data.token, expiresAt: Date.now() + (data.expiresIn - 30) * 1000 }
    return data.token
  }, [id])

  const awarenessUser = useMemo<AwarenessUser | null>(() => {
    const doc = docQuery.data
    if (doc === undefined) return null
    // 颜色按 userId 哈希稳定取色（docs/04 §5）：同一用户在任何文档、任何端颜色一致
    return { userId: user.userId, name: user.name, color: colorForUser(user.userId), role: doc.role as AwarenessUser['role'] }
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
  const isOwner = doc.role === 'owner'

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="app-link">
          ← 文档列表
        </Link>
        <span className="app-title">{doc.title}</span>
        {isOwner && (
          <button className="btn btn-ghost" onClick={() => setShowShare(true)}>
            🔗 分享
          </button>
        )}
        <UserBadge user={user} />
      </header>
      {tokenQuery.isPending && <LoadState text="正在建立协同连接…" />}
      {tokenQuery.isError && <DeniedState title="获取协同凭证失败" hint={(tokenQuery.error as Error).message} />}
      {tokenQuery.isSuccess && awarenessUser !== null && <RichTextEditor docId={id} user={awarenessUser} getToken={getToken} />}
      {showShare && <SharePanel docId={id} currentUserId={user.userId} onClose={() => setShowShare(false)} />}
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
