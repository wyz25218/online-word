/**
 * 统一图片上传器（T2.1，docs/05 §6）：
 * 粘贴 / 拖拽 / 工具栏三处入口全部汇聚到这里。
 *
 * 流程：插入占位节点（uploadState=uploading，协同可见）→ sign → PUT 直传 → 登记
 *       → 量取图片尺寸 → setNodeMarkup 回填 src/width/height 并清空上传态。
 * 失败：uploadState=error（虚线占位），点击占位可重试（File 仅存内存，不进 Y.Doc）。
 * 全程异步，不阻塞正文编辑（C16）。
 *
 * 上传态用节点自定义 attrs（uploadId/uploadState）承载：随 Y.Doc 协同广播，
 * 他人端同样看到"上传中→完成"的过渡；上传完成即清空，落库的节点仅剩 URL+尺寸。
 */
import type { EditorView } from '@tiptap/pm/view'
import { putToStorage, registerAttachment, signUpload } from '../../api/uploads'

/** 与 server ALLOWED_MIME_TYPES 的图片子集保持一致（非图片文件暂不支持插入文档） */
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'])
const MAX_BYTES = Number(import.meta.env.VITE_MAX_UPLOAD_MB ?? 50) * 1024 * 1024

/** uploadId → File（重试用；仅本端内存，刷新丢失后占位仍可重新选择文件——M2 后续优化） */
const pendingFiles = new Map<string, File>()

let seq = 0

export interface UploadResult {
  ok: boolean
  reason?: string
}

/** 前置校验（类型/大小），不合格直接放错误占位，不发起网络请求 */
export function validateFile(file: File): UploadResult {
  if (!IMAGE_MIME_TYPES.has(file.type)) return { ok: false, reason: `不支持的类型：${file.type || '未知'}` }
  if (file.size > MAX_BYTES) return { ok: false, reason: `超过大小上限 ${MAX_BYTES / 1024 / 1024}MB` }
  return { ok: true }
}

/** 三处入口的统一入口：批量处理文件，插入位置缺省为当前光标 */
export function startImageUploads(view: EditorView, docId: string, files: File[], insertPos?: number): void {
  for (const file of files) {
    void runOne(view, docId, file, insertPos)
  }
}

async function runOne(view: EditorView, docId: string, file: File, insertPos?: number): Promise<void> {
  const uploadId = `up-${Date.now().toString(36)}-${(++seq).toString(36)}`
  const check = validateFile(file)
  insertPlaceholder(view, uploadId, file.name, insertPos, check.ok ? 'uploading' : 'error')
  if (!check.ok) return
  pendingFiles.set(uploadId, file)
  await performUpload(view, docId, uploadId)
}

/** 向服务端拿签名并直传 + 登记；成功回填尺寸，失败置 error 占位 */
async function performUpload(view: EditorView, docId: string, uploadId: string): Promise<void> {
  const file = pendingFiles.get(uploadId)
  const at = findUploadNode(view, uploadId)
  if (!file || !at) return
  try {
    const sign = await signUpload(file.name, file.type)
    await putToStorage(sign.uploadUrl, file)
    await registerAttachment(docId, { objectKey: sign.objectKey, size: file.size, mimeType: file.type })
    const size = file.type.startsWith('image/') ? await measureImage(sign.publicUrl) : { width: null, height: null }
    applyAttrs(view, uploadId, {
      src: sign.publicUrl,
      alt: file.name,
      width: size.width,
      height: size.height,
      uploadId: null,
      uploadState: null,
    })
    pendingFiles.delete(uploadId)
  } catch (err) {
    console.error('[upload] failed:', err)
    applyAttrs(view, uploadId, { uploadState: 'error' })
  }
}

/** 点击错误占位重试（handleClickOn 调用） */
export function retryUpload(view: EditorView, docId: string, uploadId: string): void {
  if (!pendingFiles.has(uploadId)) return
  applyAttrs(view, uploadId, { uploadState: 'uploading' })
  void performUpload(view, docId, uploadId)
}

/** 在指定位置插入占位 image 节点（pos 缺省当前选区） */
function insertPlaceholder(view: EditorView, uploadId: string, filename: string, pos: number | undefined, state: 'uploading' | 'error'): void {
  const nodeType = view.state.schema.nodes.image
  if (!nodeType) return
  const node = nodeType.create({
    src: '',
    alt: filename,
    title: state === 'uploading' ? '上传中…' : '上传失败，点击重试',
    uploadId,
    uploadState: state,
  })
  const at = pos ?? view.state.selection.from
  const tr = view.state.tr.replaceWith(at, at, node)
  view.dispatch(tr)
}

/** 按 uploadId 定位节点（协同下 pos 会漂移，每次实时查找） */
function findUploadNode(view: EditorView, uploadId: string): number | null {
  let found: number | null = null
  view.state.doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.type.name === 'image' && node.attrs.uploadId === uploadId) {
      found = pos
      return false
    }
    return true
  })
  return found
}

function applyAttrs(view: EditorView, uploadId: string, patch: Record<string, unknown>): void {
  const pos = findUploadNode(view, uploadId)
  if (pos === null) return // 节点已被他人/本人删除：静默放弃
  const node = view.state.doc.nodeAt(pos)
  if (!node) return
  // setNodeMarkup 的 attrs 是全量替换（未提及的字段回落 default），必须先合并现有 attrs，
  // 否则失败路径只传 uploadState 会把 alt/uploadId 冲成 null，导致点击重试永远无法命中
  const tr = view.state.tr
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch })
  view.dispatch(tr)
}

/** 量取图片自然尺寸（回填到节点，供排版与协同一致性使用；失败不阻塞） */
function measureImage(url: string): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve({ width: null, height: null })
    img.src = url
  })
}
