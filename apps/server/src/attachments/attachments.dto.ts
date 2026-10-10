import { z } from 'zod'

/** MIME 白名单：图片 + 常见文档/压缩类型（T3.4 安全加固再做魔数校验） */
export const ALLOWED_MIME_TYPES = new Set([
  // 图片
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  // 文档
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // 压缩包
  'application/zip',
  'application/x-7z-compressed',
  'application/gzip',
])

export const SignUploadSchema = z.object({
  filename: z.string().trim().min(1, 'filename 不能为空').max(255),
  contentType: z.string().trim().min(1, 'contentType 不能为空').refine((v) => ALLOWED_MIME_TYPES.has(v), '不支持的文件类型'),
})

export type SignUploadInput = z.infer<typeof SignUploadSchema>

export const RegisterAttachmentSchema = z.object({
  objectKey: z.string().trim().min(1, 'objectKey 不能为空').max(512).regex(/^u\/\d{6}\/[\w-]+\/.+$/, 'objectKey 格式非法'),
  size: z.coerce.number().int().min(1, 'size 必须为正数'),
  mimeType: z.string().trim().min(1).max(100),
})

export type RegisterAttachmentInput = z.infer<typeof RegisterAttachmentSchema>

export interface SignUploadResponse {
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
  sizeBytes: string // BigInt → 字符串（JSON 序列化安全）
  uploaderId: string
  createdAt: Date
}
