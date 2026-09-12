import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  IdParam,
  ItemCreateBody,
  ItemListQuery,
  ItemUpdateBody,
  StockAdjustmentCreateBody,
  StockMovementListQuery,
  VersionQuery,
  type ItemDto,
  type PageDto,
  type StockAdjustmentResultDto,
  type StockMovementDto,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ItemsService } from './items.service';

@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @RequirePermission('items.view')
  list(@Query(new ZodValidationPipe(ItemListQuery)) query: ItemListQuery): Promise<PageDto<ItemDto>> {
    return this.items.list(query);
  }

  @Get(':id')
  @RequirePermission('items.view')
  get(@Param('id', new ZodValidationPipe(IdParam)) id: number): Promise<ItemDto> {
    return this.items.get(id);
  }

  @Post()
  @RequirePermission('items.create')
  create(
    @Body(new ZodValidationPipe(ItemCreateBody)) body: ItemCreateBody,
    @CurrentUser() actor: AuthContext,
  ): Promise<ItemDto> {
    return this.items.create(body, actor);
  }

  @Patch(':id')
  @RequirePermission('items.edit')
  update(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Body(new ZodValidationPipe(ItemUpdateBody)) body: ItemUpdateBody,
  ): Promise<ItemDto> {
    return this.items.update(id, body);
  }

  /** Always an archive (A1); the version travels in the query, as a DELETE has no body. */
  @Delete(':id')
  @RequirePermission('items.delete')
  archive(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Query(new ZodValidationPipe(VersionQuery)) query: VersionQuery,
    @CurrentUser() actor: AuthContext,
  ): Promise<ItemDto> {
    return this.items.archive(id, query.version, actor);
  }

  @Post(':id/stock-adjustments')
  @RequirePermission('items.adjustStock')
  adjustStock(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Body(new ZodValidationPipe(StockAdjustmentCreateBody)) body: StockAdjustmentCreateBody,
    @CurrentUser() actor: AuthContext,
  ): Promise<StockAdjustmentResultDto> {
    return this.items.adjustStock(id, body, actor);
  }

  @Get(':id/stock-movements')
  @RequirePermission('items.view')
  movements(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Query(new ZodValidationPipe(StockMovementListQuery)) query: StockMovementListQuery,
  ): Promise<PageDto<StockMovementDto>> {
    return this.items.movements(id, query);
  }
}
