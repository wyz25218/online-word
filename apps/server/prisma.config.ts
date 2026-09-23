import path from 'node:path'
import { existsSync } from 'node:fs'
import { defineConfig, env } from 'prisma/config'

// Prisma 7 CLI 不再自动加载 .env，也不再用 schema 内 env() 解析迁移连接串，
// 这里显式加载 apps/server/.env 并把 DATABASE_URL 注入 CLI 的 datasource。
const envFile = path.join(__dirname, '.env')
if (existsSync(envFile)) {
  process.loadEnvFile(envFile)
}

export default defineConfig({
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  migrations: {
    path: path.join(__dirname, 'prisma', 'migrations'),
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
