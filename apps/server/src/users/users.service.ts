import { Injectable } from '@nestjs/common'

/** 登录后返回给前端的公开用户信息（不含凭证；role 属于"用户×文档"维度，见 AwarenessUser） */
export interface PublicUser {
  userId: string
  name: string
  color: string
}

/** T1.1 桩用户表：硬编码 3 个测试用户；users 表落库后替换为 Prisma 查询 + 密码哈希（argon2/bcrypt） */
export interface StubUser extends PublicUser {
  username: string
  password: string
}

const STUB_USERS: StubUser[] = [
  { userId: '11111111-1111-4111-8111-111111111111', username: 'alice', password: 'alice123', name: 'Alice', color: '#1a73e8' },
  { userId: '22222222-2222-4222-8222-222222222222', username: 'bob', password: 'bob123', name: 'Bob', color: '#e8710a' },
  { userId: '33333333-3333-4333-8333-333333333333', username: 'carol', password: 'carol123', name: 'Carol', color: '#188038' },
]

@Injectable()
export class UsersService {
  /** 桩实现：明文比对；落库后改为哈希校验 + 恒定时间比较 */
  verifyCredentials(username: string, password: string): StubUser | undefined {
    return STUB_USERS.find((u) => u.username === username && u.password === password)
  }

  findById(userId: string): StubUser | undefined {
    return STUB_USERS.find((u) => u.userId === userId)
  }

  toPublic(user: StubUser): PublicUser {
    return { userId: user.userId, name: user.name, color: user.color }
  }
}
