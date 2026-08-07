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

import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const HEADER_LINES = [
  'FORGE — Autonomous Quality Engineering',
  'Framework for Observed, Reasoned, and Grounded Evaluation',
  '',
  'Copyright (c) 2026 AnvilQ Technologies LLC',
  'Author: Raj Kasthuri',
  '',
  'Proprietary and confidential.',
  'Unauthorized copying, distribution, or modification',
  'of this software is strictly prohibited.',
] as const

const BLOCK_HEADER = `/**\n${HEADER_LINES.map(line => line ? ` * ${line}` : ' *').join('\n')}\n */`
const HTML_HEADER = `<!--\n${HEADER_LINES.map(line => line ? `  ${line}` : '').join('\n')}\n-->`
const YAML_HEADER = HEADER_LINES.map(line => line ? `# ${line}` : '#').join('\n')
const BATCH_HEADER = HEADER_LINES.map(line => line ? `REM ${line}` : 'REM').join('\n')
const AUTHOR_MARKER = 'Author: Raj Kasthuri'
const EXCLUDED_DIRECTORY = /(^|\/)(?:logs|reports|models|dist|build|coverage|node_modules)(\/|$)/
const GENERATED_DIRECTORY = /(^|\/)generated(\/|$)/
const BLOCK_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css'])
const HASH_EXTENSIONS = new Set(['.py', '.sh', '.ps1'])
const SOURCE_EXTENSIONS = new Set([...BLOCK_EXTENSIONS, ...HASH_EXTENSIONS, '.bat', '.html'])

type HeaderStyle = 'block' | 'html' | 'hash' | 'batch'

/**
 * The audit is intentionally Git-inventory based: tracked files are the
 * authority, while intentional untracked source is included so a new file
 * cannot bypass policy before its first review. Generated/runtime directories
 * stay excluded even when they happen to contain source-shaped artifacts.
 */
export function isApplicableFirstPartySource(file: string): boolean {
  const normalized = file.replace(/\\/g, '/')
  if (normalized === '.env.example'
    || EXCLUDED_DIRECTORY.test(normalized)
    || GENERATED_DIRECTORY.test(normalized)) return false
  const extension = path.extname(normalized).toLowerCase()
  return SOURCE_EXTENSIONS.has(extension)
    || normalized === '.github/workflows/e2e-pipeline.yml'
}

function headerStyle(file: string): HeaderStyle {
  const normalized = file.replace(/\\/g, '/')
  const extension = path.extname(normalized).toLowerCase()
  if (extension === '.html') return 'html'
  if (extension === '.bat') return 'batch'
  if (normalized === '.github/workflows/e2e-pipeline.yml' || HASH_EXTENSIONS.has(extension)) return 'hash'
  return 'block'
}

function canonicalHeader(style: HeaderStyle): string {
  if (style === 'html') return HTML_HEADER
  if (style === 'hash') return YAML_HEADER
  if (style === 'batch') return BATCH_HEADER
  return BLOCK_HEADER
}

/** Preserve interpreters, document declarations, and framework-required directives. */
function safeInsertionOffset(file: string, content: string): number {
  const extension = path.extname(file).toLowerCase()
  if (content.startsWith('#!')) {
    const newline = content.indexOf('\n')
    return newline === -1 ? content.length : newline + 1
  }
  if (extension === '.html') {
    const match = /^<!doctype\s+html>\r?\n/i.exec(content)
    return match?.[0].length ?? 0
  }
  if (extension === '.bat') {
    const match = /^@echo off\r?\n/i.exec(content)
    return match?.[0].length ?? 0
  }
  if (extension === '.css') {
    const match = /^(?:(?:@charset|@tailwind)\b[^\r\n]*\r?\n)+(?:\r?\n)?/i.exec(content)
    return match?.[0].length ?? 0
  }
  return 0
}

