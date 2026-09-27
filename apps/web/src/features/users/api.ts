import type { UserListItemDto } from '@pallet/shared';
import { pageQuery, type ListParams } from '@/lib/page-query';
import { qk } from '@/lib/query-keys';

export function userListQuery(params: ListParams) {
  return pageQuery<UserListItemDto>(qk.users.list(params), '/users', params);
}
