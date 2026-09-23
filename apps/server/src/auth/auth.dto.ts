import { z } from 'zod'
import type { PublicUser } from '../users/users.service.js'

// docId 暂不约束 UUID：T1.2 docs 表落库后再收紧为 uuid + 存在性校验（T1.1 桩放行任意非空 docId）
export const DocIdSchema = z.string().min(1, 'docId 必填')

export const LoginSchema = z.object({
  username: z.string().min(1, '用户名必填'),
  password: z.string().min(1, '密码必填'),
})

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken 必填'),
})

export type LoginInput = z.infer<typeof LoginSchema>
export type RefreshInput = z.infer<typeof RefreshSchema>

/** POST /auth/login 与 /auth/refresh 的响应 */
export interface LoginResponse {
  accessToken: string
  refreshToken: string
  user: PublicUser
}

/** GET /collab/token 的响应（token 供 HocuspocusProvider ?token= 使用） */
export interface CollabTokenResponse {
  docId: string
  token: string
  /** WS token 有效期（秒），前端据此决定何时提前换新 */
  expiresIn: number
}
