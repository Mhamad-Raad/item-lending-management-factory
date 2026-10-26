import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import {
  IDEMPOTENCY_HEADER_NAME,
  IDEMPOTENCY_REPLAYED_HEADER,
  IdParam,
  PalletCreditHandBackBody,
  type HandBackReceiptDto,
  type HandBackResultDto,
  type PalletCreditBalanceDto,
} from '@pallet/shared';
import type { Request, Response } from 'express';
import type { AuthContext } from '../../common/auth-context';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PalletCreditsService } from './pallet-credits.service';

/** Q170: what the factory owes a customer of each pallet type, handing it back, and its paper (Q172). */
@Controller()
export class PalletCreditsController {
  constructor(
    private readonly credits: PalletCreditsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('customers/:customerId/pallet-credits')
  @RequirePermission('customers.view')
  balances(@Param('customerId', new ZodValidationPipe(IdParam)) customerId: number): Promise<PalletCreditBalanceDto[]> {
    return this.credits.balances(customerId);
  }

  /** Answers with the entry, for its paper (Q172). Idempotent (§6.7): a press sent twice gives back once. */
  @Post('customers/:customerId/pallet-credits/hand-back')
  @RequirePermission('returns.create')
  @HttpCode(201)
  async handBack(
    @Param('customerId', new ZodValidationPipe(IdParam)) customerId: number,
    @Body(new ZodValidationPipe(PalletCreditHandBackBody)) body: PalletCreditHandBackBody,
    @CurrentUser() actor: AuthContext,
    @Headers(IDEMPOTENCY_HEADER_NAME.toLowerCase()) key: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<HandBackResultDto> {
    const request = this.idempotency.requestFor(req, key, 'PALLET_HAND_BACK', actor.userId, body);
    const result = await this.credits.handBack(customerId, body, actor, request);
    if (result.replayed) res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
    return result.body;
  }

  /** A give-back's paper (Q172), printed in place. */
  @Get('hand-backs/:id/receipt')
  @RequirePermission('customers.view')
  handBackReceipt(@Param('id', new ZodValidationPipe(IdParam)) id: number): Promise<HandBackReceiptDto> {
    return this.credits.handBackReceipt(id);
  }

  /** A give-back recorded by mistake, undone (Q173): what it gave back is owed again. Undoing it twice is no error. */
  @Post('hand-backs/:id/undo')
  @RequirePermission('returns.create')
  @HttpCode(204)
  undoHandBack(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @CurrentUser() actor: AuthContext,
  ): Promise<void> {
    return this.credits.undoHandBack(id, actor);
  }
}
