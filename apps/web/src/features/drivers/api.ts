import type { DriverDto } from '@pallet/shared';
import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { pageQuery, type ListParams } from '@/lib/page-query';
import { qk } from '@/lib/query-keys';

export function driverQuery(driverId: number) {
  return queryOptions({
    queryKey: qk.drivers.detail(driverId),
    queryFn: () => apiFetch<DriverDto>(`/drivers/${driverId}`),
  });
}

export function driverListQuery(params: ListParams) {
  return pageQuery<DriverDto>(qk.drivers.list(params), '/drivers', params);
}
