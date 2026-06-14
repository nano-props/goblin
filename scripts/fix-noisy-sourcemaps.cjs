#!/usr/bin/env bun
// Post-install: strip the `//# sourceMappingURL=...` line from npm packages
// that ship `.map` files pointing at source paths that are not actually
// published (typically the package's own TypeScript sources). bun prints
// `Sourcemap for ... points to missing source files` to stderr for every
// such case at module load time, which clutters test output.
//
// Today this affects only `ssh-config` (its `lib/*.js.map` files reference
// `../src/*.ts` files that are not in the npm tarball). If you hit another
// package, add it to PACKAGES below.

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const PACKAGES = ['ssh-config']

function stripSourceMapURL(jsFile) {
  const original = fs.readFileSync(jsFile, 'utf8')
  const stripped = original.replace(/[\t ]*\/\/#\s*sourceMappingURL=[^\n\r]+[\n\r]?/g, '')
  if (stripped !== original) {
    fs.writeFileSync(jsFile, stripped)
    return true
  }
  return false
}

let touched = 0
for (const pkg of PACKAGES) {
  const libDir = path.join(process.cwd(), 'node_modules', pkg, 'lib')
  if (!fs.existsSync(libDir)) continue
  for (const entry of fs.readdirSync(libDir)) {
    if (!entry.endsWith('.js')) continue
    const jsFile = path.join(libDir, entry)
    if (stripSourceMapURL(jsFile)) {
      touched += 1
      process.stdout.write(`[fix-noisy-sourcemaps] stripped sourceMappingURL from ${pkg}/lib/${entry}\n`)
    }
  }
}

if (touched === 0) {
  process.stdout.write('[fix-noisy-sourcemaps] nothing to fix\n')
}
