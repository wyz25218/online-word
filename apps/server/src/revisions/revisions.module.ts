import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { PermissionsModule } from '../permissions/permissions.module.js'
import { RevisionsController } from './revisions.controller.js'
import { RevisionsService } from './revisions.service.js'

/** T2.4 版本历史：列表/详情/手动保存/恢复 */
@Module({
  imports: [AuthModule, PermissionsModule],
  controllers: [RevisionsController],
  providers: [RevisionsService],
  exports: [RevisionsService],
})
export class RevisionsModule {}
