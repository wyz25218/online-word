import { apiFetch } from './client'
import type { DocRole, LinkShare } from '@online-word/shared'

/** 与 server DocSummary/DocDetail 对齐（JSON 后 Date 均为 ISO 字符串） */
export interface DocSummary {
  id: string
  title: string
  ownerId: string
  role: string
  createdAt: string
  updatedAt: string
}

export interface DocDetail extends DocSummary {
  currentVersion: string
  lastActiveAt: string
}

export interface DocListResponse {
  items: DocSummary[]
  total: number
  page: number
  pageSize: number
}

export interface CollabTokenResponse {
  docId: string
  token: string
  expiresIn: number
}

export interface DocMemberView {
  userId: string
  name: string
  color: string
  role: DocRole
}

export interface DocShareLink {
  docId: string
  mode: LinkShare
  token: string | null
  updatedAt: string
}

/** 匿名端点响应（公开，不走 apiFetch——端点不加 Authorization） */
export interface AnonymousShareResponse {
  docId: string
  docTitle: string
  mode: LinkShare
  anonymousUser: { userId: string; name: string; color: string }
  collabToken: string
  expiresIn: number
}

export function listDocs(params: { page?: number; pageSize?: number; keyword?: string } = {}): Promise<DocListResponse> {
  const qs = new URLSearchParams()
  if (params.page !== undefined) qs.set('page', String(params.page))
  if (params.pageSize !== undefined) qs.set('pageSize', String(params.pageSize))
  if (params.keyword) qs.set('keyword', params.keyword)
  const query = qs.toString()
  return apiFetch(`/docs${query ? `?${query}` : ''}`)
}

export function createDoc(title?: string): Promise<DocDetail> {
  return apiFetch('/docs', { method: 'POST', body: JSON.stringify(title ? { title } : {}) })
}

export function getDoc(docId: string): Promise<DocDetail> {
  return apiFetch(`/docs/${docId}`)
}

export function renameDoc(docId: string, title: string): Promise<DocDetail> {
  return apiFetch(`/docs/${docId}`, { method: 'PATCH', body: JSON.stringify({ title }) })
}

export function deleteDoc(docId: string): Promise<void> {
  return apiFetch(`/docs/${docId}`, { method: 'DELETE' })
}

/** 打开编辑页前换取绑定 docId 的 WS token（5min 有效，重连需重新获取） */
export function getCollabToken(docId: string): Promise<CollabTokenResponse> {
  return apiFetch(`/collab/token?docId=${encodeURIComponent(docId)}`)
}

// ========== T1.8 成员管理（已在 server 实现，前端首次封装） ==========

export function listMembers(docId: string): Promise<DocMemberView[]> {
  return apiFetch(`/docs/${docId}/members`)
}

export function addMember(docId: string, userId: string, role: Exclude<DocRole, 'owner'>): Promise<DocMemberView> {
  return apiFetch(`/docs/${docId}/members`, { method: 'POST', body: JSON.stringify({ userId, role }) })
}

export function setMemberRole(docId: string, userId: string, role: Exclude<DocRole, 'owner'>): Promise<DocMemberView> {
  return apiFetch(`/docs/${docId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) })
}

export function removeMember(docId: string, userId: string): Promise<void> {
  return apiFetch(`/docs/${docId}/members/${userId}`, { method: 'DELETE' })
}

// ========== T2.5 分享与链接 ==========

export function getShareLink(docId: string): Promise<DocShareLink> {
  return apiFetch(`/docs/${docId}/share-link`)
}

export function setShareLink(
  docId: string,
  mode: LinkShare,
  resetToken?: boolean,
): Promise<DocShareLink> {
  const body: Record<string, unknown> = { mode }
  if (resetToken !== undefined) body.resetToken = resetToken
  return apiFetch(`/docs/${docId}/share-link`, { method: 'PUT', body: JSON.stringify(body) })
}

/**
 * T2.5 匿名分享公开端点——不走 apiFetch（端点不加 Authorization）。
 * 直接 fetch，错误处理与 apiFetch 相同形态（抛含 status + message 的 Error）。
 * @param anonId 续签用：传入上一次返回的 anonymousUser.userId，端点复用它签新 JWT
 */
export async function resolveAnonymousShare(token: string, anonId?: string): Promise<AnonymousShareResponse> {
  const url = anonId
    ? `/api/share/${encodeURIComponent(token)}?anonId=${encodeURIComponent(anonId)}`
    : `/api/share/${encodeURIComponent(token)}`
  const res = await fetch(url)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ message: res.statusText }))) as { message?: string }
    throw new Error(body.message ?? res.statusText)
  }
  return (await res.json()) as AnonymousShareResponse
}
