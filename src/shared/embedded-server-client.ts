import { ACCESS_TOKEN_HEADER } from '#/shared/access-token.ts'

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
  const response = await fetch(new URL(path, runtime.url).toString(), {
    ...init,
    headers: {
      [ACCESS_TOKEN_HEADER]: runtime.accessToken,
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) throw new Error(`Embedded server request failed (${response.status})`)
  return decode(await response.json())
}

export async function postEmbeddedServerJson<T>(
  runtime: EmbeddedServerRuntime,
  path: string,
  body: object,
  decode: (value: unknown) => T,
  options?: { signal?: AbortSignal },
): Promise<T> {
  return await requestEmbeddedServerJson(runtime, path, decode, {
    method: 'POST',
    signal: options?.signal,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}
