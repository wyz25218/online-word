import { Module } from '@nestjs/common'
import { UsersModule } from './users/users.module.js'
import { AuthModule } from './auth/auth.module.js'
import { PermissionsModule } from './permissions/permissions.module.js'
import { DocsModule } from './docs/docs.module.js'

/** 根模块：按 docs/06 §1 划分，M1 后续逐步引入 infra 等模块 */
@Module({
  imports: [UsersModule, AuthModule, PermissionsModule, DocsModule],
})
export class AppModule {}
