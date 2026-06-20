type MaybePromise<T> = T | Promise<T>

export interface WorkspacePaneProviderWorktreeInput<TOwner extends string | number> {
  ownerId: TOwner
  scope: string
  worktreePath: string
}

export interface WorkspacePaneProviderViewIdentity<TType extends string = string> {
  type: TType
  id: string
}

export interface WorkspacePaneProviderOpenInput<
  TOwner extends string | number,
> extends WorkspacePaneProviderWorktreeInput<TOwner> {
  id?: string
}

export interface WorkspacePaneProviderCloseInput<TOwner extends string | number, TType extends string = string>
  extends WorkspacePaneProviderWorktreeInput<TOwner>, WorkspacePaneProviderViewIdentity<TType> {}

export interface WorkspacePaneProviderViewMetadata<
  TType extends string = string,
> extends WorkspacePaneProviderViewIdentity<TType> {
  title: string
  tooltip?: string
  badge?: string | number | null
  state?: string | null
}

export interface WorkspacePaneViewProvider<TOwner extends string | number, TType extends string = string> {
  readonly type: TType
  open(input: WorkspacePaneProviderOpenInput<TOwner>): MaybePromise<WorkspacePaneProviderViewIdentity<TType> | null>
  close(input: WorkspacePaneProviderCloseInput<TOwner, TType>): MaybePromise<boolean>
  metadata(
    input: WorkspacePaneProviderCloseInput<TOwner, TType>,
  ): MaybePromise<WorkspacePaneProviderViewMetadata<TType> | null>
}
