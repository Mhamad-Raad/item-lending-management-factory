import { Controller, Get, Query } from '@nestjs/common';
import {
  ActivityReportQuery,
  PositionsReportQuery,
  PurchasesReportQuery,
  StockReportQuery,
  type ActivityReportDto,
  type PositionsReportDto,
  type PurchasesReportDto,
  type StockReportDto,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('positions')
  @RequirePermission('reports.viewPositions')
  positions(
    @Query(new ZodValidationPipe(PositionsReportQuery)) query: PositionsReportQuery,
  ): Promise<PositionsReportDto> {
    return this.reports.positions(query);
  }

  @Get('purchases')
  @RequirePermission('reports.viewPurchases')
  purchases(
    @Query(new ZodValidationPipe(PurchasesReportQuery)) query: PurchasesReportQuery,
    @CurrentUser() actor: AuthContext,
  ): Promise<PurchasesReportDto> {
    return this.reports.purchases(query, actor);
  }

  @Get('activity')
  @RequirePermission('reports.viewActivity')
  activity(@Query(new ZodValidationPipe(ActivityReportQuery)) query: ActivityReportQuery): Promise<ActivityReportDto> {
    return this.reports.activity(query);
  }

  @Get('stock')
  @RequirePermission('reports.viewStock')
  stock(@Query(new ZodValidationPipe(StockReportQuery)) query: StockReportQuery): Promise<StockReportDto> {
    return this.reports.stock(query);
  }
}
