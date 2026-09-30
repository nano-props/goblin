import * as v from 'valibot'
import { DirectoryPathPrefixSchema } from '#/shared/directory-path-suggestions.ts'

// A single bounded server-local directory in the browser-addressable /open URL.
export const WorkspaceOpenPathSchema = v.pipe(
  DirectoryPathPrefixSchema,
  v.check((value) => value.startsWith('/'), 'Expected an absolute directory path'),
)
