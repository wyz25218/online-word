import { z } from 'zod'

/** 新建文档：标题可选，缺省"未命名文档"（与 DB 默认一致） */
export const CreateDocSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(200, '标题过长（≤200）').optional(),
})

export const UpdateDocSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(200, '标题过长（≤200）'),
})

export const ListDocsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().trim().max(100).optional(),
})

export type CreateDocInput = z.infer<typeof CreateDocSchema>
export type UpdateDocInput = z.infer<typeof UpdateDocSchema>
export type ListDocsQuery = z.infer<typeof ListDocsQuerySchema>

/** 列表项：文档元数据 + 我在该文档中的角色 */
export interface DocSummary {
  id: string
  title: string
  ownerId: string
  role: string
  createdAt: Date
  updatedAt: Date
}

/** 详情：列表字段 + 协同游标信息。BigInt 经 JSON 无法序列化，统一转字符串 */
export interface DocDetail extends DocSummary {
  currentVersion: string
  lastActiveAt: Date
}

export interface DocListResponse {
  items: DocSummary[]
  total: number
  page: number
  pageSize: number
}
