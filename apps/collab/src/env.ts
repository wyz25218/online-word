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
