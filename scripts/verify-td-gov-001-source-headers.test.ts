/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or modification
 * of this software is strictly prohibited.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(__dirname, '..')
const constitutionPath = path.join(repoRoot, 'docs', 'governance', 'AI_CONSTITUTION.md')
const EXCLUDED_DIRECTORY = /(^|\/)(?:logs|reports|models|dist|build|coverage|node_modules)(\/|$)/
const GENERATED_DIRECTORY = /(^|\/)generated(\/|$)/
const BLOCK_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css'])
const HASH_EXTENSIONS = new Set(['.py', '.sh', '.ps1'])
const SOURCE_EXTENSIONS = new Set([...BLOCK_EXTENSIONS, ...HASH_EXTENSIONS, '.bat', '.html'])

function inventory(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
  }).toString('utf8').split('\0').filter(Boolean)
}

function applicable(file: string): boolean {
  const normalized = file.replace(/\\/g, '/')
  if (normalized === '.env.example'
    || EXCLUDED_DIRECTORY.test(normalized)
    || GENERATED_DIRECTORY.test(normalized)) return false
  return SOURCE_EXTENSIONS.has(path.extname(normalized).toLowerCase())
    || normalized === '.github/workflows/e2e-pipeline.yml'
}

/** The Constitution is parsed at test time so the verifier cannot establish rival legal wording. */
function constitutionalBlockHeader(): string {
  const constitution = fs.readFileSync(constitutionPath, 'utf8').replace(/\r\n/g, '\n')
  const section = /### 3\.9[^\n]*\n[\s\S]*?```typescript\n([\s\S]*?)\n```/.exec(constitution)
  assert.ok(section, 'AI_CONSTITUTION.md §3.9 must contain the canonical TypeScript header')
  return section[1]
}

function headerLines(blockHeader: string): string[] {
  return blockHeader.split('\n').slice(1, -1).map(line => line === ' *' ? '' : line.replace(/^ \* /, ''))
}

function expectedHeader(file: string, blockHeader: string): string {
  const extension = path.extname(file).toLowerCase()
  const lines = headerLines(blockHeader)
  if (extension === '.html') return `<!--\n${lines.map(line => line ? `  ${line}` : '').join('\n')}\n-->`
  if (extension === '.bat') return lines.map(line => line ? `REM ${line}` : 'REM').join('\n')
  if (file === '.github/workflows/e2e-pipeline.yml' || HASH_EXTENSIONS.has(extension)) {
    return lines.map(line => line ? `# ${line}` : '#').join('\n')
  }
  return blockHeader
}

function safeOffset(file: string, content: string): number {
  const extension = path.extname(file).toLowerCase()
  if (content.startsWith('#!')) {
    const newline = content.indexOf('\n')
    return newline === -1 ? content.length : newline + 1
  }
  if (extension === '.html') return /^<!doctype\s+html>\r?\n/i.exec(content)?.[0].length ?? 0
  if (extension === '.bat') return /^@echo off\r?\n/i.exec(content)?.[0].length ?? 0
  if (extension === '.css') {
    return /^(?:(?:@charset|@tailwind)\b[^\r\n]*\r?\n)+(?:\r?\n)?/i.exec(content)?.[0].length ?? 0
  }
  return 0
}

test('every applicable Git-inventory source uses the exact constitutional header once', () => {
  const blockHeader = constitutionalBlockHeader()
  const files = inventory().filter(applicable)
  assert.ok(files.length > 0)
  const failures: string[] = []
  for (const file of files) {
    const content = fs.readFileSync(path.join(repoRoot, file), 'utf8')
    const header = expectedHeader(file, blockHeader)
    if (!content.slice(safeOffset(file, content)).startsWith(header)) failures.push(file)
    const ownershipCommentCount = BLOCK_EXTENSIONS.has(path.extname(file).toLowerCase())
      ? [...content.matchAll(/\/\*\*[\s\S]*?Copyright \(c\) 2026 AnvilQ Technologies LLC[\s\S]*?\*\//g)].length
      : [...content.matchAll(/^(?:#|REM) Copyright \(c\) 2026 AnvilQ Technologies LLC$/gmi)].length
        + [...content.matchAll(/<!--[\s\S]*?Copyright \(c\) 2026 AnvilQ Technologies LLC[\s\S]*?-->/g)].length
    if (ownershipCommentCount !== 1) failures.push(`${file} (ownership comments: ${ownershipCommentCount})`)
  }
  assert.deepEqual(failures, [])
})

test('required first lines and framework directives remain before the header', () => {
  assert.match(fs.readFileSync(path.join(repoRoot, 'forgeUI.bat'), 'utf8'), /^@echo off\r?\nREM FORGE/)
  assert.match(fs.readFileSync(path.join(repoRoot, 'forge-ui/index.html'), 'utf8'), /^<!doctype html>\r?\n<!--/i)
  assert.match(
    fs.readFileSync(path.join(repoRoot, 'forge-ui/src/index.css'), 'utf8'),
    /^@tailwind base;\r?\n@tailwind components;\r?\n@tailwind utilities;\r?\n\r?\n\/\*\*/,
  )
})

test('generated, runtime, environment, and Forge asset paths remain outside header scope', () => {
  for (const file of [
    '.env.example',
    'Forge-Tool.png',
    'Forge-Tool.ico',
    'reports/run-history.json',
    'logs/validation-run-2026-06-21/new-generated-specs-saucedemo/login-to-inventory.generated.spec.ts',
    'src/apps/desktop/ui/saucedemo/generated/pages/InventoryPage.generated.ts',
  ]) assert.equal(applicable(file), false, file)
})

test('verification rationale formerly embedded in ownership blocks remains durable', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'scripts/verify-td-ui-041-nav-edge.test.ts'), 'utf8')
  assert.match(source, /\*\*\r?\n \* TD-UI-041 nav-edge/)
  assert.equal([...source.matchAll(/Copyright \(c\) 2026 AnvilQ Technologies LLC/g)].length, 1)
})
