import type { DriverDto } from '@pallet/shared';
import { pageQuery, type ListParams } from '@/lib/page-query';
import { qk } from '@/lib/query-keys';

export function driverListQuery(params: ListParams) {
  return pageQuery<DriverDto>(qk.drivers.list(params), '/drivers', params);
}
