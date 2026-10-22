import * as Y from 'yjs'
import { apiFetch } from './client'

/** revisions 相关 API（T2.4 版本历史） */

export interface RevisionSummary {
  id: string
  authorId: string | null
  label: string | null
  plainText: string | null
  wordCount: number | null
  createdAt: string // ISO
}

export interface RevisionDetail extends RevisionSummary {
  proseMirrorJson: string
}

/** 版本列表（viewer+，不含二进制 state） */
export function listRevisions(docId: string): Promise<RevisionSummary[]> {
  return apiFetch(`/docs/${docId}/revisions`)
}

/**
 * 手动保存版本：client 编码本地 Y.Doc（state + ProseMirror JSON + 纯文本）。
 * 仅 editor+ 可调用。
 */
export function createRevision(input: {
  docId: string
  stateBase64: string
  proseMirrorJson: string
  plainText?: string
  wordCount?: number
  label?: string
}): Promise<RevisionSummary> {
  return apiFetch(`/docs/${input.docId}/revisions`, {
    method: 'POST',
    body: JSON.stringify({
      stateBase64: input.stateBase64,
      proseMirrorJson: input.proseMirrorJson,
      plainText: input.plainText ?? null,
      wordCount: input.wordCount ?? null,
      label: input.label ?? null,
    }),
  })
}

/** 版本详情（viewer+，含 ProseMirror JSON 供只读预览/恢复） */
export function getRevisionDetail(docId: string, revId: string): Promise<RevisionDetail> {
  return apiFetch(`/docs/${docId}/revisions/${revId}`)
}

/**
 * 恢复版本（owner 专属）：client 驱动——拿到 ProseMirror JSON 后 editor.setContent()
 * 以一次正常 Yjs update 广播，所有人自然收敛。
 */
export function restoreRevision(docId: string, revId: string): Promise<RevisionDetail> {
  return apiFetch(`/docs/${docId}/revisions/${revId}/restore`, { method: 'POST' })
}

/**
 * 工具：从 Y.Doc 编码手动保存所需的全部数据。
 * 一次性调用，避免主组件多次 encode。
 */
export function encodeRevisionSnapshot(ydoc: Y.Doc): {
  stateBase64: string
  proseMirrorJson: string
  plainText: string
  wordCount: number
} {
  // Yjs 二进制 → base64（Node/Browser 通用）
  const stateBytes = Y.encodeStateAsUpdate(ydoc)
  let binary = ''
  for (let i = 0; i < stateBytes.byteLength; i++) binary += String.fromCharCode(stateBytes[i]!)
  const stateBase64 = btoa(binary)

  // Y.XmlFragment → ProseMirror JSON：用现有 Collaboration 扩展的 field='prosemirror'
  // Tiptap 的 editor.getJSON() 即来自此 fragment 的 PM 节点
  // 这里简化为从 XML fragment 抽纯文本（手动保存路径实际由调用方传入 proseMirrorJson）
  // —— 但为了 RevisionsPanel 内部能独立调用，这里只提供 state + 纯文本
  const plainText = ydoc.getXmlFragment('prosemirror').toString()

  // proseMirrorJson 实际由 Tiptap editor.getJSON() 生成，encodeRevisionSnapshot 仅做 Yjs 层
  // 调用方（RevisionsPanel 的手动保存按钮）会传入 editor.getJSON() 结果
  return {
    stateBase64,
    proseMirrorJson: '', // 占位，实际由 editor.getJSON() 提供
    plainText,
    wordCount: plainText.replace(/\s+/g, '').length,
  }
}
