/**
 * dev 编排：tsc --watch（编译 + 产出装饰器元数据）与 node --watch dist/main.js 双进程。
 *
 * 为什么不用 tsx/esbuild：esbuild 不支持 emitDecoratorMetadata，
 * NestJS 构造器注入依赖的 design:paramtypes 元数据不会产出，DI 运行时必挂
 * （2026-09-23 实测：tsx 下 Reflect.getMetadata('design:paramtypes') === undefined，见 docs/09 进度日志 T1.1）。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tscEntry = path.join(pkgRoot, 'node_modules', 'typescript', 'bin', 'tsc')
const distEntry = path.join(pkgRoot, 'dist', 'main.js')

const tsc = spawn(process.execPath, [tscEntry, '--watch', '--preserveWatchOutput'], {
  cwd: pkgRoot,
  stdio: 'inherit',
})

/** 等首批编译产物出现后再启动 node --watch，避免找不到入口的启动竞态 */
let node = null
const timer = setInterval(() => {
  if (node !== null || !existsSync(distEntry)) return
  clearInterval(timer)
  node = spawn(process.execPath, ['--watch', distEntry], { cwd: pkgRoot, stdio: 'inherit' })
}, 150)

function killAll() {
  clearInterval(timer)
  tsc.kill()
  if (node !== null) node.kill()
}

process.on('SIGINT', () => {
  killAll()
  process.exit(0)
})
process.on('SIGTERM', () => {
  killAll()
  process.exit(0)
})
tsc.on('exit', (code) => {
  killAll()
  console.error(`[dev] tsc 已退出（code=${code}），dev 编排终止`)
  process.exit(code ?? 1)
})
