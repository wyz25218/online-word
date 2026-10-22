import { Module } from '@nestjs/common'
import { CommentsModule } from '../comments/comments.module.js'
import { PermissionsModule } from '../permissions/permissions.module.js'
import { RevisionsModule } from '../revisions/revisions.module.js'
import { UsersModule } from '../users/users.module.js'
import { InternalController } from './internal.controller.js'

/** 服务间内部接口模块（collab 网关验权 + T2.3 评论抽取回写 + T2.4 定时版本保存） */
@Module({
  imports: [PermissionsModule, UsersModule, CommentsModule, RevisionsModule],
  controllers: [InternalController],
})
export class InternalModule {}
