import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import * as Y from 'yjs'
import { COMMENTS_NAMESPACE, toCommentThreads } from '@online-word/shared'

/**
 * resolved 线程的正文灰色标记（docs/05 §锚点交互：resolved 标记灰色下划线）。
 * resolved 是线程级状态（存在 comments 命名空间，不在正文），因此用纯视图层
 * decoration 实现——不改正文数据，commenter 的 resolve 操作也不会触碰正文命名空间。
 * threads observeDeep → 强制重建 decorations（doc 不变仅 resolve 翻转的场景）。
 */
export function registerCommentResolvedDecorations(editor: Editor, ydoc: Y.Doc): () => void {
  const key = new PluginKey('commentResolvedDecorations')

  const build = (doc: PMNode): DecorationSet => {
    const threads = ydoc.getArray(COMMENTS_NAMESPACE)
    const resolvedIds = new Set(toCommentThreads(threads.toJSON()).filter((t) => t.resolved).map((t) => t.id))
    if (resolvedIds.size === 0) return DecorationSet.empty
    const decos: Decoration[] = []
    doc.descendants((node, pos) => {
      if (node.marks.length === 0) return
      for (const m of node.marks) {
        if (m.type.name === 'comment' && typeof m.attrs.threadId === 'string' && resolvedIds.has(m.attrs.threadId)) {
          decos.push(Decoration.inline(pos, pos + node.nodeSize, { class: 'comment-resolved' }))
        }
      }
    })
    return DecorationSet.create(doc, decos)
  }

  const plugin: Plugin<DecorationSet> = new Plugin<DecorationSet>({
    key,
    state: {
      init: (_config, state) => build(state.doc),
      apply: (tr, old) => (tr.docChanged || tr.getMeta(key) === true ? build(tr.doc) : old),
    },
    props: {
      decorations: (state) => plugin.getState(state),
    },
  })

  editor.registerPlugin(plugin)
  const rebuild = () => {
    if (editor.isDestroyed || editor.view.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setMeta(key, true))
  }
  ydoc.getArray(COMMENTS_NAMESPACE).observeDeep(rebuild)

  return () => {
    ydoc.getArray(COMMENTS_NAMESPACE).unobserveDeep(rebuild)
    if (!editor.isDestroyed) editor.unregisterPlugin(key)
  }
}
