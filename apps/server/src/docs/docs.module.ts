import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { PermissionsModule } from '../permissions/permissions.module.js'
import { DocsController } from './docs.controller.js'
import { DocsService } from './docs.service.js'

/** 文档 CRUD 模块（docs/06 §1）：依赖 AuthModule（JwtAuthGuard）与 PermissionsModule（requireRole） */
@Module({
  imports: [AuthModule, PermissionsModule],
  controllers: [DocsController],
  providers: [DocsService],
  exports: [DocsService],
})
export class DocsModule {}
