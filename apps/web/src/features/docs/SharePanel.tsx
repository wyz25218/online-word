import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addMember, listMembers, removeMember, setMemberRole } from '../../api/docs'
import { getShareLink, setShareLink } from '../../api/docs'
import type { DocRole, LinkShare } from '@online-word/shared'

/** 预置桩用户（与 apps/server UsersService STUB_USERS 保持一致）：邀请下拉用 */
const STUB_USERS: { userId: string; name: string }[] = [
  { userId: '11111111-1111-4111-8111-111111111111', name: 'Alice' },
  { userId: '22222222-2222-4222-8222-222222222222', name: 'Bob' },
  { userId: '33333333-3333-4333-8333-333333333333', name: 'Carol' },
]

const ROLE_LABEL: Record<DocRole, string> = {
  owner: '拥有者',
  editor: '编辑者',
  commenter: '评论者',
  viewer: '只读',
}

const MODE_LABEL: Record<LinkShare, string> = {
  private: '仅协作者（私有）',
  org: '组织内（暂同私有）',
  anyone_view: '知道链接的人可查看',
  anyone_edit: '知道链接的人可编辑',
}

interface Props {
  docId: string
  currentUserId: string
  onClose: () => void
}

/**
 * T2.5 分享面板：抽屉式覆盖层，owner 专属入口（DocEditorPage 头部「分享」按钮）。
 * - 成员列表：改角色 / 移除 / 邀请新成员
 * - 链接分享：四档切换 + 复制链接 + 重置链接
 */
