import { PrismaClient } from './generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'

/**
 * 业务库 PrismaClient 单例。
 *
 * Prisma 7 不再从 schema 读连接串：运行时通过 @prisma/adapter-pg 注入连接。
 * DATABASE_URL 由 apps/server/.env 提供（Node 22 原生 process.loadEnvFile 加载）。
 */
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://localhost:5432/online_word')
const adapter = new PrismaPg({
  host: url.hostname,
  port: Number(url.port),
  user: url.username,
  password: url.password,
  database: url.pathname.replace(/^\//, ''),
  ssl: false,
})

export const prisma = new PrismaClient({ adapter })
