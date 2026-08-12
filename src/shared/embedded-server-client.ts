import { ACCESS_TOKEN_HEADER } from '#/shared/access-token.ts'
import { CodedError } from '#/shared/coded-error.ts'

export interface EmbeddedServerRuntime {
  url: string
  accessToken: string
}

export async function requestEmbeddedServerJson<T>(
  runtime: EmbeddedServerRuntime,
  path: string,
  decode: (value: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  return await executeEmbeddedServerJson('query', runtime, path, decode, init)
}

type EmbeddedServerRequestKind = 'query' | 'command'

async function executeEmbeddedServerJson<T>(
  requestKind: EmbeddedServerRequestKind,
  runtime: EmbeddedServerRuntime,
  path: string,
  decode: (value: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(new URL(path, runtime.url).toString(), {
      ...init,
      headers: {
        [ACCESS_TOKEN_HEADER]: runtime.accessToken,
        ...(init?.headers ?? {}),
      },
    })
  } catch (error) {
    if (requestKind === 'query') throw error
    throw new CodedError({
      code: 'OUTCOME_UNCERTAIN',
      message: 'Embedded server request outcome is uncertain',
      cause: error,
    })
  }
  if (!response.ok) throw new Error(`Embedded server request failed (${response.status})`)
  try {
    return decode(await response.json())
  } catch (error) {
    if (requestKind === 'query') throw error
    throw new CodedError({
      code: 'OUTCOME_UNCERTAIN',
      message: 'Embedded server returned an invalid successful response',
      cause: error,
    })
  }
}

export async function postEmbeddedServerJson<T>(
  runtime: EmbeddedServerRuntime,
  path: string,
  body: object,
  decode: (value: unknown) => T,
): Promise<T> {
  return await executeEmbeddedServerJson('command', runtime, path, decode, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}
