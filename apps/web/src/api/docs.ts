import { apiFetch } from './client'

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
