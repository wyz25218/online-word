/**
 * 全仓共享类型与常量。
 *
 * 该包是 web / server / collab 三端之间的协议契约层：
 * - 修改任一导出类型/字段，必须三端同步升级并回归协同链路。
 * - 仅放「纯类型 + 无副作用常量/工具」，禁止引入运行时依赖（避免被打进前端主包）。
 */

/** 文档角色：owner 拥有者 > editor 编辑者 > commenter 仅评论 > viewer 只读 */
export type DocRole = 'owner' | 'editor' | 'commenter' | 'viewer'

/** 链接分享模式 */
export type LinkShare = 'private' | 'org' | 'anyone_view' | 'anyone_edit'

/** 协同写入权限（网关连接上下文使用） */
export type Permission = 'read' | 'write'

/** 鉴权结论（none 表示无权访问） */
export type PermissionLevel = Permission | 'none'

/**
 * Awareness 在线用户字段。
 * 字段名即 y-protocols awareness 的协议契约，三端必须一致。
 */
export interface AwarenessUser {
  userId: string
  name: string
  /** 光标颜色，由 userId 哈希取色板稳定分配，保证同一用户在各文档颜色一致 */
  color: string
  avatar?: string
  role: DocRole
}

/** 网关注入连接上下文（Hocuspocus context） */
export interface CollabContext {
  user: AwarenessUser
  permission: Permission
}

/** 网关 ↔ 业务后端验权响应 */
export interface AuthResult {
  ok: boolean
  permission: PermissionLevel
  user: AwarenessUser
  /** 缓存 TTL（毫秒），网关据此设置 Redis 缓存过期时间 */
  ttlMs: number
}

/** 由服务端经 awareness/control 通道下发给客户端的指令 */
export type ServerSignal = { type: 'force-disconnect'; reason: string }

/** 角色权限检查：给定角色是否具备某最低权限 */
export const ROLE_RANK: Record<DocRole, number> = {
  owner: 4,
  editor: 3,
  commenter: 2,
  viewer: 1,
}

export function roleAtLeast(role: DocRole, required: DocRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required]
}

/** role → 网关写权限映射 */
export function permissionOf(role: DocRole): Permission {
  return role === 'owner' || role === 'editor' ? 'write' : 'read'
}
