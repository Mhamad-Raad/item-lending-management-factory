import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  IdParam,
  PurchaseBatchCreateBody,
  PurchaseBatchListQuery,
  PurchaseBatchUpdateBody,
  VersionQuery,
  type PageDto,
  type PurchaseBatchDto,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PurchasesService } from './purchases.service';

@Controller('purchase-batches')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  /** Readable with `purchases.view`; the cost fields additionally need `items.viewCost`. */
  @Get()
  @RequirePermission('purchases.view')
  list(
    @Query(new ZodValidationPipe(PurchaseBatchListQuery)) query: PurchaseBatchListQuery,
    @CurrentUser() actor: AuthContext,
  ): Promise<PageDto<PurchaseBatchDto>> {
    return this.purchases.list(query, actor.canViewCost);
  }

  @Post()
  @RequirePermission('purchases.create')
  create(
    @Body(new ZodValidationPipe(PurchaseBatchCreateBody)) body: PurchaseBatchCreateBody,
    @CurrentUser() actor: AuthContext,
  ): Promise<PurchaseBatchDto> {
    return this.purchases.create(body, actor);
  }

  @Patch(':id')
  @RequirePermission('purchases.edit')
  update(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Body(new ZodValidationPipe(PurchaseBatchUpdateBody)) body: PurchaseBatchUpdateBody,
    @CurrentUser() actor: AuthContext,
  ): Promise<PurchaseBatchDto> {
    return this.purchases.update(id, body, actor);
  }

  @Delete(':id')
  @RequirePermission('purchases.delete')
  @HttpCode(204)
  remove(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Query(new ZodValidationPipe(VersionQuery)) query: VersionQuery,
    @CurrentUser() actor: AuthContext,
  ): Promise<void> {
    return this.purchases.remove(id, query.version, actor);
  }
}
