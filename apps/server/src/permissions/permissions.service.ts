import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { colorForUser, collabControlChannel, type CollabControlEvent, type DocRole } from '@online-word/shared'
import { prisma } from '../prisma.js'
import { UsersService } from '../users/users.service.js'
import { redis } from '../redis.client.js'

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

export interface DocMemberView {
  userId: string
  name: string
  color: string
  role: DocRole
}

@Injectable()
export class PermissionsService {
  constructor(private readonly users: UsersService) {}

  /** 用户在某文档中的角色；非成员返回 undefined（调用方决定 403/404 语义） */
  async getMemberRole(docId: string, userId: string): Promise<DocRole | undefined> {
    const member = await prisma.docMember.findUnique({
      where: { docId_userId: { docId, userId } },
      select: { role: true },
    })
    return member === null ? undefined : asDocRole(member.role)
  }

  /** 成员列表（owner 管理页用）；用户名取自桩用户表（users 落库后替换） */
  async listMembers(docId: string): Promise<DocMemberView[]> {
    const members = await prisma.docMember.findMany({
      where: { docId },
      select: { userId: true, role: true },
      orderBy: { createdAt: 'asc' },
    })
    return members.map((m) => ({
      userId: m.userId,
      name: this.users.findById(m.userId)?.name ?? m.userId,
      color: colorForUser(m.userId),
      role: asDocRole(m.role),
    }))
  }

  /** 添加成员（owner） */
  async addMember(docId: string, userId: string, role: DocRole): Promise<DocMemberView> {
    const user = this.users.findById(userId)
    if (user === undefined) throw new NotFoundException('用户不存在')
    const existing = await this.getMemberRole(docId, userId)
    if (existing !== undefined) throw new ConflictException('该用户已是文档成员')
    await prisma.docMember.create({ data: { docId, userId, role } })
    // 新成员无存量连接，通知为幂等空操作（网关按 userId 找不到连接即无动作）
    await this.notifyMembershipChanged(docId, userId)
    return { userId, name: user.name, color: colorForUser(userId), role }
  }

  /** 修改成员角色（owner）；owner 角色不可变更，目标角色不可设为 owner（所有权转移属 M2） */
  async setMemberRole(docId: string, userId: string, role: DocRole): Promise<DocMemberView> {
    const current = await this.getMemberRole(docId, userId)
    if (current === undefined) throw new NotFoundException('成员不存在')
    if (current === 'owner' || role === 'owner') {
      throw new BadRequestException('不能变更拥有者的角色，或把成员设为拥有者')
    }
    await prisma.docMember.update({
      where: { docId_userId: { docId, userId } },
      data: { role },
    })
    // 降权：删网关鉴权缓存 + 通知断开连接（重连后以新角色鉴权，viewer/commenter 只读）
    await this.notifyMembershipChanged(docId, userId)
    const user = this.users.findById(userId)
    return { userId, name: user?.name ?? userId, color: colorForUser(userId), role }
  }

  /** 移除成员（owner）；owner 不可移除（docs/06 §2） */
  async removeMember(docId: string, userId: string): Promise<void> {
    const current = await this.getMemberRole(docId, userId)
    if (current === undefined) throw new NotFoundException('成员不存在')
    if (current === 'owner') throw new BadRequestException('不能移除文档拥有者')
    await prisma.docMember.delete({ where: { docId_userId: { docId, userId } } })
    await this.notifyMembershipChanged(docId, userId)
  }

  /**
   * 权限变更通知（docs/09 T1.8）：
   * ①删 collab 侧鉴权缓存（下次连接实时查库）；②PUBLISH 控制事件，网关断开目标用户连接。
   * PUBLISH 失败不阻断权限写库（缓存 60s 自动过期兜底，最坏情况 60s 后重连生效）。
   */
  private async notifyMembershipChanged(docId: string, userId: string): Promise<void> {
    try {
      await redis.del(`collab:membership:${docId}:${userId}`)
      const event: CollabControlEvent = { docId, userId, action: 'membership-changed' }
      await redis.publish(collabControlChannel(docId), JSON.stringify(event))
      console.log(`[perm] membership changed doc=${docId} user=${userId} → cache evicted + published`)
    } catch (err) {
      console.error('[perm] publish membership change failed:', err instanceof Error ? err.message : err)
    }
  }
}
