import { useCallback, useEffect, useState } from 'react'
import * as Y from 'yjs'
import type { Editor } from '@tiptap/core'
import { COMMENTS_NAMESPACE, toCommentThreads, type CommentReply, type CommentThread } from '@online-word/shared'

/**
 * 评论线程视图与写操作（docs/04 §6，T2.3）：
 * 读：订阅 comments 命名空间 observeDeep → 归一为 CommentThread[]（createdAt 升序）。
 * 写：直接操作 Y 结构（随协同广播 + 网关抽取回写），线程/回复/resolve 都在评论通道，
 *     不触碰正文命名空间（commenter 可执行）。
 */

function newReplyMap(reply: Omit<CommentReply, never>): Y.Map<unknown> {
  const m = new Y.Map()
  m.set('id', reply.id)
  m.set('authorId', reply.authorId)
  m.set('body', reply.body)
  m.set('createdAt', reply.createdAt)
  return m
}

export interface CommentsApi {
  threads: CommentThread[]
  /** 新建线程（同时编辑器侧 setComment 打锚点由调用方用 editor 命令完成） */
  pushThread: (thread: Omit<CommentThread, 'replies'>) => void
  addReply: (threadId: string, reply: CommentReply) => void
  setResolved: (threadId: string, resolved: boolean) => void
  deleteThread: (threadId: string) => void
}

export function useComments(ydoc: Y.Doc): CommentsApi {
  const [threads, setThreads] = useState<CommentThread[]>([])

  useEffect(() => {
    const arr = ydoc.getArray(COMMENTS_NAMESPACE)
    const refresh = () => {
      const list = toCommentThreads(arr.toJSON())
      list.sort((a, b) => a.createdAt - b.createdAt)
      setThreads(list)
    }
    refresh()
    arr.observeDeep(refresh)
    return () => {
      arr.unobserveDeep(refresh)
    }
  }, [ydoc])

  const pushThread = useCallback(
    (thread: Omit<CommentThread, 'replies'>) => {
      const map = new Y.Map()
      map.set('id', thread.id)
      map.set('authorId', thread.authorId)
      map.set('body', thread.body)
      map.set('resolved', thread.resolved)
      map.set('createdAt', thread.createdAt)
      map.set('replies', new Y.Array())
      ydoc.getArray(COMMENTS_NAMESPACE).push([map])
    },
    [ydoc],
  )

  const addReply = useCallback(
    (threadId: string, reply: CommentReply) => {
      const arr = ydoc.getArray(COMMENTS_NAMESPACE)
      for (let i = 0; i < arr.length; i++) {
        const t = arr.get(i)
        if (t instanceof Y.Map && t.get('id') === threadId) {
          const replies = t.get('replies')
          if (replies instanceof Y.Array) replies.push([newReplyMap(reply)])
          return
        }
      }
    },
    [ydoc],
  )

  const setResolved = useCallback(
    (threadId: string, resolved: boolean) => {
      const arr = ydoc.getArray(COMMENTS_NAMESPACE)
      for (let i = 0; i < arr.length; i++) {
        const t = arr.get(i)
        if (t instanceof Y.Map && t.get('id') === threadId) {
          t.set('resolved', resolved)
          return
        }
      }
    },
    [ydoc],
  )

  const deleteThread = useCallback(
    (threadId: string) => {
      const arr = ydoc.getArray(COMMENTS_NAMESPACE)
      for (let i = 0; i < arr.length; i++) {
        const t = arr.get(i)
        if (t instanceof Y.Map && t.get('id') === threadId) {
          arr.delete(i, 1)
          return
        }
      }
    },
    [ydoc],
  )

  return { threads, pushThread, addReply, setResolved, deleteThread }
}

/** 在文档中查找某线程锚点的完整范围（定位滚动 + 锚点存活检测用） */
export function findThreadRange(editor: Editor, threadId: string): { from: number; to: number } | null {
  let from = Number.POSITIVE_INFINITY
  let to = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.marks.some((m) => m.type.name === 'comment' && m.attrs.threadId === threadId)) {
      from = Math.min(from, pos)
      to = Math.max(to, pos + node.nodeSize)
    }
  })
  return to >= 0 ? { from, to } : null
}
