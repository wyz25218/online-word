import * as Y from 'yjs'
import { appendUpdate, compactDocInDb, isDocUuid, loadDocBaseline } from './db.client.js'
import { getRoomRuntime, isRoomReadOnly, markRoomReadOnly, resetPending } from './room-state.js'
import { withLock } from './redis.client.js'

/**
 * 持久化编排（docs/03 §3/§4/§5）：
 * - loadDocState：onLoadDocument 时回放快照 + 增量
 * - persistChange：onChange 时加 Redis 房间锁幂等追加，失败重试 3 次；
 *   重试耗尽 → 房间只读降级（防静默丢更新）
 * - 压缩：积压达阈值（条数/字节）或 onDestroy 时，锁内 encode → upsert 快照 → 删旧增量
 */

const APPEND_RETRIES = 3

/** 压缩阈值（docs/03 §5：条数 ≥100 或字节 ≥2MB；环境变量可覆盖便于验证） */
const COMPACT_UPDATES_THRESHOLD = Number(process.env.COMPACT_UPDATES ?? 100)
const COMPACT_BYTES_THRESHOLD = Number(process.env.COMPACT_BYTES ?? 2 * 1024 * 1024)

/** 回放快照与增量到房间 Y.Doc；非 UUID 房间（M0 遗留 demo 房）跳过持久化 */
export async function loadDocState(docId: string, doc: Y.Doc): Promise<void> {
  if (!isDocUuid(docId)) {
    console.warn(`[persist] room=${docId} 非文档 UUID，仅内存态不落库`)
    return
  }
  const baseline = await loadDocBaseline(docId)
  if (baseline.snapshot !== null) {
    Y.applyUpdate(doc, baseline.snapshot)
  }
  for (const update of baseline.updates) {
    Y.applyUpdate(doc, update)
  }
  console.log(
    `[persist] room=${docId} loaded snapshot=${baseline.snapshot !== null ? 'yes' : 'no'}@v${baseline.snapshotVersion} updates=${baseline.updates.length}`,
  )
}

/**
 * 快照压缩（docs/03 §5）：与追加同一把房间锁互斥，事务内 upsert 快照 + 删旧增量。
 * encodeStateAsUpdate 依赖 Y.Doc 默认 GC 开启，删除内容可被回收。
 */
export async function compactRoom(docId: string, doc: Y.Doc, reason: string): Promise<void> {
  await withLock(
    `lock:doc:${docId}`,
    async () => {
      const state = Y.encodeStateAsUpdate(doc)
      const result = await compactDocInDb(docId, state)
      resetPending(docId)
      console.log(
        `[compact] room=${docId} reason=${reason} snapshot@v${result.waterMark} bytes=${result.snapshotBytes} updates_deleted=${result.deletedUpdates}`,
      )
    },
    { ttlMs: 30_000 },
  )
}

/** onDestroy（房间卸载）时强制压缩：仅在有未压缩积压时执行 */
export async function compactOnUnload(docId: string, doc: Y.Doc): Promise<void> {
  if (!isDocUuid(docId)) return
  const room = getRoomRuntime(docId)
  if (room.pendingUpdates === 0 && room.pendingBytes === 0) return
  await compactRoom(docId, doc, 'onDestroy')
}

/** 幂等追加一次变更；内部持锁串行化，外层无需再锁。达阈值时顺带触发压缩。 */
export async function persistChange(docId: string, update: Uint8Array, doc: Y.Doc): Promise<void> {
  if (!isDocUuid(docId)) return
  if (isRoomReadOnly(docId)) {
    // 双保险：正常情况下该房间的新连接已被网关置 readOnly，不会再发写消息
    console.error(`[persist] room=${docId} 只读降级中，丢弃 ${update.byteLength}B update`)
    return
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= APPEND_RETRIES; attempt++) {
    try {
      await withLock(`lock:doc:${docId}`, () => appendUpdate(docId, update, doc.clientID))
      lastError = undefined
      break
    } catch (err) {
      lastError = err
      console.error(`[persist] room=${docId} append 失败（第 ${attempt}/${APPEND_RETRIES} 次）:`, err instanceof Error ? err.message : err)
    }
  }
  if (lastError !== undefined) {
    markRoomReadOnly(docId)
    console.error(`[persist] room=${docId} 写路径不可用，房间已降级只读（防静默丢更新）`)
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  const room = getRoomRuntime(docId)
  room.pendingUpdates += 1
  room.pendingBytes += update.byteLength
  if (room.pendingUpdates >= COMPACT_UPDATES_THRESHOLD || room.pendingBytes >= COMPACT_BYTES_THRESHOLD) {
    await compactRoom(docId, doc, `threshold updates=${room.pendingUpdates} bytes=${room.pendingBytes}`)
  }
}
