export type PhysicalWorktreeIdentity =
  | { kind: 'local'; executionNamespaceId: 'local'; endpoint: string }
  | { kind: 'remote'; executionNamespaceId: string; endpoint: string }

export function physicalWorktreeIdentityKey(identity: PhysicalWorktreeIdentity): string {
  return `${identity.kind}\0${identity.executionNamespaceId}\0${identity.endpoint}`
}