function leadingOwnershipBlock(content: string): { block: string; length: number } | null {
  const match = /^\/\*\*[\s\S]*?\*\/(?:\r?\n)?/.exec(content)
  if (!match || !match[0].includes('AnvilQ Technologies LLC') || !match[0].includes(AUTHOR_MARKER)) {
    return null
  }
  return { block: match[0].replace(/\r?\n$/, ''), length: match[0].length }
}

/**
 * Older verification files stored their durable test rationale inside the
 * ownership block. Normalize ownership while retaining that rationale as its
 * own comment so policy maintenance cannot erase engineering knowledge.
 */
function preservedRationale(block: string): string | null {
  if (block.includes('Proprietary and confidential.')) return null
  const normalized = block.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const authorIndex = lines.findIndex(line => line.includes(AUTHOR_MARKER))
  if (authorIndex === -1) return null
  const rationale = lines.slice(authorIndex + 1, -1)
  while (rationale[0]?.trim() === '*') rationale.shift()
  while (rationale.at(-1)?.trim() === '*') rationale.pop()
  return rationale.length > 0 ? `/**\n${rationale.join('\n')}\n */` : null
}

function normalizeFile(file: string, content: string): string {
  const style = headerStyle(file)
  const offset = safeInsertionOffset(file, content)
  const prefix = content.slice(0, offset)
  let body = content.slice(offset)
  let rationale: string | null = null

  if (style === 'block') {
    const existing = leadingOwnershipBlock(body)
    if (existing) {
      rationale = preservedRationale(existing.block)
      body = body.slice(existing.length).replace(/^\r?\n/, '')
    }
  }

  const separator = prefix.length > 0 && !prefix.endsWith('\n') ? '\n' : ''
  const preserved = rationale ? `\n\n${rationale}` : ''
  return `${prefix}${separator}${canonicalHeader(style)}${preserved}\n\n${body}`
}

function isCompliant(file: string, content: string): boolean {
  const style = headerStyle(file)
  const offset = safeInsertionOffset(file, content)
  const expected = canonicalHeader(style)
  const body = content.slice(offset)
  const ownershipComments = style === 'block'
    ? [...content.matchAll(/\/\*\*[\s\S]*?Copyright \(c\) 2026 AnvilQ Technologies LLC[\s\S]*?\*\//g)].length
    : style === 'html'
      ? [...content.matchAll(/<!--[\s\S]*?Copyright \(c\) 2026 AnvilQ Technologies LLC[\s\S]*?-->/g)].length
      : style === 'batch'
        ? [...content.matchAll(/^REM Copyright \(c\) 2026 AnvilQ Technologies LLC$/gmi)].length
        : [...content.matchAll(/^# Copyright \(c\) 2026 AnvilQ Technologies LLC$/gm)].length
  return body.startsWith(expected)
    && ownershipComments === 1
}

function inventoryFiles(repoRoot: string): string[] {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repoRoot })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
}

const repoRoot = process.cwd()
const checkOnly = process.argv.includes('--check')
const applicable = inventoryFiles(repoRoot).filter(isApplicableFirstPartySource)
const noncompliant: string[] = []
let modified = 0

for (const relativeFile of applicable) {
  const absoluteFile = path.join(repoRoot, relativeFile)
  const content = fs.readFileSync(absoluteFile, 'utf8')
  if (isCompliant(relativeFile, content)) continue
  noncompliant.push(relativeFile)
  if (!checkOnly) {
    fs.writeFileSync(absoluteFile, normalizeFile(relativeFile, content), 'utf8')
    modified++
  }
}

if (checkOnly && noncompliant.length > 0) {
  console.error(`[header] ${noncompliant.length} noncompliant first-party source files:`)
  for (const file of noncompliant) console.error(`  ${file}`)
  process.exitCode = 1
} else if (checkOnly) {
  console.log(`[header] ${applicable.length}/${applicable.length} applicable files compliant`)
} else {
  console.log(`[header] ${modified} modified; ${applicable.length - modified} already compliant; ${applicable.length} applicable`)
}
