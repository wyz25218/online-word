import { Injectable } from '@nestjs/common'
import type { DocRole } from '@online-word/shared'
import { prisma } from '../prisma.js'

/** DB 中 role 为受 CHECK 约束的 TEXT；读到未知值按 viewer 兜底（防御性，正常不会发生） */
function asDocRole(role: string): DocRole {
  switch (role) {
    case 'owner':
    case 'editor':
    case 'commenter':
    case 'viewer':
      return role
    default:
      return 'viewer'
  }
}

/** 成员关系查询：供 requireRole Guard 与 DocsService 复用 */
@Injectable()
export class PermissionsService {
  /** 用户在某文档中的角色；非成员返回 undefined（调用方决定 403/404 语义） */
  async getMemberRole(docId: string, userId: string): Promise<DocRole | undefined> {
    const member = await prisma.docMember.findUnique({
      where: { docId_userId: { docId, userId } },
      select: { role: true },
    })
    return member === null ? undefined : asDocRole(member.role)
  }
}
