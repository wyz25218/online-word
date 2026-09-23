import { Module } from '@nestjs/common'
import { DocRoleGuard } from './doc-role.guard.js'
import { PermissionsService } from './permissions.service.js'

/** 权限判定集中模块（docs/06 §1）：导出 requireRole Guard 与成员关系查询 */
@Module({
  providers: [PermissionsService, DocRoleGuard],
  exports: [PermissionsService],
})
export class PermissionsModule {}
