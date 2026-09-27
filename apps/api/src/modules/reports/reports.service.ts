import { Injectable } from '@nestjs/common';
import type {
  ActivityReportDto,
  ActivityReportQuery,
  PositionsReportDto,
  PositionsReportQuery,
  PurchasesReportDto,
  PurchasesReportQuery,
  StockReportDto,
  StockReportQuery,
} from '@pallet/shared';
import type { AuthContext } from '../../common/auth-context';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import { assertDateRange, assertNotInFuture } from '../../common/utils/dates';
import { PrismaService } from '../../prisma/prisma.service';
import { runInSnapshot } from '../../prisma/transaction';
import { queryActivityReport } from './activity-report';
import { queryPositionsReport } from './positions-report';
import { queryPurchasesReport } from './purchases-report';
import { queryStockReport } from './stock-report';

export { ROW_CAP } from './report-rows';

/**
 * The four reports (§6.23, §12). Every aggregate is SQL over the stored order cache and ledger rows,
 * leaving out cancelled orders, reversed returns and deleted batches; rows are then hydrated in
 * batched reads for their names. Response shapes are §6.9's (Q42). Each report lives in its own file;
 * this service checks the request and runs the report in one snapshot, so its keys, totals and names
 * all see the same moment.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  positions(query: PositionsReportQuery): Promise<PositionsReportDto> {
    return runInSnapshot(this.prisma, (db) => queryPositionsReport(db, query, this.clock));
  }

  purchases(query: PurchasesReportQuery, actor: AuthContext): Promise<PurchasesReportDto> {
    return runInSnapshot(this.prisma, async (db) => {
      // The route's permission implies cost access today; this holds even if that dependency changes (§6.23).
      if (!actor.canViewCost) throw new ApiError('PERMISSION_DENIED', { required: ['items.viewCost'] });
      this.assertPeriod(query.dateFrom, query.dateTo);
      return queryPurchasesReport(db, query, this.clock);
    });
  }

  activity(query: ActivityReportQuery): Promise<ActivityReportDto> {
    return runInSnapshot(this.prisma, async (db) => {
      this.assertPeriod(query.dateFrom, query.dateTo);
      return queryActivityReport(db, query, this.clock);
    });
  }

  stock(query: StockReportQuery): Promise<StockReportDto> {
    return runInSnapshot(this.prisma, (db) => queryStockReport(db, query, this.clock));
  }

  /** §12.1: an inclusive business-date period, the right way round and not reaching past today. */
  private assertPeriod(dateFrom: string, dateTo: string): void {
    assertDateRange(dateFrom, dateTo);
    assertNotInFuture(this.clock, dateFrom, 'dateFrom');
    assertNotInFuture(this.clock, dateTo, 'dateTo');
  }
}
