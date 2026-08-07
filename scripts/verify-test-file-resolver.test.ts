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
 * TD-UI-003 Block 5a — TestFileResolver security boundary.
 *
 * This is a security boundary, so it is proven with REAL files on disk, not mocks —
 * mocking the fs would prove nothing about traversal/symlink/containment defence.
 * Each test mkdtemps a real workspace, points workspaceResolver.resolve() at it
 * (so the resolver uses its production path exactly), writes a real manifest +
 * real files, and asserts the resolver's decision. node:test under tsx.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { testFileResolver } from '../forge-ui/server/context/TestFileResolver'
import { workspaceResolver } from '../forge-ui/server/context/WorkspaceResolver'

const APP = 'resolver-test-app'   // irrelevant — resolve() is stubbed to a temp root

/** mkdtemp a workspace (.forge/ + tests/), point resolve() at it, run body, clean up. */
async function withWorkspace(
  body: (root: string, writeManifest: (m: unknown) => void) => void | Promise<void>,
): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tfr-'))
  const forgeDir = path.join(root, '.forge')
  fs.mkdirSync(forgeDir, { recursive: true })
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true })
  const origResolve = workspaceResolver.resolve
  ;(workspaceResolver as unknown as { resolve: unknown }).resolve = () => ({ root, forgeDir })
  const writeManifest = (m: unknown) =>
    fs.writeFileSync(path.join(forgeDir, 'generation-manifest.json'), JSON.stringify(m), 'utf-8')
  try {
    await body(root, writeManifest)
  } finally {
    ;(workspaceResolver as unknown as { resolve: typeof origResolve }).resolve = origResolve
    fs.rmSync(root, { recursive: true, force: true })
  }
}

/** A minimal persisted manifest with the given file entries. */
function manifest(files: Array<{ id: string; relativePath: string }>, generatedAt = '2026-07-13T00:00:00.000Z') {
  return { schemaVersion: 2, generatedAt, files: files.map(f => ({ ...f, type: 'spec', reason: 'new-flow' })) }
}

test('S1 happy path — a real manifest file ID returns correct content', async () => {
  await withWorkspace((root, writeManifest) => {
    const rel = 'tests/auth/login.generated.spec.ts'
    fs.mkdirSync(path.join(root, 'tests', 'auth'), { recursive: true })
    fs.writeFileSync(path.join(root, rel), '// login spec\n', 'utf-8')
    writeManifest(manifest([{ id: 'ID1', relativePath: rel }]))

    const f = testFileResolver.read(APP, 'ID1')
    assert.ok(f, 'expected a resolved file')
    assert.equal(f!.id, 'ID1')
    assert.equal(f!.relativePath, rel)
    assert.equal(f!.language, 'typescript')
    assert.equal(f!.content, '// login spec\n')
    assert.equal(f!.generatedAt, '2026-07-13T00:00:00.000Z')
    assert.ok(f!.lastModified, 'lastModified must be set')
  })
})

test('S2 unknown fileId → null (manifest is the allowlist)', async () => {
  await withWorkspace((root, writeManifest) => {
    fs.writeFileSync(path.join(root, 'tests', 'a.generated.spec.ts'), '//', 'utf-8')
    writeManifest(manifest([{ id: 'REAL', relativePath: 'tests/a.generated.spec.ts' }]))
    assert.equal(testFileResolver.read(APP, 'NOPE'), null)
  })
})

test('S3 manifest entry with traversal relativePath → null (tampered-manifest defence)', async () => {
  await withWorkspace((_root, writeManifest) => {
    writeManifest(manifest([{ id: 'EVIL', relativePath: '../../../../etc/passwd' }]))
    assert.equal(testFileResolver.read(APP, 'EVIL'), null)
  })
})

test('S4 entry outside tests/ but inside the workspace → null (containment)', async () => {
  await withWorkspace((root, writeManifest) => {
    // A real .ts file inside the workspace but NOT under tests/.
    fs.writeFileSync(path.join(root, '.forge', 'secret.ts'), '// secret', 'utf-8')
    writeManifest(manifest([{ id: 'OUT', relativePath: '.forge/secret.ts' }]))
    assert.equal(testFileResolver.read(APP, 'OUT'), null)
  })
})

test('S5 sibling-dir bypass (tests-evil/) → null (segment check, not naive startsWith)', async () => {
  await withWorkspace((root, writeManifest) => {
    fs.mkdirSync(path.join(root, 'tests-evil'), { recursive: true })
    fs.writeFileSync(path.join(root, 'tests-evil', 'pwn.ts'), '// pwn', 'utf-8')
    writeManifest(manifest([{ id: 'SIB', relativePath: 'tests-evil/pwn.ts' }]))
    assert.equal(testFileResolver.read(APP, 'SIB'), null)
  })
})

test('S6 symlink inside tests/ pointing outside the workspace → null (realpath re-check)', async (t) => {
  await withWorkspace((root, writeManifest) => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfr-outside-'))
    const secret = path.join(outsideDir, 'secret.ts')
    fs.writeFileSync(secret, '// outside secret', 'utf-8')
    const link = path.join(root, 'tests', 'link.ts')
    let linked = false
    try { fs.symlinkSync(secret, link); linked = true } catch { /* privilege-gated on Windows */ }
    if (!linked) {
      fs.rmSync(outsideDir, { recursive: true, force: true })
      // NOT a silent pass — explicitly reported as skipped in the TAP output.
      t.skip('symlink creation not permitted on this platform (needs privilege/developer mode)')
      return
    }
    try {
      writeManifest(manifest([{ id: 'SYM', relativePath: 'tests/link.ts' }]))
      assert.equal(testFileResolver.read(APP, 'SYM'), null)
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true })
    }
  })
})

test('S7 non-.ts extension → null (extension allowlist)', async () => {
  await withWorkspace((root, writeManifest) => {
    fs.writeFileSync(path.join(root, 'tests', 'note.md'), '# note', 'utf-8')
    writeManifest(manifest([{ id: 'MD', relativePath: 'tests/note.md' }]))
    assert.equal(testFileResolver.read(APP, 'MD'), null)
  })
})

test('S8 directory instead of file → null (isFile check)', async () => {
  await withWorkspace((root, writeManifest) => {
    // A DIRECTORY named with a .ts suffix — passes the extension gate, so this
    // exercises the statSync().isFile() rejection specifically.
    fs.mkdirSync(path.join(root, 'tests', 'weird.ts'), { recursive: true })
    writeManifest(manifest([{ id: 'DIR', relativePath: 'tests/weird.ts' }]))
    assert.equal(testFileResolver.read(APP, 'DIR'), null)
  })
})

test('S9 no manifest at all → null', async () => {
  await withWorkspace((_root, _writeManifest) => {
    // Deliberately do NOT write a manifest.
    assert.equal(testFileResolver.read(APP, 'ANY'), null)
  })
})
