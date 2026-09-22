import RichTextEditor from './features/editor/RichTextEditor'
import type { AwarenessUser } from '@online-word/shared'

/** M0 测试用户池：每个浏览器标签随机取一个，便于观察多用户在线 */
const USER_POOL: Array<Omit<AwarenessUser, 'userId'>> = [
  { name: 'Alice', color: '#ef4444', role: 'editor' },
  { name: 'Bob', color: '#3b82f6', role: 'editor' },
  { name: 'Charlie', color: '#10b981', role: 'editor' },
  { name: 'Diana', color: '#f59e0b', role: 'editor' },
]

/** 生成当前标签的唯一用户（userId 取随机，存 sessionStorage 避免 HMR 抖动） */
function useCurrentUser(): AwarenessUser {
  const stored = sessionStorage.getItem('m0-user')
  if (stored) {
    try {
      return JSON.parse(stored) as AwarenessUser
    } catch {
      // fallthrough
    }
  }
  const idx = Math.floor(Math.random() * USER_POOL.length)
  const base = USER_POOL[idx]
  if (!base) throw new Error('USER_POOL 为空')
  const user: AwarenessUser = { ...base, userId: `m0-${Math.random().toString(36).slice(2, 8)}` }
  sessionStorage.setItem('m0-user', JSON.stringify(user))
  return user
}

/** 从 URL ?doc=xxx 取文档 id，缺省给一个固定值方便打开即看 */
function useDocId(): string {
  const params = new URLSearchParams(window.location.search)
  return params.get('doc') ?? 'm0-demo-doc'
}

export default function App() {
  const docId = useDocId()
  const user = useCurrentUser()
  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">Online Word · M0</span>
        <span className="app-docid">文档：{docId}</span>
        <a href={`?doc=m0-demo-doc`} className="app-link">示例文档</a>
      </header>
      <RichTextEditor docId={docId} user={user} />
    </div>
  )
}
