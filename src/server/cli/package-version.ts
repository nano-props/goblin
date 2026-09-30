import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as v from 'valibot'

const packageVersionSchema = v.object({ version: v.string() })

export function readPackageVersion(): string {
  const root = Bun.isStandaloneExecutable ? import.meta.dirname : path.resolve(import.meta.dirname, '../../..')
  const packageJson: unknown = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  return v.parse(packageVersionSchema, packageJson).version
}
