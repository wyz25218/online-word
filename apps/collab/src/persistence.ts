import * as Y from 'yjs'
import { appendUpdate, isDocUuid, loadDocBaseline } from './db.client.js'
import { withLock } from './redis.client.js'

/**
 * 持久化编排（docs/03 §3/§4）：
 * - loadDocState：onLoadDocument 时回放快照 + 增量
 * - persistChange：onChange 时加 Redis 房间锁幂等追加，失败重试 3 次
 *   （追加是数据安全底线：进程崩溃时最多丢"当前事务"，不存在防抖窗口）
 */

const APPEND_RETRIES = 3

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

/** 幂等追加一次变更；内部持锁串行化，外层无需再锁 */
export async function persistChange(docId: string, update: Uint8Array, clientId: number | null): Promise<void> {
  if (!isDocUuid(docId)) return

  let lastError: unknown
  for (let attempt = 1; attempt <= APPEND_RETRIES; attempt++) {
    try {
      await withLock(`lock:doc:${docId}`, () => appendUpdate(docId, update, clientId))
      return
    } catch (err) {
      lastError = err
      console.error(`[persist] room=${docId} append 失败（第 ${attempt}/${APPEND_RETRIES} 次）:`, err instanceof Error ? err.message : err)
    }
  }
  // TODO(T1.4)：重试耗尽 → 置房间只读（防静默丢更新），并告警
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
