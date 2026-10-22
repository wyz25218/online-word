import * as Y from 'yjs'
import { createHash } from 'node:crypto'
import { INTERNAL_API_KEY, INTERNAL_URL, REVISION_TIMER_MS } from './env.js'

/**
 * T2.4 定时版本保存（docs/03 §6 / docs/06 §2 版本）：
 * - 每 REVISION_TIMER_MS 毫秒扫描活跃房间，对"自上次保存以来有 change"的房间生成版本快照
 * - 默认 10min，本地验证可在 collab/.env 设 REVISION_TIMER_MS=5000 加速
 * - Y.encodeStateAsUpdate(doc) → state Buffer；Y.XmlFragment.toString() → 纯文本
 * - POST server `/internal/docs/:id/revision`（collab 内部接口，x-internal-key 保护）
 * - **内容哈希去重**：state 完全相同（房间闲置无变化）则跳过，避免数据库膨胀
 * - **房间卸载 flush**：beforeUnloadDocument 时立即保存（如果自上次定时保存后有变更）
 *
 * 注：collab 端不引入 prosemirror 依赖（schema 在 web 端完整定义），
 * 定时保存的版本 proseMirrorJson 为 null——恢复时 client 取 state 后在临时 Y.Doc
 * 里 applyUpdate → 再 setContent 到编辑器（docs/04 §7 整体替换模式）。
 * 手动保存由 client 驱动（有完整 Tiptap schema），会带完整 proseMirrorJson。
 *
 * 设计模式：与 extract.ts 评论抽取一致——onChange 时把 Y.Doc 注册到内部 Map，
 * timer / flush 时从中取；房间卸载时清理 Map 条目。
 */

const POST_TIMEOUT_MS = 5_000

/** 每个房间的定时保存运行态 */
interface RoomRevisionState {
  /** 自上次成功保存以来是否有 change */
  dirty: boolean
  /** 上次保存的 state 哈希（SHA-256 前 16 字节 hex），用于内容去重 */
  lastStateHash: string | null
  /** 定时器句柄（每 10min 触发一次） */
  timer: ReturnType<typeof setTimeout>
}

const states = new Map<string, RoomRevisionState>()
const docs = new Map<string, Y.Doc>() // docId → Y.Doc 引用（onChange 时注册）

/** onChange 时调用：注册 Y.Doc 引用 + 标记 dirty（与 extract.ts scheduleXXX 模式一致） */
export function registerRevisionDoc(docId: string, ydoc: Y.Doc): void {
  docs.set(docId, ydoc)
  const room = states.get(docId)
  if (room) room.dirty = true
}

/** 房间 onLoadDocument 时调用：启动该房间的定时保存计时器（间隔由 REVISION_TIMER_MS 配置） */
export function startRevisionTimer(docId: string): void {
  if (states.has(docId)) return
  const intervalSec = (REVISION_TIMER_MS / 1000).toFixed(0)
  const room: RoomRevisionState = {
    dirty: false,
    lastStateHash: null,
    timer: setInterval(() => void trySaveRevision(docId), REVISION_TIMER_MS),
  }
  states.set(docId, room)
  console.log(`[revision] room=${docId} 定时版本保存已启动（每 ${intervalSec}s）`)
}

/** 房间 beforeUnloadDocument 时调用：如果有变更立即存一条 + 清理 interval + 清理引用 */
export async function flushRevisionOnUnload(docId: string): Promise<void> {
  const room = states.get(docId)
  if (!room) return
  clearInterval(room.timer)
  states.delete(docId)
  const doc = docs.get(docId)
  docs.delete(docId)
  if (room.dirty && doc) {
    console.log(`[revision] room=${docId} 房间卸载，兜底保存一条`)
    await saveNow(docId, doc, room.lastStateHash)
  }
}

/** 进程退出时清理所有房间 */
export function shutdownAllRevisions(): void {
  for (const room of states.values()) clearInterval(room.timer)
  states.clear()
  docs.clear()
}

async function trySaveRevision(docId: string): Promise<void> {
  const room = states.get(docId)
  if (!room || !room.dirty) return
  const doc = docs.get(docId)
  if (!doc) return
  await saveNow(docId, doc, room.lastStateHash)
}

async function saveNow(docId: string, doc: Y.Doc, lastHash: string | null): Promise<void> {
  // 1. encode state
  const stateBuf = Buffer.from(Y.encodeStateAsUpdate(doc))

  // 2. 内容哈希去重——和上次保存完全一致说明 change 都被压缩覆盖了
  const hash = sha256(stateBuf).substring(0, 32)
  if (hash === lastHash) {
    console.log(`[revision] room=${docId} state 未变化，跳过定时保存`)
    const room = states.get(docId)
    if (room) room.dirty = false
    return
  }

  // 3. 抽纯文本（Y.XmlFragment.toString() 返回完整文本节点拼接）
  const proseMirrorXml = doc.getXmlFragment('prosemirror')
  const plainText = proseMirrorXml.toString()
  const wordCount = countWords(plainText)

  // 4. POST 到 server
  try {
    const res = await fetch(`${INTERNAL_URL}/internal/docs/${docId}/revision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': INTERNAL_API_KEY },
      body: JSON.stringify({
        stateBase64: stateBuf.toString('base64'),
        plainText: plainText || null,
        wordCount: wordCount || null,
        // proseMirrorJson: null —— collab 无 Tiptap schema，恢复由 client 侧 Y.applyUpdate + setContent 兜底
      }),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const room = states.get(docId)
    if (room) {
      room.dirty = false
      room.lastStateHash = hash
    }
    console.log(
      `[revision] room=${docId} 定时保存 bytes=${stateBuf.byteLength} words=${wordCount} hash=${hash.substring(0, 8)}`,
    )
  } catch (err) {
    console.error(
      `[revision] room=${docId} 定时保存失败（下轮重试）:`,
      err instanceof Error ? err.message : err,
    )
    // 不清 dirty，下一轮 interval 继续尝试；房间卸载时也会 flush
  }
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** 简单字数统计：按非空白字符数（中英文都覆盖；不追求极致，仅用于 UI 展示） */
function countWords(text: string): number {
  return text.replace(/\s+/g, '').length
}
