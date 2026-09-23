import { BadRequestException, type ArgumentMetadata, type PipeTransform } from '@nestjs/common'
import type { ZodType } from 'zod'

/**
 * 基于 zod 的参数校验管道：NestJS 12 (ESM) 下不引入 class-validator/class-transformer
 * （CJS + 重度依赖元数据），统一用 zod schema 做边界校验。
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    const result = this.schema.safeParse(value)
    if (!result.success) {
      const detail = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
      throw new BadRequestException(detail)
    }
    return result.data
  }
}
