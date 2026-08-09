import { describe, expect, test } from 'vitest'
import { isValidAbsolutePath, MAX_IPC_PATH_LENGTH } from '#/shared/input-validation.ts'

describe('IPC path validation', () => {
  test('rejects oversized paths', () => {
    expect(isValidAbsolutePath(`/${'a'.repeat(MAX_IPC_PATH_LENGTH)}`)).toBe(false)
  })

  test('accepts ordinary absolute paths', () => {
    expect(isValidAbsolutePath('/tmp/repo')).toBe(true)
  })
})
