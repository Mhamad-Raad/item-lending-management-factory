/** Every query key in one place, so an invalidation can never miss a list (§7.8.2). */
export const qk = {
  me: () => ['me'] as const,
  settings: () => ['settings'] as const,
  dashboard: () => ['dashboard'] as const,
  reports: {
    all: () => ['reports'] as const,
  },
  users: {
    list: (params: Record<string, unknown>) => ['users', 'list', params] as const,
    detail: (id: number) => ['users', 'detail', id] as const,
    all: () => ['users'] as const,
  },
  audit: {
    list: (params: Record<string, unknown>) => ['audit', 'list', params] as const,
  },
  items: {
    all: () => ['items'] as const,
    list: (params: Record<string, unknown>) => ['items', 'list', params] as const,
    detail: (id: number) => ['items', 'detail', id] as const,
    movements: (id: number, params: Record<string, unknown>) => ['items', 'movements', id, params] as const,
  },
  purchases: {
    all: () => ['purchases'] as const,
    list: (params: Record<string, unknown>) => ['purchases', 'list', params] as const,
  },
  customers: {
    all: () => ['customers'] as const,
    list: (params: Record<string, unknown>) => ['customers', 'list', params] as const,
    detail: (id: number) => ['customers', 'detail', id] as const,
    phoneCheck: (phone: string, excludeId: number | undefined) =>
      ['customers', 'phoneCheck', phone, excludeId ?? null] as const,
  },
  drivers: {
    all: () => ['drivers'] as const,
    list: (params: Record<string, unknown>) => ['drivers', 'list', params] as const,
    detail: (id: number) => ['drivers', 'detail', id] as const,
  },
} as const;
