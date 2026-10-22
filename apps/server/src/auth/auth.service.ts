import { randomUUID } from 'node:crypto'
import { Injectable, UnauthorizedException } from '@nestjs/common'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { UsersService, type PublicUser, type StubUser } from '../users/users.service.js'
import type { CollabTokenResponse, LoginResponse, RefreshInput } from './auth.dto.js'

/**
 * JWT 载荷契约（docs/06 §3）：
 * - access：通用 API 令牌 { sub, name, use:'access' }
 * - refresh：续签令牌 { sub, jti, use:'refresh' }（jti 为后续轮换/撤销预留）
 * - collab：WS 一次性令牌 { sub, name, docId, jti, use:'collab' }，绑定 docId、5min
 * use 字段防止三类令牌互相冒用。
 */
export interface AccessClaims extends JWTPayload {
  use: 'access'
  sub: string
  name: string
}

export interface RefreshClaims extends JWTPayload {
  use: 'refresh'
  sub: string
  jti: string
}

export interface CollabClaims extends JWTPayload {
  use: 'collab'
  sub: string
  name: string
  docId: string
  jti: string
}

const textEncoder = new TextEncoder()

function requireSecret(key: string): Uint8Array {
  const value = process.env[key]
  if (value === undefined || value.length < 16) {
    throw new Error(`环境变量 ${key} 未配置或长度不足 16（检查 apps/server/.env）`)
  }
  return textEncoder.encode(value)
}

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/** jose 的 setExpirationTime(number) 语义是"绝对 Unix 秒"而非时长，必须显式换算 */
function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

@Injectable()
export class AuthService {
  private readonly accessKey = requireSecret('JWT_ACCESS_SECRET')
  private readonly refreshKey = requireSecret('JWT_REFRESH_SECRET')
  private readonly collabKey = requireSecret('JWT_COLLAB_SECRET')
  private readonly accessTtlSec = intEnv('ACCESS_TOKEN_TTL_SEC', 900)
  private readonly refreshTtlSec = intEnv('REFRESH_TOKEN_TTL_SEC', 604800)
  private readonly collabTtl = intEnv('COLLAB_TOKEN_TTL_SEC', 300)

  constructor(private readonly users: UsersService) {}

  /** WS token 有效期（秒），Controller 返回给前端使用 */
  get collabTtlSec(): number {
    return this.collabTtl
  }

  async issueTokens(user: StubUser): Promise<LoginResponse> {
    const [accessToken, refreshToken] = await Promise.all([
      this.signAccess(user),
      this.signRefresh(user),
    ])
    return { accessToken, refreshToken, user: this.users.toPublic(user) }
  }

  /**
   * 用 refreshToken 换发新令牌对。
   * TODO(M2 安全加固)：refresh 轮换 + jti 撤销名单（Redis），当前桩阶段仅校验签名。
   */
  async rotateRefresh(input: RefreshInput): Promise<LoginResponse> {
    const claims = await this.verifyRefresh(input.refreshToken)
    const user = this.users.findById(claims.sub)
    if (user === undefined) throw new UnauthorizedException('用户不存在')
    return await this.issueTokens(user)
  }

  /** 签发绑定 docId 的一次性 WS token（jti 去重由网关侧在 T1.5 落地） */
  async issueCollabToken(user: PublicUser, docId: string): Promise<CollabTokenResponse> {
    const token = await new SignJWT({ use: 'collab', name: user.name, docId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.userId)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(nowSec() + this.collabTtl)
      .sign(this.collabKey)
    return { docId, token, expiresIn: this.collabTtl }
  }

  /**
   * T2.5 匿名分享链路：签发 sub='anon:<session>' 的 collab JWT。
   * 带 linkToken claim——collab 网关通过它在 internal membership 接口查 share-link mode，
   * 从而拿到 anyone_view/read / anyone_edit/write 的权限（模式随时变更可实时生效）。
   */
  async issueAnonymousCollabToken(params: {
    anonymousId: string
    docId: string
    displayName: string
    linkToken: string
  }): Promise<CollabTokenResponse> {
    const token = await new SignJWT({ use: 'collab', name: params.displayName, docId: params.docId, linkToken: params.linkToken })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(params.anonymousId) // 'anon:<session>'
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(nowSec() + this.collabTtl)
      .sign(this.collabKey)
    return { docId: params.docId, token, expiresIn: this.collabTtl }
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    const payload = await this.verifyJwt(token, this.accessKey)
    if (payload.use !== 'access' || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('token 无效或已过期')
    }
    return payload as unknown as AccessClaims
  }

  async verifyRefresh(token: string): Promise<RefreshClaims> {
    const payload = await this.verifyJwt(token, this.refreshKey)
    if (payload.use !== 'refresh' || typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
      throw new UnauthorizedException('token 无效或已过期')
    }
    return payload as unknown as RefreshClaims
  }

  private async verifyJwt(token: string, key: Uint8Array): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })
      return payload
    } catch {
      throw new UnauthorizedException('token 无效或已过期')
    }
  }

  private async signAccess(user: PublicUser): Promise<string> {
    return await new SignJWT({ use: 'access', name: user.name })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.userId)
      .setIssuedAt()
      .setExpirationTime(nowSec() + this.accessTtlSec)
      .sign(this.accessKey)
  }

  private async signRefresh(user: StubUser): Promise<string> {
    return await new SignJWT({ use: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.userId)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(nowSec() + this.refreshTtlSec)
      .sign(this.refreshKey)
  }
}
