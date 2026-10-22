import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { UsersModule } from '../users/users.module.js'
import { AnonymousShareController } from './share-public.controller.js'
import { SharePublicService } from './share-public.service.js'
import { ShareLinksController } from './share-links.controller.js'
import { DocRoleGuard } from './doc-role.guard.js'
import { MembersController } from './members.controller.js'
import { PermissionsService } from './permissions.service.js'

/**
 * 权限判定集中模块（docs/06 §1）：
 * - 成员关系查询 + 成员管理（owner 专属）
 * - 分享链接 CRUD（owner 专属）
 * - 匿名分享公开端点（无 guard，靠 token 本身约束）
 */
@Module({
  imports: [AuthModule, UsersModule],
  controllers: [MembersController, ShareLinksController, AnonymousShareController],
  providers: [PermissionsService, SharePublicService, DocRoleGuard],
  exports: [PermissionsService],
})
export class PermissionsModule {}
