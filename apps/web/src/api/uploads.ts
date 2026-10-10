/**
 * 附件上传 API（T2.1 签名直传）：
 * 1. POST /api/upload/sign 拿预签名 PUT URL（同源 /s3proxy 前缀）
 * 2. PUT uploadUrl 直传对象存储（不经过业务 server）
 * 3. POST /api/docs/:id/attachments 登记元数据
 */
import { apiFetch } from './client'

export interface SignUploadResult {
  uploadUrl: string
  publicUrl: string
  objectKey: string
  expiresInSec: number
  maxBytes: number
}

export interface AttachmentItem {
  id: string
  objectKey: string
  publicUrl: string
  mimeType: string
  sizeBytes: string
  uploaderId: string
  createdAt: string
}

export async function signUpload(filename: string, contentType: string): Promise<SignUploadResult> {
  return await apiFetch<SignUploadResult>('/upload/sign', {
    method: 'POST',
    body: JSON.stringify({ filename, contentType }),
  })
}

/** 直传对象存储：content-type 必须与签名一致 */
export async function putToStorage(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`直传失败（${res.status}）${text.slice(0, 120)}`)
  }
  // 必须消费/释放响应体：S3 PutObject 返回空 body，未消费的连接会在
  // Chromium console 补记 net::ERR_ABORTED 噪音（请求实际已 200 成功）
  await res.body?.cancel().catch(() => undefined)
}

export async function registerAttachment(
  docId: string,
  payload: { objectKey: string; size: number; mimeType: string },
): Promise<AttachmentItem> {
  return await apiFetch<AttachmentItem>(`/docs/${docId}/attachments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
