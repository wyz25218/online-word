import { z } from 'zod'

/** 网关抽取回写体（threads 快照，与 shared CommentThread 契约一致；id 一律 uuid 防注入） */
export const CommentReplySchema = z.object({
  id: z.string().uuid(),
  authorId: z.string().uuid(),
  body: z.string().max(10_000),
  createdAt: z.number().int().nonnegative(),
})

export const CommentThreadSchema = CommentReplySchema.extend({
  resolved: z.boolean(),
  replies: z.array(CommentReplySchema).max(500),
})

export const ExtractedPayloadSchema = z.object({
  threads: z.array(CommentThreadSchema).max(2_000),
})

export type ExtractedPayload = z.infer<typeof ExtractedPayloadSchema>

/** GET /docs/:id/comments 响应行 */
export interface CommentRow {
  id: string
  threadId: string
  authorId: string
  body: string
  resolved: boolean
  createdAt: string
}
