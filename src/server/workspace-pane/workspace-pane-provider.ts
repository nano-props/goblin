type MaybePromise<T> = T | Promise<T>

export interface WorkspacePaneProviderWorktreeInput<TUser extends string | number> {
  userId: TUser
  scope: string
  worktreePath: string
}

export interface WorkspacePaneProviderViewIdentity<TType extends string = string> {
  type: TType
  id: string
}

export interface WorkspacePaneProviderOpenInput<
  TUser extends string | number,
> extends WorkspacePaneProviderWorktreeInput<TUser> {
  id?: string
}

export interface WorkspacePaneProviderCloseInput<TUser extends string | number, TType extends string = string>
  extends WorkspacePaneProviderWorktreeInput<TUser>, WorkspacePaneProviderViewIdentity<TType> {}

export interface WorkspacePaneProviderViewMetadata<
  TType extends string = string,
> extends WorkspacePaneProviderViewIdentity<TType> {
  title: string
  tooltip?: string
  badge?: string | number | null
  state?: string | null
}

export interface WorkspacePaneViewProvider<TUser extends string | number, TType extends string = string> {
  readonly type: TType
  open(input: WorkspacePaneProviderOpenInput<TUser>): MaybePromise<WorkspacePaneProviderViewIdentity<TType> | null>
  close(input: WorkspacePaneProviderCloseInput<TUser, TType>): MaybePromise<boolean>
  metadata(
    input: WorkspacePaneProviderCloseInput<TUser, TType>,
  ): MaybePromise<WorkspacePaneProviderViewMetadata<TType> | null>
}
