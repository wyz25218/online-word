import { z } from 'zod'

/**
 * 内部接口契约（仅供 collab 网关调用）。
 * docId/userId 收紧为 uuid：doc_members 主键为 uuid 列，非法格式会在 PG 层报错。
 */
export const InternalDocIdSchema = z.string().uuid('docId 必须是 UUID')
export const InternalUserIdSchema = z.string().uuid('userId 必须是 UUID')
