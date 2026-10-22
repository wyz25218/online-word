import { z } from 'zod'

/**
 * 内部接口契约（仅供 collab 网关调用）。
 * docId 收紧为 uuid：doc_members 主键为 uuid 列。
 * userId 允许两种格式：
 *   - 标准 UUID（真实用户，doc_members.userId 列值）
 *   - 'anon:<session>' 前缀（T2.5 匿名分享链路，internal membership 接口据此走 share-link mode 兜底分支）
 */
export const InternalDocIdSchema = z.string().uuid('docId 必须是 UUID')

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ANON_USER_REGEX = /^anon:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const InternalUserIdSchema = z
  .string()
  .min(4)
  .max(80)
  .refine((v) => UUID_REGEX.test(v) || ANON_USER_REGEX.test(v), {
    message: 'userId 必须是 UUID 或以 anon:<uuid> 开头',
  })
