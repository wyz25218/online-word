import 'reflect-metadata'
import './env.js'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'

/** 开发期允许的跨域来源（生产由网关/nginx 统一，改从环境变量读取） */
const CORS_ORIGINS = ['http://localhost:5173']

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] })
  app.enableCors({ origin: CORS_ORIGINS, credentials: true })

  const port = Number(process.env.PORT ?? '3000')
  await app.listen(port)
  console.log(`[server] listening on http://localhost:${port}`)
}

await bootstrap()
