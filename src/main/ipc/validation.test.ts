import { describe, expect, test } from 'vitest'
import {
  isValidAbsolutePath,
  isValidBranch,
  MAX_IPC_BRANCH_LENGTH,
  MAX_IPC_PATH_LENGTH,
} from '#/main/ipc/validation.ts'

describe('IPC validation', () => {
  test('rejects oversized paths', () => {
    expect(isValidAbsolutePath(`/${'a'.repeat(MAX_IPC_PATH_LENGTH)}`)).toBe(false)
  })

  test('rejects oversized branch names', () => {
    expect(isValidBranch('a'.repeat(MAX_IPC_BRANCH_LENGTH + 1))).toBe(false)
  })

  test('still accepts ordinary absolute paths and branch names', () => {
    expect(isValidAbsolutePath('/tmp/repo')).toBe(true)
    expect(isValidBranch('feature/add-tests')).toBe(true)
  })
})
