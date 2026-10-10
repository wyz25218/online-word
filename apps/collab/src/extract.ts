import * as Y from 'yjs'
import { toCommentThreads, type CommentThread } from '@online-word/shared'
import { INTERNAL_API_KEY, INTERNAL_URL } from './env.js'

/**
 * 评论抽取回写（docs/04 §6，T2.3）：
 * comments 命名空间变化 → 防抖 2s 读线程快照 → POST server `/internal/docs/:id/extracted`
 * （server 事务内 upsert comments 表，写表动作只允许 server 执行）。
 *
 * 幂等性：线程 JSON 与上次成功回写一致则跳过（正文打字不产生实际请求）；
 * in-flight 期间的新变化在完成后补跑一轮（dirty 标记）。
 * 失败只打日志不重试——下一次 change 会再次触发，房间卸载时兜底 flush。
 */

const EXTRACT_DEBOUNCE_MS = 2_000
const EXTRACT_TIMEOUT_MS = 5_000

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const lastSynced = new Map<string, string>()
const pendingDocs = new Map<string, Y.Doc>()
const inflight = new Set<string>()
const dirty = new Set<string>()

function threadsJson(document: Y.Doc): string {
  // Y.Array<Y.Map> → plain → 防御式归一（toCommentThreads 稳定字段顺序）
  return JSON.stringify(toCommentThreads(document.getArray('comments').toJSON()))
}

async function postExtracted(docId: string, threads: CommentThread[]): Promise<void> {
  const res = await fetch(`${INTERNAL_URL}/internal/docs/${docId}/extracted`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-key': INTERNAL_API_KEY },
    body: JSON.stringify({ threads }),
    signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`extracted 接口返回 ${res.status}`)
}

async function extractNow(docId: string): Promise<void> {
  const document = pendingDocs.get(docId)
  if (document === undefined) return
  if (inflight.has(docId)) {
    dirty.add(docId)
    return
  }
  inflight.add(docId)
  try {
    const json = threadsJson(document)
    if (json !== lastSynced.get(docId)) {
      await postExtracted(docId, toCommentThreads(JSON.parse(json)))
      lastSynced.set(docId, json)
      console.log(`[extract] room=${docId} 回写线程快照 bytes=${json.length}`)
    }
  } catch (err) {
    console.error(`[extract] room=${docId} 回写失败（下次变更重试）:`, err instanceof Error ? err.message : err)
  } finally {
    inflight.delete(docId)
    if (dirty.has(docId)) {
      dirty.delete(docId)
      void extractNow(docId)
    }
  }
}

/** onChange 触发：防抖后回写（每次 change 都会刷新 pendingDoc，保证读到最新状态） */
export function scheduleCommentsExtract(docId: string, document: Y.Doc): void {
  pendingDocs.set(docId, document)
  const prev = timers.get(docId)
  if (prev !== undefined) clearTimeout(prev)
  timers.set(
    docId,
    setTimeout(() => {
      timers.delete(docId)
      void extractNow(docId)
    }, EXTRACT_DEBOUNCE_MS),
  )
}

/** 房间卸载（beforeUnloadDocument）兜底：立即回写一次并清理内存态 */
export async function flushCommentsExtract(docId: string): Promise<void> {
  const prev = timers.get(docId)
  if (prev !== undefined) {
    clearTimeout(prev)
    timers.delete(docId)
  }
  await extractNow(docId)
  pendingDocs.delete(docId)
  dirty.delete(docId)
  lastSynced.delete(docId)
}
