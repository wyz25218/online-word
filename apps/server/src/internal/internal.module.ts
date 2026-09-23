import { Module } from '@nestjs/common'
import { PermissionsModule } from '../permissions/permissions.module.js'
import { UsersModule } from '../users/users.module.js'
import { InternalController } from './internal.controller.js'

/** 服务间内部接口模块（collab 网关验权等；T2.3 评论抽取回写也将挂在此模块） */
@Module({
  imports: [PermissionsModule, UsersModule],
  controllers: [InternalController],
})
export class InternalModule {}
