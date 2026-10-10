import { BadRequestException, Injectable } from '@nestjs/common'
import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { prisma } from '../prisma.js'
import { getS3Client, s3Config, signUpload } from '../infra/s3.client.js'
import type { AttachmentItem, RegisterAttachmentInput, SignUploadInput, SignUploadResponse } from './attachments.dto.js'

@Injectable()
export class AttachmentsService {
  /** 签名直传：仅签发 URL，不落库（直传成功后由 register 登记） */
  async sign(input: SignUploadInput): Promise<SignUploadResponse> {
    return await signUpload(input.filename, input.contentType)
  }

  /**
   * 直传完成后的元数据登记：HEAD 校验对象真实存在且大小一致（防凭空登记制造脏数据）。
   * objectKey 由本服务签发（正则校验见 DTO），无路径穿越面。
   */
  async register(docId: string, uploaderId: string, input: RegisterAttachmentInput): Promise<AttachmentItem> {
    if (input.size > s3Config.maxUploadBytes) {
      throw new BadRequestException(`文件超过大小上限（${s3Config.maxUploadBytes} 字节）`)
    }
    try {
      const head = await getS3Client().send(new HeadObjectCommand({ Bucket: s3Config.bucket, Key: input.objectKey }))
      if ((head.ContentLength ?? 0) !== input.size) {
        throw new BadRequestException('size 与已上传对象不一致')
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err
      throw new BadRequestException('对象尚未上传或已失效，请先完成直传')
    }

    const row = await prisma.attachment.create({
      data: {
        docId,
        uploaderId,
        objectKey: input.objectKey,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.size),
      },
    })
    return this.toItem(row)
  }

  async list(docId: string): Promise<AttachmentItem[]> {
    const rows = await prisma.attachment.findMany({
      where: { docId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    return rows.map((r) => this.toItem(r))
  }

  private toItem(row: {
    id: string
    objectKey: string
    mimeType: string
    sizeBytes: bigint
    uploaderId: string
    createdAt: Date
  }): AttachmentItem {
    return {
      id: row.id,
      objectKey: row.objectKey,
      publicUrl: `${s3Config.publicPrefix}/${s3Config.bucket}/${row.objectKey}`,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes.toString(), // BigInt 经 JSON 必须转 string
      uploaderId: row.uploaderId,
      createdAt: row.createdAt,
    }
  }
}
