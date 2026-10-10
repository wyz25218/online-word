import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * 环境变量加载：Node 22 原生 process.loadEnvFile（与 apps/server/env.ts 一致）。
 * 必须在读取 process.env 的模块之前导入（ESM 按声明顺序执行副作用导入）。
 */
const envFile = path.join(import.meta.dirname, '..', '.env')
if (existsSync(envFile)) {
  process.loadEnvFile(envFile)
}

function requireEnv(key: string): string {
  const value = process.env[key]
  if (value === undefined || value === '') {
    throw new Error(`环境变量 ${key} 未配置（检查 apps/collab/.env）`)
  }
  return value
}

/** server 内部接口基地址与密钥（membership 验权 / 评论抽取回写共用） */
export const INTERNAL_URL = requireEnv('SERVER_INTERNAL_URL').replace(/\/+$/, '')
export const INTERNAL_API_KEY = requireEnv('INTERNAL_API_KEY')
