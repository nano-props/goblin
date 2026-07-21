import * as v from 'valibot'
import { MAX_WORKSPACE_LOCATOR_LENGTH } from '#/shared/workspace-locator.ts'

export const DirectoryPathPrefixSchema = v.pipe(
  v.string(),
  v.maxLength(MAX_WORKSPACE_LOCATOR_LENGTH, 'path prefix too long'),
  v.check((value) => !/[\u0000-\u001f\u007f]/u.test(value), 'path prefix contains control characters'),
)

export interface RemoteDirectoryPathSuggestionsInput {
  alias: string
  prefix: string
}
