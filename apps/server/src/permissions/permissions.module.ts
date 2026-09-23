import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { UsersModule } from '../users/users.module.js'
import { DocRoleGuard } from './doc-role.guard.js'
import { MembersController } from './members.controller.js'
import { PermissionsService } from './permissions.service.js'

/** 权限判定集中模块（docs/06 §1）：导出 requireRole Guard、成员关系查询与成员管理 */
@Module({
  // AuthModule：MembersController 的 JwtAuthGuard 在本模块上下文实例化，需解析其依赖
  imports: [AuthModule, UsersModule],
  controllers: [MembersController],
  providers: [PermissionsService, DocRoleGuard],
  exports: [PermissionsService],
})
export class PermissionsModule {}
