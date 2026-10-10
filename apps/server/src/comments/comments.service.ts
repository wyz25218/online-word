import { Injectable } from '@nestjs/common'
import { prisma } from '../prisma.js'
import type { CommentRow, ExtractedPayload } from './comments.dto.js'

/**
 * 评论冗余服务（docs/04 §6，T2.3）：
 * 权威数据在 Y.Doc 的 comments 命名空间；本服务仅维护 server 视图（跨文档查询/通知/未读数）。
 * upsertThreads 幂等：id = Y 侧评论 id，存在即覆盖，Y 中消失的行删除（保持视图与 Y 一致）。
 */
@Injectable()
export class CommentsService {
  /** 网关抽取回写：事务内差量 upsert + 删除消失行 + 刷新文档活跃时间 */
  async upsertThreads(docId: string, payload: ExtractedPayload): Promise<{ upserted: number; deleted: number }> {
    const incoming: {
      id: string
      threadId: string
      authorId: string
      body: string
      resolved: boolean
      createdAt: Date
    }[] = []
    for (const t of payload.threads) {
      incoming.push({
        id: t.id,
        threadId: t.id,
        authorId: t.authorId,
        body: t.body,
        resolved: t.resolved,
        createdAt: new Date(t.createdAt),
      })
      for (const r of t.replies) {
        incoming.push({
          id: r.id,
          threadId: t.id,
          authorId: r.authorId,
          body: r.body,
          resolved: t.resolved,
          createdAt: new Date(r.createdAt),
        })
      }
    }

    return await prisma.$transaction(async (tx) => {
      const existing = await tx.comment.findMany({ where: { docId }, select: { id: true } })
      const incomingIds = new Set(incoming.map((r) => r.id))
      const gone = existing.map((r) => r.id).filter((id) => !incomingIds.has(id))
      if (gone.length > 0) {
        await tx.comment.deleteMany({ where: { docId, id: { in: gone } } })
      }
      for (const row of incoming) {
        await tx.comment.upsert({
          where: { id: row.id },
          create: { ...row, docId },
          update: {
            threadId: row.threadId,
            authorId: row.authorId,
            body: row.body,
            resolved: row.resolved,
            createdAt: row.createdAt,
          },
        })
      }
      // 评论操作即文档活跃信号（current_version 由快照水位推进，不在此回写）；
      // updateMany 匹配不到文档行时静默跳过（房间历史残留的 docId 不炸事务）
      await tx.doc.updateMany({ where: { id: docId }, data: { lastActiveAt: new Date() } })
      return { upserted: incoming.length, deleted: gone.length }
    })
  }

  /** 服务端线程视图（docs/06 §评论）：按线程分组返回，支持 unresolvedOnly */
  async listThreads(docId: string, unresolvedOnly: boolean): Promise<CommentRow[]> {
    const rows = await prisma.comment.findMany({
      where: { docId, ...(unresolvedOnly ? { resolved: false } : {}) },
      orderBy: [{ threadId: 'asc' }, { createdAt: 'asc' }],
    })
    return rows.map((r) => ({
      id: r.id,
      threadId: r.threadId,
      authorId: r.authorId,
      body: r.body,
      resolved: r.resolved,
      createdAt: r.createdAt.toISOString(),
    }))
  }
}
