import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import Image from '@tiptap/extension-image'
import Collaboration from '@tiptap/extension-collaboration'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { TaskList } from '@tiptap/extension-list/task-list'
import { TaskItem } from '@tiptap/extension-list/task-item'
import { Highlight } from '@tiptap/extension-highlight'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import { roleAtLeast, type AwarenessUser } from '@online-word/shared'
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import type { CollabHandles } from './useCollabDoc'
import { retryUpload, startImageUploads } from '../uploader'
import { CommentMark } from '../extensions/comment-mark'

// T2.2：代码块语法高亮引擎（common = 常用 37 种语言子集，避免全量 highlight.js 体积）
const lowlight = createLowlight(common)

/**
 * 装配 Tiptap 编辑器。
 * 关键：协同模式下必须关闭 StarterKit 自带 history（用 y-prosemirror 的 undoManager），
 * 否则撤销会回滚他人内容。
 *
 * T2.1 图片：Image 扩展 + 统一上传器（粘贴/拖拽在此拦截，工具栏入口由 Toolbar 调 startImageUploads）。
 * 节点仅存 URL+尺寸；上传态（uploadId/uploadState attrs）随协同广播、完成后清空。
 *
 * T2.2 富格式：Link/Underline/HorizontalRule 由 StarterKit v3 内置直接启用；
 * Table 四件套、TaskList/TaskItem、Highlight、CodeBlockLowlight 显式挂载。
 * CodeBlockLowlight 与 StarterKit 的 CodeBlock 同名节点（codeBlock），必须 codeBlock: false 防重复注册。
 */
export function useTiptapEditor(
  handles: CollabHandles,
  user: AwarenessUser,
  docId: string,
): Editor | null {
  return useEditor({
    // viewer/commenter 本地可编辑态关闭（双保险之一；网关侧连接级只读丢弃写消息）
    editable: roleAtLeast(user.role, 'editor'),
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        undoRedo: false, // ★ 协同必须关闭自带历史，改用 y-prosemirror 的 undoManager
        codeBlock: false, // ★ 用 CodeBlockLowlight 替换同名节点，防重复注册
      }),
      Placeholder.configure({
        placeholder: '开始输入，体验多人实时协同…',
      }),
      // T1.9：字数统计（不设 limit，仅统计；storage.characters()/words() 由工具栏读取）
      CharacterCount.configure({ limit: null }),
      // T2.1：图片节点（块级）；自定义上传态 attrs 随 Y.Doc 同步
      Image.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            uploadId: {
              default: null,
              parseHTML: (el) => el.getAttribute('data-upload-id'),
              renderHTML: (attrs) => (attrs.uploadId ? { 'data-upload-id': attrs.uploadId } : {}),
            },
            uploadState: {
              default: null,
              parseHTML: (el) => el.getAttribute('data-upload-state'),
              renderHTML: (attrs) => (attrs.uploadState ? { 'data-upload-state': attrs.uploadState } : {}),
            },
          }
        },
      }).configure({ inline: false, allowBase64: false }),
      // T2.2：表格四件套（y-prosemirror 原生同步表格结构与单元格内容，C08 协同基础）
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      // T2.2：任务列表（checked attr 随协同同步）；nested 允许任务项内嵌套子列表
      TaskList,
      TaskItem.configure({ nested: true }),
      // T2.2：高亮标记（mark）
      Highlight,
      // T2.2：代码块语法高亮（同名节点替换 StarterKit 的普通 CodeBlock）
      CodeBlockLowlight.configure({ lowlight }),
      // T2.3：评论锚点 mark（excludes:'' 允许多线程重叠；锚点随 CRDT 跟随文本）
      CommentMark,
      Collaboration.configure({
        document: handles.ydoc,
        field: 'prosemirror',
      }),
    ],
    content: '',
    editorProps: {
      // ── 拦截 1/2：粘贴文件（含截图）→ 统一上传器 ──
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? [])
        if (files.length === 0) return false
        event.preventDefault()
        startImageUploads(view, docId, files)
        return true
      },
      // ── 拦截 2/2：拖拽文件 → 落点处插入占位并上传 ──
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? [])
        if (files.length === 0) return false
        event.preventDefault()
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
        startImageUploads(view, docId, files, coords?.pos)
        return true
      },
      // 失败占位点击重试（C16 弱网失败重试）
      handleClickOn: (view: EditorView, _pos: number, node, nodePos: number, event) => {
        if (node.type.name !== 'image' || node.attrs.uploadState !== 'error' || !node.attrs.uploadId) return false
        if (!view.editable) return false
        event.preventDefault()
        void nodePos
        retryUpload(view, docId, node.attrs.uploadId as string)
        return true
      },
    },
  })
}
