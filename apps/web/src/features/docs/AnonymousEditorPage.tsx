import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { resolveAnonymousShare, type AnonymousShareResponse } from '../../api/docs'
import { colorForUser, type AwarenessUser } from '@online-word/shared'
import RichTextEditor from '../editor/RichTextEditor'

/**
 * T2.5 匿名分享入口（公开路由，无 RequireAuth 守卫）：
 * ① 拿 URL token → GET /api/share/:token → { docId, docTitle, mode, anonymousUser, collabToken, expiresIn }
 * ② 将 anonymousUser 转为 AwarenessUser，collabToken 缓存在 useRef 里（续签时直接复用回调）
 * ③ RichTextEditor 按 mode 自动得到正确的 editable（anyone_view → editor 内部会按 role=viewer 置只读）
 *
 * 注：RichTextEditor 内部 editable 由 authorizedScope 和 roleAtLeast 双重决定；
 * 匿名身份 role 已在 internal membership 按 mode 正确映射（anyone_view→viewer, anyone_edit→editor），
 * 所以无需在此额外处理。
 */
export default function AnonymousEditorPage() {
  const { token } = useParams<{ token: string }>()

  const shareQuery = useQuery({
    queryKey: ['anonymous-share', token],
    queryFn: () => resolveAnonymousShare(token!),
    enabled: token !== undefined,
    retry: false,
  })

  // token 缓存：与 DocEditorPage 同样的新鲜度逻辑
  const tokenRef = useRef<{ token: string; expiresAt: number } | null>(null)
  // ⚠️ 匿名身份缓存：首次 resolveAnonymousShare 返回后缓存 userId，
  // 续签时传 anonId 参数复用同一身份（避免 awareness 用户跳变）
  const anonUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    const data = shareQuery.data
    if (data) {
      tokenRef.current = { token: data.collabToken, expiresAt: Date.now() + (data.expiresIn - 30) * 1000 }
      // 首次成功后，把 anon userId 钉住
      if (anonUserIdRef.current === null) anonUserIdRef.current = data.anonymousUser.userId
    }
  }, [shareQuery.data])

  const getToken = useCallback(async (): Promise<string> => {
    const cached = tokenRef.current
    if (cached && Date.now() < cached.expiresAt) return cached.token
    if (!token) throw new Error('缺少分享 token')
    // 续签：带上上一次的 anonId，让服务端复用同一身份签新 JWT
    const anonId = anonUserIdRef.current ?? undefined
    const data = await resolveAnonymousShare(token, anonId)
    // 保持 anonUserIdRef.current 不变（续签返回的 userId 应与传入相同，但若端点异常生成新的——以实际为准）
    anonUserIdRef.current = data.anonymousUser.userId
    tokenRef.current = { token: data.collabToken, expiresAt: Date.now() + (data.expiresIn - 30) * 1000 }
    return data.collabToken
  }, [token])

  // ⚠️ 所有 hooks 必须在条件 return 之前（React hooks 规则）
  const awarenessUser = useMemo<AwarenessUser | null>(() => {
    const data = shareQuery.data
    if (!data) return null
    return {
      userId: data.anonymousUser.userId,
      name: data.anonymousUser.name,
      color: colorForUser(data.anonymousUser.userId),
      role: data.mode === 'anyone_edit' ? 'editor' : 'viewer',
    }
  }, [shareQuery.data])

  if (token === undefined) return <Denied title="链接无效" hint="缺少分享 token" />

  if (shareQuery.isPending) return <Load text="正在打开分享文档…" />

  if (shareQuery.isError) {
    return <Denied title="无法访问此分享" hint={(shareQuery.error as Error).message} />
  }

  const data: AnonymousShareResponse = shareQuery.data

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/login" className="app-link">登录以创建/管理自己的文档</Link>
        <span className="app-title">{data.docTitle}</span>
        <span className="share-anon-badge">
          🔗 分享链接 · {data.mode === 'anyone_edit' ? '可编辑' : '只读'}
        </span>
        <span className="user-chip">
          <span className="user-dot" style={{ background: awarenessUser?.color ?? '#8a8f99' }} />
          {awarenessUser?.name ?? '访客'}
        </span>
      </header>
      <RichTextEditor docId={data.docId} user={awarenessUser!} getToken={getToken} />
    </div>
  )
}

function Load({ text }: { text: string }) {
  return (
    <div className="page-state">
      <span className="status-dot" style={{ background: '#ff9f0a' }} />
      {text}
    </div>
  )
}

function Denied({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="page-state">
      <p className="page-state-title">{title}</p>
      <p className="page-state-hint">{hint}</p>
      <Link to="/login" className="app-link">登录 →</Link>
    </div>
  )
}
