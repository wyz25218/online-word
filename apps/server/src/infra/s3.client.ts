/**
 * S3 兼容对象存储客户端（T2.1 签名直传）。
 * dev：本机 SeaweedFS（MinIO 开源版已归档下架，S3 API 层面兼容）；prod：MinIO/S3。
 *
 * 关键坑（实测）：AWS SDK v3 较新版本默认 requestChecksumCalculation=WHEN_SUPPORTED，
 * presign 会把 x-amz-checksum-crc32 / x-amz-sdk-checksum-algorithm 掺入签名 URL，
 * 浏览器 PUT 无法携带该校验头 → 服务端 400 BadDigest。
 * 必须 WHEN_REQUIRED，生成干净 URL。
 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const cfg = {
  endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  bucket: process.env.S3_BUCKET ?? 'ow-attachments',
  publicPrefix: process.env.S3_PUBLIC_PREFIX ?? '/s3proxy',
  uploadUrlTtlSec: Number(process.env.S3_UPLOAD_URL_TTL_SEC ?? 600),
  maxUploadBytes: Number(process.env.S3_MAX_UPLOAD_MB ?? 50) * 1024 * 1024,
}

let client: S3Client | undefined

export function getS3Client(): S3Client {
  client ??= new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
  })
  return client
}

/** 签名直传结果：浏览器 PUT uploadUrl（同源代理路径）成功后，节点/登记使用 publicUrl */
export interface SignedUpload {
  uploadUrl: string
  publicUrl: string
  objectKey: string
  expiresInSec: number
  maxBytes: number
}

/** 文件名消毒：保留中英文/数字/点/横线/下划线/括号，其余转下划线；防止路径穿越 */
function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file'
  const safe = base.replace(/[^\w\u4e00-\u9fa5.()-]/g, '_').slice(0, 120)
  return safe.length > 0 ? safe : 'file'
}

/** 生成 objectKey：u/{yyyyMM}/{uuid}/{安全文件名} */
export function buildObjectKey(filename: string): string {
  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const uuid = crypto.randomUUID()
  return `u/${ym}/${uuid}/${sanitizeFilename(filename)}`
}

/**
 * 生成 PUT 预签名 URL。
 * 签名 host 为 S3 endpoint（localhost:9000）；返回给浏览器的 uploadUrl 将 scheme://host
 * 替换为 publicPrefix（dev: /s3proxy 经 Vite 代理 changeOrigin 还原 Host 后验签通过；
 * prod: nginx 同名 location 反代）。文档节点只存 publicUrl（相对路径，环境无关、同源免 CORS）。
 */
export async function signUpload(filename: string, contentType: string): Promise<SignedUpload> {
  const objectKey = buildObjectKey(filename)
  const command = new PutObjectCommand({ Bucket: cfg.bucket, Key: objectKey, ContentType: contentType })
  const presigned = await getSignedUrl(getS3Client(), command, { expiresIn: cfg.uploadUrlTtlSec })
  const uploadUrl = presigned.replace(/^https?:\/\/[^/]+/i, cfg.publicPrefix)
  return {
    uploadUrl,
    publicUrl: `${cfg.publicPrefix}/${cfg.bucket}/${objectKey}`,
    objectKey,
    expiresInSec: cfg.uploadUrlTtlSec,
    maxBytes: cfg.maxUploadBytes,
  }
}

export const s3Config = cfg
