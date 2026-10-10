import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { UsersModule } from '../users/users.module.js'
import { PermissionsModule } from '../permissions/permissions.module.js'
import { AttachmentsController } from './attachments.controller.js'
import { AttachmentsService } from './attachments.service.js'

/** 附件：签名直传 + 元数据登记（docs/06 §1）。
 *  NestJS Guard 在消费方模块实例化：JwtAuthGuard（依赖 AuthModule）与
 *  DocRoleGuard（依赖 PermissionsService，须 imports PermissionsModule）都在本模块解析。 */
@Module({
  imports: [AuthModule, UsersModule, PermissionsModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
})
export class AttachmentsModule {}
