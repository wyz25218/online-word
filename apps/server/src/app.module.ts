import { Module } from '@nestjs/common'
import { UsersModule } from './users/users.module.js'
import { AuthModule } from './auth/auth.module.js'

/** 根模块：按 docs/06 §1 划分，M1 后续逐步引入 docs/permissions/infra 等模块 */
@Module({
  imports: [UsersModule, AuthModule],
})
export class AppModule {}
