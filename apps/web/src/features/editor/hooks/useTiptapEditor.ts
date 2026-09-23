import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import { roleAtLeast, type AwarenessUser } from '@online-word/shared'
import type { Editor } from '@tiptap/core'
import type { CollabHandles } from './useCollabDoc'

/**
 * 装配 Tiptap 编辑器。
 * 关键：协同模式下必须关闭 StarterKit 自带 history（用 y-prosemirror 的 undoManager），
 * 否则撤销会回滚他人内容。
 *
 * M0 注意：未启用 @tiptap/extension-collaboration-cursor。
 * 原因：Tiptap v3.31 的 Collaboration 改用 @tiptap/y-tiptap（fork），
 * 其 sync plugin key 与 cursor 扩展依赖的 y-prosemirror key 不互通，
 * 导致 cursor 的 createDecorations 读取 ySyncPluginKey.getState() 返回 undefined 而崩溃。
 * M0 用 awareness 自行渲染在线用户列表；精确远程光标在 M1 基于 @tiptap/y-tiptap 自实现。
 */
export function useTiptapEditor(
  handles: CollabHandles,
  user: AwarenessUser,
): Editor | null {
  return useEditor({
    // viewer/commenter 本地可编辑态关闭（双保险之一；网关侧连接级只读丢弃写消息）
    editable: roleAtLeast(user.role, 'editor'),
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        undoRedo: false, // ★ 协同必须关闭自带历史，改用 y-prosemirror 的 undoManager
      }),
      Placeholder.configure({
        placeholder: '开始输入，体验多人实时协同…',
      }),
      Collaboration.configure({
        document: handles.ydoc,
        field: 'prosemirror',
      }),
    ],
    content: '',
  })
}
