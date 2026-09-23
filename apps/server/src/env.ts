/**
 * 环境变量加载：Node 22 原生 process.loadEnvFile（与 prisma.config.ts 保持一致）。
 * 必须在导入 AppModule 之前执行（ESM 按声明顺序执行副作用导入）。
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

const envFile = path.join(import.meta.dirname, '..', '.env')
if (existsSync(envFile)) {
  process.loadEnvFile(envFile)
}
