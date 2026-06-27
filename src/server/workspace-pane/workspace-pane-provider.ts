type MaybePromise<T> = T | Promise<T>

export interface WorkspacePaneProviderWorktreeInput<TUser extends string | number> {
  userId: TUser
  scope: string
  worktreePath: string
}

export interface WorkspacePaneTabIdentity<TType extends string = string> {
  type: TType
  id: string
}

export interface WorkspacePaneProviderOpenInput<
  TUser extends string | number,
> extends WorkspacePaneProviderWorktreeInput<TUser> {
  id?: string
}

export interface WorkspacePaneProviderCloseInput<TUser extends string | number, TType extends string = string>
  extends WorkspacePaneProviderWorktreeInput<TUser>, WorkspacePaneTabIdentity<TType> {}

export interface WorkspacePaneTabMetadata<TType extends string = string> extends WorkspacePaneTabIdentity<TType> {
  title: string
  tooltip?: string
  badge?: string | number | null
  state?: string | null
}

export interface WorkspacePaneTabProvider<TUser extends string | number, TType extends string = string> {
  readonly type: TType
  open(input: WorkspacePaneProviderOpenInput<TUser>): MaybePromise<WorkspacePaneTabIdentity<TType> | null>
  close(input: WorkspacePaneProviderCloseInput<TUser, TType>): MaybePromise<boolean>
  metadata(input: WorkspacePaneProviderCloseInput<TUser, TType>): MaybePromise<WorkspacePaneTabMetadata<TType> | null>
}
