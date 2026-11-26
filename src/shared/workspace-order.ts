export const WORKSPACE_ORDER_EDGES = ['first', 'last'] as const
export type WorkspaceOrderEdge = (typeof WORKSPACE_ORDER_EDGES)[number]
