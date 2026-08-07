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

/**
 * TestFileResolver — TD-UI-003 Block 5a. Resolves a generated test file by its
 * OPAQUE ID, never by a client-supplied path.
 *
 * Threat model (Nova + Finn, not relaxed for "local"): a malicious website can
 * `fetch()` http://localhost:3000 while FORGE UI runs — a path-traversable route
 * would exfiltrate arbitrary files (SSH keys, …) through FORGE's own port. So:
 *   - The persisted generation-manifest.json is the ALLOWLIST. A file FORGE did
 *     not generate is never readable, even if it exists on disk.
 *   - The client sends an ID; only the server maps ID → path (from the manifest).
 *   - Defence-in-depth: the manifest is itself a file on disk, so a TAMPERED
 *     manifest must not become an arbitrary-read primitive — every server-sourced
 *     path is still validated (containment, realpath, extension, isFile).
 * Read-only. There is no write path and there will not be one.
 *
 * The manifest shape is described locally (a structural slice) rather than
 * imported from the engine (src/), matching forge-ui's one-directional boundary —
 * forge-ui never statically imports src/. Only `files[].{id,relativePath}` and
 * `generatedAt` are consumed.
 */
import * as fs from 'fs'
import * as path from 'path'
import { workspaceResolver } from './WorkspaceResolver'
import { assertValidAppName } from './appName'

export interface ResolvedTestFile {
  id: string
  relativePath: string
  language: 'typescript'
  content: string
  lastModified: string   // ISO — file mtime
  generatedAt: string    // ISO — from the manifest
}

interface ManifestFileSlice { id?: unknown; relativePath?: unknown }
interface ManifestSlice { files?: unknown; generatedAt?: unknown }

/**
 * True iff `target` is strictly inside `parentDir`, using a path-SEGMENT check
 * (NOT a naive startsWith, which a sibling like `tests-evil/` defeats). Both
 * arguments must already be absolute + realpath'd for the symlink-safe re-check.
 */
function isInside(parentDir: string, target: string): boolean {
  const rel = path.relative(parentDir, target)
  return rel.length > 0 && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
}

export class TestFileResolver {
  /**
   * Resolve a generated test file by opaque ID. Returns null for ANY failure —
   * unknown ID, missing manifest, validation rejection, missing file — so that a
   * validation failure and a genuinely-absent file are indistinguishable from
   * outside (no oracle). Never throws a detailed error to the caller.
   */
  read(appName: string, fileId: string): ResolvedTestFile | null {
    // TD-UI-051: an invalid appName is a MALFORMED request (traversal attempt),
    // NOT a not-found — RETHROW (do not swallow to null via the catches below).
    // The route maps InvalidAppNameError → 400; null stays reserved for "valid
    // app, file genuinely absent" (the no-oracle contract for the fileId axis).
    assertValidAppName(appName)
    const ws = workspaceResolver.resolve(appName)   // paths-only, no side effect
    const workspaceRoot = ws.root
    const testsDir = path.join(workspaceRoot, 'tests')

    // 1. Load the persisted manifest. Missing / unreadable / corrupt → null.
    let manifest: ManifestSlice
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(ws.forgeDir, 'generation-manifest.json'), 'utf-8'))
    } catch {
      return null
    }
    if (!manifest || !Array.isArray(manifest.files)) return null

    // 2. Look up the ID. THE MANIFEST IS THE ALLOWLIST. Not found → null.
    const entry = (manifest.files as ManifestFileSlice[]).find(
      f => f && typeof f.id === 'string' && f.id === fileId,
    )
    if (!entry) return null

    // 3. Take the relativePath FROM THE MANIFEST — never from client input.
    const relativePath = entry.relativePath
    if (typeof relativePath !== 'string' || relativePath.length === 0) return null

    // 4. Defence-in-depth: validate even though the path is server-sourced.
    //    (a) reject NUL bytes.
    if (relativePath.includes('\0')) return null
    //    (b) reject absolute paths, Windows drive letters, and UNC prefixes.
    const slashed = relativePath.replace(/\\/g, '/')
    if (path.isAbsolute(relativePath) || path.isAbsolute(slashed)) return null
    if (/^[a-zA-Z]:/.test(slashed)) return null    // drive letter (C:...)
    if (slashed.startsWith('//')) return null       // UNC (\\host\share)
    //    (c) resolve against the workspace root.
    const resolved = path.resolve(workspaceRoot, relativePath)
    //    (d) lexical containment inside tests/ (segment check, not startsWith).
    if (!isInside(testsDir, resolved)) return null
    //    (e) realpath BOTH, then RE-ASSERT containment — kills symlink escapes
    //        and (Finn) Windows 8.3 short-name / UNC canonicalization bypasses.
    //        realpath also fails for a non-existent path → null.
    let realTests: string
    let realResolved: string
    try {
      realTests = fs.realpathSync(testsDir)
      realResolved = fs.realpathSync(resolved)
    } catch {
      return null
    }
    if (!isInside(realTests, realResolved)) return null
    //    (f) extension allowlist: .ts only.
    if (path.extname(realResolved) !== '.ts') return null
    //    (g) must be a regular file, not a directory.
    let stat: fs.Stats
    try {
      stat = fs.statSync(realResolved)
    } catch {
      return null
    }
    if (!stat.isFile()) return null

    // 5. Read with explicit utf-8.
    let content: string
    try {
      content = fs.readFileSync(realResolved, 'utf-8')
    } catch {
      return null
    }

    // 6. Assemble. language is fixed 'typescript' (only thing we generate today —
    //    do not infer). generatedAt from the manifest; lastModified from mtime.
    return {
      id: entry.id as string,
      relativePath,
      language: 'typescript',
      content,
      lastModified: stat.mtime.toISOString(),
      generatedAt: typeof manifest.generatedAt === 'string' ? manifest.generatedAt : '',
    }
  }
}

export const testFileResolver = new TestFileResolver()
