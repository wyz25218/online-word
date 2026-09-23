import { Module } from '@nestjs/common'
import { UsersModule } from '../users/users.module.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { JwtAuthGuard } from './jwt-auth.guard.js'

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  // 导出 AuthService 与 UsersModule（传递 UsersService）：JwtAuthGuard 在导入方模块
  // （如 DocsModule）上下文中实例化，需能解析其全部依赖
  exports: [AuthService, UsersModule],
})
export class AuthModule {}
