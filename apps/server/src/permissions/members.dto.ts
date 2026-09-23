import { z } from 'zod'

/** 成员角色（owner 只能是创建者，不能通过邀请授予——所有权转移属 M2） */
export const MemberRoleSchema = z.enum(['editor', 'commenter', 'viewer'])

export const AddMemberSchema = z.object({
  userId: z.string().uuid('userId 必须是 UUID'),
  role: MemberRoleSchema,
})

export const UpdateMemberSchema = z.object({
  role: MemberRoleSchema,
})

export type MemberRole = z.infer<typeof MemberRoleSchema>
export type AddMemberInput = z.infer<typeof AddMemberSchema>
export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>
