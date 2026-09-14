import { Body, Controller, Headers, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import {
  IDEMPOTENCY_HEADER_NAME,
  IDEMPOTENCY_REPLAYED_HEADER,
  IdParam,
  LedgerEntryReverseBody,
  PaymentCreateBody,
  type PaymentResultDto,
} from '@pallet/shared';
import type { Request, Response } from 'express';
import type { AuthContext } from '../../common/auth-context';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PaymentsService } from './payments.service';

/** §6.21: a payment is recorded on its order and deleted through its ledger row. */
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** Idempotent (§6.7): a replayed answer says so in `Idempotency-Replayed`. */
  @Post('orders/:orderId/payments')
  @RequirePermission('payments.create')
  @HttpCode(201)
  async create(
    @Param('orderId', new ZodValidationPipe(IdParam)) orderId: number,
    @Body(new ZodValidationPipe(PaymentCreateBody)) body: PaymentCreateBody,
    @CurrentUser() actor: AuthContext,
    @Headers(IDEMPOTENCY_HEADER_NAME.toLowerCase()) key: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentResultDto> {
    const request = this.idempotency.requestFor(req, key, 'PAYMENT_CREATE', actor.userId, body);
    const result = await this.payments.create(orderId, body, actor, request);
    if (result.replayed) res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
    return result.body;
  }

  @Post('ledger-entries/:id/reverse')
  @RequirePermission('payments.delete')
  @HttpCode(200)
  reverse(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @Body(new ZodValidationPipe(LedgerEntryReverseBody)) body: LedgerEntryReverseBody,
    @CurrentUser() actor: AuthContext,
  ): Promise<PaymentResultDto> {
    return this.payments.reverse(id, body, actor);
  }
}
