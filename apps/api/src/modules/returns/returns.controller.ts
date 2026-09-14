import { Body, Controller, Delete, Headers, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import {
  IDEMPOTENCY_HEADER_NAME,
  IDEMPOTENCY_REPLAYED_HEADER,
  IdParam,
  ReturnCreateBody,
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

/** §6.20: a return is recorded on its order, and edited or deleted by its own id. */
@Controller()
export class ReturnsController {
  constructor(
    private readonly returns: ReturnsService,
    private readonly idempotency: IdempotencyService,
  ) {}

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

  @Delete('returns/:id')
  @RequirePermission('returns.delete')
  delete(
    @Param('id', new ZodValidationPipe(IdParam)) id: number,
    @CurrentUser() actor: AuthContext,
  ): Promise<ReturnResultDto> {
    return this.returns.delete(id, actor);
  }
}
