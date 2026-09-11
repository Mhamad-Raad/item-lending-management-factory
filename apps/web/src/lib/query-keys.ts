/** Every query key in one place, so an invalidation can never miss a list (§7.8.2). */
export const qk = {
  me: () => ['me'] as const,
  users: {
    list: (params: Record<string, unknown>) => ['users', 'list', params] as const,
    detail: (id: number) => ['users', 'detail', id] as const,
    all: () => ['users'] as const,
  },
  audit: {
    list: (params: Record<string, unknown>) => ['audit', 'list', params] as const,
  },
} as const;
