import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import type { DocRole } from '@online-word/shared'
import { CurrentUser } from '../auth/current-user.decorator.js'
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { requireRole } from '../permissions/doc-role.guard.js'
import { DocsService } from './docs.service.js'
import {
  CreateDocSchema,
  ListDocsQuerySchema,
  UpdateDocSchema,
  type CreateDocInput,
  type DocDetail,
  type DocListResponse,
  type ListDocsQuery,
  type UpdateDocInput,
} from './docs.dto.js'

/**
 * 文档 CRUD（docs/06 §2 文档）：
 * - GET    /docs      我的文档列表（成员可见），分页/关键字/updatedAt 倒序
 * - POST   /docs      新建（事务写 docs + owner 成员）
 * - GET    /docs/:id  详情 + 我的角色（viewer+）
 * - PATCH  /docs/:id  重命名（editor+）
 * - DELETE /docs/:id  软删除（owner）
 */
@Controller('docs')
@UseGuards(JwtAuthGuard)
export class DocsController {
  constructor(private readonly docs: DocsService) {}

  @Get()
  async list(
    @CurrentUser() user: { userId: string },
    @Query(new ZodValidationPipe(ListDocsQuerySchema)) query: ListDocsQuery,
  ): Promise<DocListResponse> {
    return await this.docs.list(user.userId, query)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: { userId: string },
    @Body(new ZodValidationPipe(CreateDocSchema)) dto: CreateDocInput,
  ): Promise<DocDetail> {
    return await this.docs.create(user.userId, dto)
  }

  @Get(':id')
  async detail(@CurrentUser() user: { userId: string }, @Param('id') docId: string): Promise<DocDetail> {
    return await this.docs.getDetail(docId, user.userId)
  }

  @Patch(':id')
  @requireRole('editor' satisfies DocRole)
  async rename(
    @CurrentUser() user: { userId: string },
    @Param('id') docId: string,
    @Body(new ZodValidationPipe(UpdateDocSchema)) dto: UpdateDocInput,
  ): Promise<DocDetail> {
    return await this.docs.rename(docId, user.userId, dto)
  }

  @Delete(':id')
  @requireRole('owner' satisfies DocRole)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') docId: string): Promise<void> {
    return await this.docs.softDelete(docId)
  }
}
