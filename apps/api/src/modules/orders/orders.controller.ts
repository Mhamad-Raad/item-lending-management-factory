import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import {
  IDEMPOTENCY_HEADER_NAME,
  IDEMPOTENCY_REPLAYED_HEADER,
  IdParam,
  OrderCancelBody,
  OrderCreateBody,
  OrderListQuery,
  OrderUpdateBody,
  type OrderDetailDto,
  type OrderListItemDto,
  type PageDto,
  type ReceiptDto,
} from '@pallet/shared';
import type { Request, Response } from 'express';
import type { AuthContext } from '../../common/auth-context';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { OrderChangesService } from './order-changes.service';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly changes: OrderChangesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @RequirePermission('orders.view')
  list(@Query(new ZodValidationPipe(OrderListQuery)) query: OrderListQuery): Promise<PageDto<OrderListItemDto>> {
    return this.orders.list(query);
  }

  @Get(':id')
  @RequirePermission('orders.view')
  get(@Param('id', new ZodValidationPipe(IdParam)) id: number): Promise<OrderDetailDto> {
    return this.orders.get(id);
  }

  /** Idempotent (§6.7): a replayed answer says so in `Idempotency-Replayed`. */
  @Post()
  @RequirePermission('orders.create')
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(OrderCreateBody)) body: OrderCreateBody,
    @CurrentUser() actor: AuthContext,
    @Headers(IDEMPOTENCY_HEADER_NAME.toLowerCase()) key: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderDetailDto> {
    const request = {
      userId: actor.userId,
      key: this.idempotency.keyFrom(key),
      scope: 'ORDER_CREATE' as const,
      // The concrete path and the validated body: the same order sent again hashes the same.
      requestHash: this.idempotency.requestHash(req.method, req.originalUrl.split('?')[0] ?? '', body),
    };
    const result = await this.orders.create(body, actor, request);
    if (result.replayed) res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
    return result.body;
  }

  @Patch(':id')
  @RequirePermission('orders.edit')
  update(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Body(new ZodValidationPipe(OrderUpdateBody)) body: OrderUpdateBody,
    @CurrentUser() actor: AuthContext,
  ): Promise<OrderDetailDto> {
    return this.changes.update(id, body, actor);
  }

  @Post(':id/cancel')
  @RequirePermission('orders.cancel')
  @HttpCode(200)
  cancel(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Body(new ZodValidationPipe(OrderCancelBody)) body: OrderCancelBody,
    @CurrentUser() actor: AuthContext,
  ): Promise<OrderDetailDto> {
    return this.changes.cancel(id, body.version, actor);
  }

  @Get(':id/receipt')
  @RequirePermission('orders.view')
  receipt(@Param('id', new ZodValidationPipe(IdParam)) id: number): Promise<ReceiptDto> {
    return this.orders.receipt(id);
  }
}
