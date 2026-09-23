import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common'
import type { DocRole } from '@online-word/shared'
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { requireRole } from './doc-role.guard.js'
import { PermissionsService, type DocMemberView } from './permissions.service.js'
import { AddMemberSchema, UpdateMemberSchema, type AddMemberInput, type UpdateMemberInput } from './members.dto.js'

/**
 * 成员管理（docs/06 §2 权限与分享，owner 专属）：
 * - GET    /docs/:id/members           成员列表
 * - POST   /docs/:id/members           添加成员 {userId, role}
 * - PATCH  /docs/:id/members/:userId   修改角色（变更后删鉴权缓存 + Redis PUBLISH 踢人/降权）
 * - DELETE /docs/:id/members/:userId   移除成员（不能移除 owner）
 */
@Controller('docs/:id/members')
@UseGuards(JwtAuthGuard)
export class MembersController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  @requireRole('owner' satisfies DocRole)
  async list(@Param('id') docId: string): Promise<DocMemberView[]> {
    return await this.permissions.listMembers(docId)
  }

  @Post()
  @requireRole('owner' satisfies DocRole)
  @HttpCode(HttpStatus.CREATED)
  async add(@Param('id') docId: string, @Body(new ZodValidationPipe(AddMemberSchema)) dto: AddMemberInput): Promise<DocMemberView> {
    return await this.permissions.addMember(docId, dto.userId, dto.role)
  }

  @Patch(':userId')
  @requireRole('owner' satisfies DocRole)
  async updateRole(
    @Param('id') docId: string,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(UpdateMemberSchema)) dto: UpdateMemberInput,
  ): Promise<DocMemberView> {
    return await this.permissions.setMemberRole(docId, userId, dto.role)
  }

  @Delete(':userId')
  @requireRole('owner' satisfies DocRole)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') docId: string, @Param('userId') userId: string): Promise<void> {
    return await this.permissions.removeMember(docId, userId)
  }
}
