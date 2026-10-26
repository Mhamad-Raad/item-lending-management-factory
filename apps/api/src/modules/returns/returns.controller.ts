import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  CustomerReturnCreateBody,
  CustomerReturnReplaceBody,
  type CustomerReturnResultDto,
  type CustomerReturnableDto,
  type CustomerReturnEditableDto,
  IDEMPOTENCY_HEADER_NAME,
  IDEMPOTENCY_REPLAYED_HEADER,
  IdParam,
  type PageDto,
  ReturnCreateBody,
  type ReturnListItemDto,
  ReturnListQuery,
  ReturnReplaceBody,
  type ReturnResultDto,
} from '@pallet/shared';
import type { Request, Response } from 'express';
import type { AuthContext } from '../../common/auth-context';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { ReturnsService } from './returns.service';

/**
 * §6.20: a return is recorded on its order, or on several of a customer's orders at once (Q156), and edited or
 * deleted by its own id.
 */
@Controller()
export class ReturnsController {
  constructor(
    private readonly returns: ReturnsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('returns')
  @RequirePermission('orders.view')
  list(@Query(new ZodValidationPipe(ReturnListQuery)) query: ReturnListQuery): Promise<PageDto<ReturnListItemDto>> {
    return this.returns.list(query);
  }

  /** Idempotent (§6.7): a replayed answer says so in `Idempotency-Replayed`. */
  @Post('orders/:orderId/returns')
  @RequirePermission('returns.create')
  @HttpCode(201)
  async create(
    @Param('orderId', new ZodValidationPipe(IdParam)) orderId: number,
    @Body(new ZodValidationPipe(ReturnCreateBody)) body: ReturnCreateBody,
    @CurrentUser() actor: AuthContext,
    @Headers(IDEMPOTENCY_HEADER_NAME.toLowerCase()) key: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReturnResultDto> {
    const request = this.idempotency.requestFor(req, key, 'RETURN_CREATE', actor.userId, body);
    const result = await this.returns.create(orderId, body, actor, request);
    if (result.replayed) res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
    return result.body;
  }

  /** What the customer still holds, for the return flow (Q156). */
  @Get('customers/:customerId/returnable')
  @RequirePermission('returns.create')
  returnable(@Param('customerId', new ZodValidationPipe(IdParam)) customerId: number): Promise<CustomerReturnableDto> {
    return this.returns.returnableFor(customerId);
  }

  /** Idempotent (§6.7), as a return on one order. */
  @Post('customers/:customerId/returns')
  @RequirePermission('returns.create')
  @HttpCode(201)
  async createForCustomer(
    @Param('customerId', new ZodValidationPipe(IdParam)) customerId: number,
    @Body(new ZodValidationPipe(CustomerReturnCreateBody)) body: CustomerReturnCreateBody,
    @CurrentUser() actor: AuthContext,
    @Headers(IDEMPOTENCY_HEADER_NAME.toLowerCase()) key: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CustomerReturnResultDto> {
    const request = this.idempotency.requestFor(req, key, 'RETURN_CREATE', actor.userId, body);
    const result = await this.returns.createForCustomer(customerId, body, actor, request);
    if (result.replayed) res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
    return result.body;
  }

  @Post('returns/:id/replace')
  @RequirePermission('returns.edit')
  @HttpCode(201)
  replace(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Body(new ZodValidationPipe(ReturnReplaceBody)) body: ReturnReplaceBody,
    @CurrentUser() actor: AuthContext,
  ): Promise<ReturnResultDto> {
    return this.returns.replace(id, body, actor);
  }

  /** A return as the customer screen edits it from the returns list (Q174): a visit whole. */
  @Get('returns/:id/editable')
  @RequirePermission('returns.edit')
  editable(@Param('id', new ZodValidationPipe(IdParam)) id: number): Promise<CustomerReturnEditableDto> {
    return this.returns.editableFor(id);
  }

  /** Not idempotent, as `replace`: a repeat finds the old return reversed (Q174). */
  @Post('returns/:id/replace-customer')
  @RequirePermission('returns.edit')
  @HttpCode(201)
  replaceForCustomer(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Body(new ZodValidationPipe(CustomerReturnReplaceBody)) body: CustomerReturnReplaceBody,
    @CurrentUser() actor: AuthContext,
  ): Promise<CustomerReturnResultDto> {
    return this.returns.replaceForCustomer(id, body, actor);
  }

  @Delete('returns/:id')
  @RequirePermission('returns.delete')
  delete(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @CurrentUser() actor: AuthContext,
  ): Promise<ReturnResultDto> {
    return this.returns.delete(id, actor);
  }
}
