/**
 * 房间内存运行态（单进程维度，docs/03 §4/§5）：
 * - pending 计数驱动快照压缩阈值判断
 * - readOnly 标记 = 持久化写路径失效后的降级（防静默丢更新）：
 *   后续 onAuthenticate 的连接一律 readOnly（网关丢弃写消息），
 *   已在场连接由 onChange 失败处理路径 closeConnections 踢出重连。
 * 进程重启后自然清零（此时 Y.Doc 也会从 DB 重建，一致性不受影响）。
 */

export interface RoomRuntime {
  /** 持久化失败后的只读降级标记 */
  readOnly: boolean
  /** 自上次快照以来累计的增量条数 */
  pendingUpdates: number
  /** 自上次快照以来累计的增量字节数 */
  pendingBytes: number
}

const rooms = new Map<string, RoomRuntime>()

export function getRoomRuntime(docId: string): RoomRuntime {
  let room = rooms.get(docId)
  if (room === undefined) {
    room = { readOnly: false, pendingUpdates: 0, pendingBytes: 0 }
    rooms.set(docId, room)
  }
  return room
}

export function markRoomReadOnly(docId: string): void {
  getRoomRuntime(docId).readOnly = true
}

export function isRoomReadOnly(docId: string): boolean {
  return rooms.get(docId)?.readOnly ?? false
}

/** 压缩成功后重置积压计数 */
export function resetPending(docId: string): void {
  const room = rooms.get(docId)
  if (room) {
    room.pendingUpdates = 0
    room.pendingBytes = 0
  }
}
