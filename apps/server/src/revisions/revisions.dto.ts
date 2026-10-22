import { z } from 'zod'

/**
 * T2.4 版本历史 DTOs。
 *
 * 两条保存路径：
 *   - 手动保存：client 编码本地 Y.Doc 后 POST revisions（state 为 base64 字符串）
 *   - 定时保存：collab 网关 encodeStateAsUpdate → POST internal 接口（走二进制）
 *
 * state 字段在 HTTP JSON 通道用 base64 传输（node Buffer ↔ base64 双向无损）。
 */

// ---- 手动保存版本（client → server） ----
export const CreateRevisionSchema = z
  .object({
    /** Y.Doc encodeStateAsUpdate 的二进制，base64 编码 */
    stateBase64: z.string().min(1).max(10_000_000),
    /** Tiptap ProseMirror JSON（JSON 字符串），供列表/预览/恢复使用 */
    proseMirrorJson: z.string().min(1).max(20_000_000),
    /** 纯文本（可选，冗余便于列表查询） */
    plainText: z.string().max(1_000_000).optional(),
    /** 字数（可选） */
    wordCount: z.number().int().nonnegative().optional(),
    /** 用户自定义标签（可选） */
    label: z.string().trim().max(200).optional(),
  })
  .strict()

export type CreateRevisionInput = z.infer<typeof CreateRevisionSchema>

// ---- collab 定时保存（二进制，走内部门户） ----
export const InternalRevisionPayloadSchema = z
  .object({
    /** ProseMirror JSON 字符串（collab 无 Tiptap schema，定时保存可空；手动保存路径由 client 提供） */
    proseMirrorJson: z.string().max(20_000_000).optional(),
    plainText: z.string().max(1_000_000).optional(),
    wordCount: z.number().int().nonnegative().optional(),
  })
  .strict()

export type InternalRevisionPayload = z.infer<typeof InternalRevisionPayloadSchema>

// ---- 返回给前端的类型 ----

/** 列表项：不含 state（二进制仅在详情/恢复时返回） */
export interface RevisionSummary {
  id: string
  /** authorId 为 null 时表示定时自动保存 */
  authorId: string | null
  label: string | null
  plainText: string | null
  wordCount: number | null
  createdAt: Date
}

/** 版本详情：供只读预览使用，返回 ProseMirror JSON 而非二进制 state */
export interface RevisionDetail extends RevisionSummary {
  /** ProseMirror JSON 字符串（前端可直接 setContent 到独立预览实例） */
  proseMirrorJson: string
}

/** 恢复专用：owner 调用拿到完整 ProseMirror JSON（经 GET revision 时也可取） */
export interface RestoreResponse {
  revisionId: string
  docId: string
  proseMirrorJson: string
  createdAt: Date
  /** client 应在 setContent 后以一次正常 Yjs update 广播，所有人自然收敛 */
  note: string
}
