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

/** Test-only disposable sidecar construction and hostile-database access. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type BetterSqlite3 from 'better-sqlite3'
import {
  openGovernanceSidecarAtPathInternal,
  openGovernanceSidecarHarnessAtPathInternal,
  readGovernedCurrentAtPathInternal,
  type GovernanceValidationSidecarHandle,
  type GovernedAuthorityRead,
} from './governance-validation-sidecar-internal'

function canonicalPath(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(canonicalPath(root), canonicalPath(candidate))
  return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

const WINDOWS_RESERVED_COMPONENT = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])$/i
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'ascii')

function validateWindowsPathComponents(relativePath: string): void {
  for (const component of relativePath.split(path.sep).filter(Boolean)) {
    if (/[<>:"|?*]/.test(component) || component.includes(':')) {
      throw new Error('Disposable governance test sidecar path contains an invalid Windows path component.')
    }
    if (/[. ]$/.test(component)) {
      throw new Error('Disposable governance test sidecar path contains a trailing-dot/space Windows alias.')
    }
    const stem = component.split('.', 1)[0]?.replace(/[. ]+$/g, '') ?? ''
    if (WINDOWS_RESERVED_COMPONENT.test(stem)) {
      throw new Error(`Disposable governance test sidecar path contains reserved Windows device name '${component}'.`)
    }
  }
}

function hasSQLiteHeader(filePath: string): boolean {
  const descriptor = fs.openSync(filePath, 'r')
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length)
    return fs.readSync(descriptor, header, 0, header.length, 0) === header.length
      && header.equals(SQLITE_HEADER)
  } finally {
    fs.closeSync(descriptor)
  }
}

function disposableSidecarPathForTests(databasePath: string, access: 'read' | 'write' = 'write'): string {
  if (typeof databasePath !== 'string' || databasePath.length === 0 || databasePath.includes('\0')) {
    throw new Error('Disposable governance test sidecar path is invalid.')
  }
  if (process.platform === 'win32'
      && (databasePath.startsWith('\\\\')
        || databasePath.startsWith('\\\\?\\')
        || databasePath.startsWith('\\\\.\\'))) {
    throw new Error('Disposable governance test sidecars do not support UNC or Windows device paths.')
  }
  const resolved = path.resolve(databasePath)
  const parent = path.dirname(resolved)
  const lexicalTemporaryRoot = path.resolve(os.tmpdir())
  if (!isWithin(lexicalTemporaryRoot, parent)) {
    throw new Error('Disposable governance test sidecars must be lexically inside the operating-system temporary directory.')
  }
  if (process.platform === 'win32') {
    validateWindowsPathComponents(path.relative(lexicalTemporaryRoot, resolved))
  }
  const lexicalRelative = path.relative(lexicalTemporaryRoot, parent)
  let lexicalCursor = lexicalTemporaryRoot
  for (const segment of lexicalRelative.split(path.sep).filter(Boolean)) {
    lexicalCursor = path.join(lexicalCursor, segment)
    if (fs.lstatSync(lexicalCursor).isSymbolicLink()) {
      throw new Error('Disposable governance test sidecar paths cannot traverse symbolic links or junctions.')
    }
  }
  const temporaryRoot = fs.realpathSync.native(os.tmpdir())
  const actualParent = fs.realpathSync.native(parent)
  if (!isWithin(temporaryRoot, actualParent)) {
    throw new Error('Disposable governance test sidecars must resolve inside the operating-system temporary directory.')
  }
  if (fs.existsSync(resolved)) {
    if (fs.lstatSync(resolved).isSymbolicLink()) {
      throw new Error('Disposable governance test sidecar cannot itself be a symbolic link or junction.')
    }
    const file = fs.statSync(resolved)
    if (!file.isFile()) {
      throw new Error('Disposable governance test sidecar must be a regular file.')
    }
    if (file.nlink !== 1) {
      throw new Error('Disposable governance test sidecar cannot be a multiply-linked file.')
    }
    if (access === 'write' && file.size > 0 && !hasSQLiteHeader(resolved)) {
      throw new Error('Disposable governance test sidecar refuses a pre-existing non-SQLite destination.')
    }
  }
  return resolved
}

export function openDisposableGovernanceSidecarForTests(databasePath: string): GovernanceValidationSidecarHandle {
  return openGovernanceSidecarAtPathInternal(disposableSidecarPathForTests(databasePath))
}

export const DisposableGovernanceValidationSidecarForTests = function DisposableGovernanceValidationSidecarForTests(
  databasePath: string,
): GovernanceValidationSidecarHandle {
  return openDisposableGovernanceSidecarForTests(databasePath)
} as unknown as { new(databasePath: string): GovernanceValidationSidecarHandle }

export function openDisposableGovernanceSidecarHarnessForTests(databasePath: string): {
  readonly handle: GovernanceValidationSidecarHandle
  readonly database: BetterSqlite3.Database
} {
  return openGovernanceSidecarHarnessAtPathInternal(disposableSidecarPathForTests(databasePath))
}

export function readDisposableGovernedCurrentForTests(
  databasePath: string,
  targetId: string,
): GovernedAuthorityRead {
  try {
    return readGovernedCurrentAtPathInternal(disposableSidecarPathForTests(databasePath, 'read'), targetId)
  } catch (cause) {
    return {
      kind: 'UNAVAILABLE',
      targetId,
      reason: cause instanceof Error ? cause.message : String(cause),
    }
  }
}
