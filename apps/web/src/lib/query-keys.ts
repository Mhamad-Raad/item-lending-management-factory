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
    /** What the factory owes the customer of each pallet type (Q170). */
    palletCredits: (id: number) => ['customers', 'pallet-credits', id] as const,
    /** A give-back's paper (Q172). */
    handBackReceipt: (id: number) => ['customers', 'hand-back-receipt', id] as const,
    history: (id: number, params: Record<string, unknown>) => ['customers', 'history', id, params] as const,
    phoneCheck: (phone: string, excludeId: number | undefined) =>
      ['customers', 'phoneCheck', phone, excludeId ?? null] as const,
  },
  orders: {
    all: () => ['orders'] as const,
    list: (params: Record<string, unknown>) => ['orders', 'list', params] as const,
    detail: (id: number) => ['orders', 'detail', id] as const,
    receipt: (id: number) => ['orders', 'receipt', id] as const,
    transactionsReceipt: (id: number) => ['orders', 'transactionsReceipt', id] as const,
    /** Under `orders`: every order change can move what a customer still holds (Q156). */
    returnable: (customerId: number) => ['orders', 'returnable', customerId] as const,
    /** Under `orders`: every return recorded, corrected or deleted changes the returns list (Q168). */
    returnsList: (params: Record<string, unknown>) => ['orders', 'returns-list', params] as const,
  },
  ledger: {
    all: () => ['ledger'] as const,
    receipt: (id: number) => ['ledger', 'receipt', id] as const,
    /** A customer return's one receipt over its orders (Q161). */
    customerReturnReceipt: (id: number) => ['ledger', 'customer-return-receipt', id] as const,
    /** One return's paper, when it paid no cash back (Q166). */
    returnReceipt: (id: number) => ['ledger', 'return-receipt', id] as const,
  },
  drivers: {
    all: () => ['drivers'] as const,
    list: (params: Record<string, unknown>) => ['drivers', 'list', params] as const,
    detail: (id: number) => ['drivers', 'detail', id] as const,
    phoneChecks: () => ['drivers', 'phoneCheck'] as const,
    phoneCheck: (phone: string, excludeId: number | undefined) =>
      ['drivers', 'phoneCheck', phone, excludeId ?? null] as const,
  },
} as const;
