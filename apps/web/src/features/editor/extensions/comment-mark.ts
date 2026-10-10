import { Mark, mergeAttributes } from '@tiptap/core'

/**
 * 评论锚点 mark（docs/04 §6，T2.3）：
 * - attrs.threadId 指向 comments 命名空间中的线程 id，锚点随 CRDT 自动跟随文本移动
 *   （不存易失效的数字 offset），他人在锚点前后/内部插入、拆段、删字都不漂移。
 * - excludes: '' —— 同位置允许多个不同线程的 mark 重叠（同名 mark 默认互斥会互相顶掉）。
 * - inclusive: false —— 光标在锚点末尾继续输入不延续评论高亮。
 */
export const CommentMark = Mark.create({
  name: 'comment',
  excludes: '',
  inclusive: false,

  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-thread-id'),
        renderHTML: (attrs) => {
          if (typeof attrs.threadId !== 'string' || attrs.threadId === '') return {}
          return { 'data-thread-id': attrs.threadId }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-thread-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'comment-mark' }), 0]
  },

  addCommands() {
    return {
      setComment:
        (threadId: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { threadId }),
      /** 全文档移除指定线程的锚点（删除线程时调用；Mark 实例匹配只删该 threadId） */
      removeCommentMark:
        (threadId: string) =>
        ({ tr, state }) => {
          const markType = state.schema.marks[this.name]
          if (markType === undefined) return false
          state.doc.descendants((node, pos) => {
            if (node.marks.length === 0) return
            for (const m of node.marks) {
              if (m.type === markType && m.attrs.threadId === threadId) {
                tr.removeMark(pos, pos + node.nodeSize, m)
              }
            }
          })
          return true
        },
    }
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      setComment: (threadId: string) => ReturnType
      removeCommentMark: (threadId: string) => ReturnType
    }
  }
}