export default function SharePanel({ docId, currentUserId, onClose }: Props) {
  const queryClient = useQueryClient()

  const membersQuery = useQuery({
    queryKey: ['members', docId],
    queryFn: () => listMembers(docId),
  })

  const shareQuery = useQuery({
    queryKey: ['share-link', docId],
    queryFn: () => getShareLink(docId),
  })

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['members', docId] })
    void queryClient.invalidateQueries({ queryKey: ['share-link', docId] })
  }

  // --- 成员操作 mutations ---
  const inviteMut = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Exclude<DocRole, 'owner'> }) =>
      addMember(docId, userId, role),
    onSuccess: invalidate,
  })
  const changeRoleMut = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Exclude<DocRole, 'owner'> }) =>
      setMemberRole(docId, userId, role),
    onSuccess: invalidate,
  })
  const removeMut = useMutation({
    mutationFn: (userId: string) => removeMember(docId, userId),
    onSuccess: invalidate,
  })

  // --- 分享模式 mutation ---
  const setLinkMut = useMutation({
    mutationFn: ({ mode, resetToken }: { mode: LinkShare; resetToken?: boolean }) =>
      setShareLink(docId, mode, resetToken),
    onSuccess: invalidate,
  })

  // --- 邀请表单状态 ---
  const [inviteUserId, setInviteUserId] = useState('')
  const [inviteRole, setInviteRole] = useState<Exclude<DocRole, 'owner'>>('viewer')
  const [inviteError, setInviteError] = useState<string | null>(null)

  const onInvite = (): void => {
    if (!inviteUserId.trim()) {
      setInviteError('请选择或输入要邀请的用户 ID')
      return
    }
    setInviteError(null)
    inviteMut.mutate(
      { userId: inviteUserId.trim(), role: inviteRole },
      {
        onSuccess: () => {
          setInviteUserId('')
        },
        onError: (err) => setInviteError((err as Error).message),
      },
    )
  }

  // --- 复制链接 ---
  const [copied, setCopied] = useState(false)
  const copyLink = async (token: string): Promise<void> => {
    const url = `${window.location.origin}/share/${token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 回退：创建临时 input 选中
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  // Esc 关闭
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const members = membersQuery.data ?? []
  const share = shareQuery.data

  return (
    <div className="share-overlay" onClick={onClose}>
      <div className="share-panel" onClick={(e) => e.stopPropagation()}>
        <header className="share-header">
          <h3>分享与权限</h3>
          <button className="btn btn-ghost" onClick={onClose} aria-label="关闭">✕</button>
        </header>

        {membersQuery.isLoading || shareQuery.isLoading ? (
          <p className="share-loading">加载中…</p>
        ) : membersQuery.isError || shareQuery.isError ? (
          <p className="share-error">加载失败：{(membersQuery.error ?? shareQuery.error as Error).message}</p>
        ) : (
          <div className="share-body">
            {/* ===== 成员列表 ===== */}
            <section className="share-section">
              <h4>协作者（{members.length}）</h4>
              <ul className="share-members">
                {members.map((m) => {
                  const isMe = m.userId === currentUserId
                  const isOwner = m.role === 'owner'
                  return (
                    <li key={m.userId} className="share-member">
                      <span className="user-chip" style={{ borderColor: m.color }}>
                        <span className="user-dot" style={{ background: m.color }} />
                        {m.name}
                      </span>
                      <span className="share-member-role">
                        {isOwner ? (
                          <span className="role-badge role-owner">{ROLE_LABEL.owner}</span>
                        ) : (
                          <select
                            value={m.role}
                            onChange={(e) => changeRoleMut.mutate({ userId: m.userId, role: e.target.value as Exclude<DocRole, 'owner'> })}
                            disabled={isMe}
                          >
                            <option value="editor">{ROLE_LABEL.editor}</option>
                            <option value="commenter">{ROLE_LABEL.commenter}</option>
                            <option value="viewer">{ROLE_LABEL.viewer}</option>
                          </select>
                        )}
                      </span>
                      <button
                        className="btn btn-ghost btn-danger"
                        disabled={isOwner || isMe || removeMut.isPending}
                        onClick={() => {
                          if (window.confirm(`确认移除 ${m.name}？`)) removeMut.mutate(m.userId)
                        }}
                      >
                        移除
                      </button>
                    </li>
                  )
                })}
              </ul>

              {/* 邀请新成员 */}
              <div className="share-invite">
                <select
                  value={STUB_USERS.some((u) => u.userId === inviteUserId) ? inviteUserId : ''}
                  onChange={(e) => setInviteUserId(e.target.value)}
                >
                  <option value="">选择预置用户…</option>
                  {STUB_USERS.map((u) => (
                    <option key={u.userId} value={u.userId}>{u.name}</option>
                  ))}
                </select>
                <input
                  placeholder="或粘贴用户 UUID"
                  value={STUB_USERS.some((u) => u.userId === inviteUserId) ? '' : inviteUserId}
                  onChange={(e) => setInviteUserId(e.target.value)}
                  onFocus={() => { /* clear placeholder state */ }}
                />
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Exclude<DocRole, 'owner'>)}>
                  <option value="editor">编辑者</option>
                  <option value="commenter">评论者</option>
                  <option value="viewer">只读</option>
                </select>
                <button className="btn btn-primary" onClick={onInvite} disabled={inviteMut.isPending}>
                  邀请
                </button>
                {inviteError && <span className="share-invite-error">{inviteError}</span>}
              </div>
            </section>

            {/* ===== 链接分享 ===== */}
            <section className="share-section">
              <h4>分享链接</h4>
              <label className="share-mode">
                访问权限：
                <select
                  value={share?.mode ?? 'private'}
                  onChange={(e) => {
                    if (!share) return
                    const mode = e.target.value as LinkShare
                    if (mode === share.mode) return // 没变就不发请求
                    // 切到 anyone_* 时：仅当原 token 为 null（首次开启）才自动生成；
                    // 用户要重置 token 必须点「重置链接」按钮，避免误操作让已复制的链接失效
                    const shouldResetToken =
                      (mode === 'anyone_view' || mode === 'anyone_edit') && !share.token
                    setLinkMut.mutate({ mode, resetToken: shouldResetToken })
                  }}
                  disabled={setLinkMut.isPending || !share}
                >
                  <option value="private">{MODE_LABEL.private}</option>
                  <option value="org">{MODE_LABEL.org}</option>
                  <option value="anyone_view">{MODE_LABEL.anyone_view}</option>
                  <option value="anyone_edit">{MODE_LABEL.anyone_edit}</option>
                </select>
                {setLinkMut.isError && <span className="share-mode-error">操作失败，请重试</span>}
              </label>

              {share && (share.mode === 'anyone_view' || share.mode === 'anyone_edit') ? (
                <div className="share-link-row">
                  <input
                    className="share-link-input"
                    readOnly
                    value={`${window.location.origin}/share/${share.token ?? ''}`}
                  />
                  <button className="btn btn-primary" onClick={() => copyLink(share.token!)}>
                    {copied ? '已复制 ✓' : '复制链接'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      if (window.confirm('重置链接后原链接立即失效，确定？')) {
                        setLinkMut.mutate({ mode: share.mode, resetToken: true })
                      }
                    }}
                    disabled={setLinkMut.isPending}
                  >
                    重置链接
                  </button>
                </div>
              ) : null}

              {share?.mode === 'org' && (
                <p className="share-hint">组织内模式暂同私有；等后续组织系统接入后生效</p>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
