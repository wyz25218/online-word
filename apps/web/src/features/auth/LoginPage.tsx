import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { setSession, type SessionUser } from '../../api/client'

interface LoginResponse {
  accessToken: string
  refreshToken: string
  user: SessionUser
}

const STUB_HINT = '桩用户：alice / bob / carol，密码均为 {用户名}123'

export default function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('alice')
  const [password, setPassword] = useState('alice123')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(body.message ?? `登录失败（${res.status}）`)
      }
      const data = (await res.json()) as LoginResponse
      setSession(data)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-title">Online Word 登录</h1>
        <label className="login-field">
          用户名
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label className="login-field">
          密码
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="login-error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? '登录中…' : '登录'}
        </button>
        <p className="login-hint">{STUB_HINT}</p>
      </form>
    </div>
  )
}
