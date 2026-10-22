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

/** ProseMirror 可定位位置（相对偏移，远程光标用；M1 后续任务接入） */
export interface CursorPosition {
  anchor: number
  head: number
}

/**
 * 本端写入 awareness 的完整状态（docs/04 §5）：
 * y-protocols 内置 30s 超时清除离线端；lastUpdate 供未来自定义清理/观测。
 */
export interface AwarenessState {
  user: AwarenessUser
  cursor: CursorPosition | null
  lastUpdate: number
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

/**
 * server → collab 的权限变更控制事件（Redis PUBLISH，docs/06 §2 权限与分享）。
 * collab 收到后断开目标用户在该文档的连接，迫使其重连并重新鉴权：
 * 被移除 → membership 查库拒绝（前端 denied）；降权 → 以 readonly 连接重建（前端只读提示）。
 *
 * 两种 action：
 * - 'membership-changed'：指定 userId（被踢/降权），断开该 userId 的连接（T1.8）
 * - 'share-mode-changed'：任意 userId，断开该房间下所有 'anon:' 前缀的匿名连接（T2.5，模式切回 private/org 时）
 */
export type CollabControlEvent =
  | { docId: string; userId: string; action: 'membership-changed' }
  | { docId: string; userId?: string; action: 'share-mode-changed' }

/** server → collab 控制频道名（collab 以 psubscribe collab:control:* 订阅全部房间） */
export function collabControlChannel(docId: string): string {
  return `collab:control:${docId}`
}

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

/** 光标/头像取色板（docs/04 §5：按 userId 哈希稳定分配） */
export const COLOR_PALETTE = [
  '#f5a623', '#f8e71c', '#7ed321', '#4a90d9',
  '#9013fe', '#e0447c', '#50e3c2', '#ff6b6b',
] as const

/** userId → 色板索引的稳定哈希（FNV-1a 32bit）；同一用户在任何文档、任何端取色一致 */
export function colorForUser(userId: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return COLOR_PALETTE[(hash >>> 0) % COLOR_PALETTE.length] ?? '#4a90d9'
}
