export function isStringIn<TValue extends string>(values: readonly TValue[], value: unknown): value is TValue {
  return typeof value === 'string' && values.some((candidate) => candidate === value)
}
