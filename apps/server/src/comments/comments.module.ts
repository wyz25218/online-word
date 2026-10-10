import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { PermissionsModule } from '../permissions/permissions.module.js'
import { CommentsController } from './comments.controller.js'
import { CommentsService } from './comments.service.js'

/** 评论冗余（docs/06 §1）：抽取回写（internal 模块调用）+ 服务端线程视图。
 *  NestJS Guard 在消费方模块实例化：JwtAuthGuard（AuthModule）与
 *  DocRoleGuard（PermissionsService，须 imports PermissionsModule）都在本模块解析；
 *  CommentsService 被 InternalModule 消费，须 exports。 */
@Module({
  imports: [AuthModule, PermissionsModule],
  controllers: [CommentsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
