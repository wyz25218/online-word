/**
 * 最小 API 客户端：
 * - localStorage 存 accessToken / refreshToken / user
 * - 统一附加 Authorization 头
 * - 401 时用 refreshToken 无感续签一次并重放请求；续签失败清会话回登录页
 */

const ACCESS_KEY = 'ow.accessToken'
const REFRESH_KEY = 'ow.refreshToken'
const USER_KEY = 'ow.user'

export interface SessionUser {
  userId: string
  name: string
  color: string
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface Session {
  accessToken: string
  refreshToken: string
  user: SessionUser
}

export function getSession(): Session | null {
  const accessToken = localStorage.getItem(ACCESS_KEY)
  const refreshToken = localStorage.getItem(REFRESH_KEY)
  const rawUser = localStorage.getItem(USER_KEY)
  if (!accessToken || !refreshToken || !rawUser) return null
  try {
    return { accessToken, refreshToken, user: JSON.parse(rawUser) as SessionUser }
  } catch {
    return null
  }
}

export function setSession(session: Session): void {
  localStorage.setItem(ACCESS_KEY, session.accessToken)
  localStorage.setItem(REFRESH_KEY, session.refreshToken)
  localStorage.setItem(USER_KEY, JSON.stringify(session.user))
}

export function clearSession(): void {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(USER_KEY)
}

async function refreshSession(): Promise<boolean> {
  const session = getSession()
  if (!session) return false
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  })
  if (!res.ok) {
    clearSession()
    return false
  }
  const data = (await res.json()) as { accessToken: string; refreshToken: string; user: SessionUser }
  setSession(data)
  return true
}

/** 统一请求入口：401 → 续签一次重放；续签失败跳登录页 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const doFetch = (): Promise<Response> =>
    fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        authorization: `Bearer ${getSession()?.accessToken ?? ''}`,
        ...init.headers,
      },
    })

  let res = await doFetch()
  if (res.status === 401) {
    const ok = await refreshSession()
    if (!ok) {
      clearSession()
      window.location.assign('/login')
      throw new ApiError(401, '登录已过期，请重新登录')
    }
    res = await doFetch()
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ message: res.statusText }))) as { message?: string }
    throw new ApiError(res.status, body.message ?? res.statusText)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
