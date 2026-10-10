/**
 * 评论数据契约（docs/04 §6，T2.3）。
 *
 * Y.Doc 顶层命名空间：`ydoc.getArray('comments')`，元素为线程 Y.Map：
 *   { id, authorId, body, resolved, createdAt, replies: Y.Array<Y.Map> }
 * 正文锚点：自研 CommentMark（mark.attrs.threadId = 线程 id），随 CRDT 自动跟随文本。
 *
 * 本文件只放纯类型与防御式转换（shared 禁止引入运行时依赖）；
 * Y.Map 的构造由各端自行完成（web/collab 都直接依赖 yjs）。
 */

/** Y.Doc 评论命名空间名（三端共认，网关按此做 commenter 粒度写权限判断） */
export const COMMENTS_NAMESPACE = 'comments'

export interface CommentReply {
  id: string
  authorId: string
  body: string
  /** epoch ms（Y 侧统一用 number，落库时由 server 转 Timestamptz） */
  createdAt: number
}

export interface CommentThread {
  /** 线程 id = 首评 id = CommentMark.attrs.threadId */
  id: string
  authorId: string
  body: string
  /** 线程级解决状态：不物理删除，UI 折叠为灰色标记 */
  resolved: boolean
  createdAt: number
  replies: CommentReply[]
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * 线程快照的防御式转换（web 端从 Y.Map.toJSON()、collab 端从 Y.Map 直接读均可）。
 * 任何字段缺失/类型不符都回落空值，绝不抛错——坏数据只影响展示不炸同步链路。
 */
export function toCommentThreads(raw: unknown): CommentThread[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const t = item as Record<string, unknown>
    const id = asString(t.id)
    if (id === '') return []
    const replies = Array.isArray(t.replies)
      ? t.replies.flatMap((r) => {
          if (typeof r !== 'object' || r === null) return []
          const rep = r as Record<string, unknown>
          const repId = asString(rep.id)
          if (repId === '') return []
          return [
            {
              id: repId,
              authorId: asString(rep.authorId),
              body: asString(rep.body),
              createdAt: asNumber(rep.createdAt),
            },
          ]
        })
      : []
    return [
      {
        id,
        authorId: asString(t.authorId),
        body: asString(t.body),
        resolved: t.resolved === true,
        createdAt: asNumber(t.createdAt),
        replies,
      },
    ]
  })
}
