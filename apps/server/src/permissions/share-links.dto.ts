import { z } from 'zod'

/** 链接分享四档（docs/03 §2）。'org' 在 M2 阶段等价 private，供后续组织系统接入 */
export const ShareModeSchema = z.enum(['private', 'org', 'anyone_view', 'anyone_edit'])

export const UpdateShareLinkSchema = z.object({
  mode: ShareModeSchema,
  /** 切换到 anyone_view/edit 时若为 true 则重置 token（默认 true）；切回 private/org 时 token 清空忽略此字段 */
  resetToken: z.boolean().optional(),
})

export type ShareMode = z.infer<typeof ShareModeSchema>
export type UpdateShareLinkInput = z.infer<typeof UpdateShareLinkSchema>

/** 匿名端点 GET /share/:token 响应 */
export const AnonymousShareResponseSchema = z.object({
  docId: z.string().uuid(),
  docTitle: z.string(),
  mode: ShareModeSchema,
  anonymousUser: z.object({
    userId: z.string(),
    name: z.string(),
    color: z.string(),
  }),
  collabToken: z.string(),
  expiresIn: z.number().int().positive(),
})

export type AnonymousShareResponse = z.infer<typeof AnonymousShareResponseSchema>
