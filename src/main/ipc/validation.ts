import path from 'node:path'
import { isSafeBranchName } from '#/shared/refnames.ts'

export function isValidAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0') && path.isAbsolute(value)
}

export function isValidCwd(value: unknown): value is string {
  return isValidAbsolutePath(value)
}

export function isValidBranch(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && isSafeBranchName(value)
}

export function isValidOptionalBranch(value: unknown): value is string | undefined {
  return value === undefined || isValidBranch(value)
}
