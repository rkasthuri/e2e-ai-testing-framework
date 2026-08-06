import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const page = read('forge-ui/src/pages/OnboardPage.tsx')
const client = read('forge-ui/src/api/client.ts')
const route = read('forge-ui/server/routes/projects.ts')
const server = read('forge-ui/server/index.ts')
const packageJson = read('forge-ui/package.json')

test('Onboard traces validation then POST /api/v1/projects with dry-run and credentials', () => {
  assert.match(page, /validateUrl\.mutateAsync\(norm\)/)
  assert.match(page, /onboard\.mutate\(\{ url: norm, appName, username: username \|\| undefined, password: password \|\| undefined, dryRun, jobId \}/)
  assert.match(route, /router\.post\('\/'/)
  assert.match(route, /const \{ url, appName, dryRun, jobId, detectionResult, username, password \}/)
  assert.match(route, /submittedUser.*submittedPass/s)
})

test('Onboard exposes every required explicit UI phase and never falls back silently', () => {
  for (const state of ['idle', 'checking-url', 'detection-succeeded', 'invalid-url', 'target-unreachable', 'authentication-failed', 'backend-unavailable', 'backend-error', 'dry-run-preview', 'project-saved']) {
    assert.match(page, new RegExp(state.replace('-', '\\-')))
  }
  assert.match(page, /data-testid="onboard-phase"/)
  assert.match(page, /role="alert"/)
})

test('HTTP 400, 500, unreadable proxy errors, and backend-unavailable errors are typed', () => {
  assert.match(client, /class ApiError extends Error/)
  assert.match(client, /status: number/)
  assert.match(client, /BACKEND_UNAVAILABLE/)
  assert.match(client, /res\.status >= 500/)
  assert.match(route, /CREDENTIALS_REQUIRED/)
  assert.match(route, /INTERNAL_ERROR/)
})

test('dry run does not register a project or persist the credential sidecar', () => {
  assert.match(route, /if \(!dryRun\) credentialStore\.write\(appName, ref\)/)
  assert.match(route, /if \(!dryRun\) \{\s*projectRegistry\.register/s)
  assert.match(page, /Dry run .*don.*save the project/s)
})

test('duplicate submission is explicit and registry registration remains idempotent', () => {
  assert.match(route, /PROJECT_EXISTS/)
  assert.match(route, /already exists/i)
  assert.match(route, /projectRegistry\.register\(/)
})

test('credentials are submitted only as request fields and never rendered in results or logs', () => {
  assert.match(page, /type="password"/)
  assert.doesNotMatch(page, /result\.(?:username|password)|detection\.(?:username|password)/i)
  assert.doesNotMatch(route, /logBuffer\.append\([^\n]*password/i)
  assert.doesNotMatch(route, /console\.log\([^\n]*password/i)
  assert.match(route, /safeMessage/)
})

test('direct backend startup is available and canonical forge ui remains supported', () => {
  assert.match(packageJson, /"server": "tsx server\/start\.ts"/)
  assert.match(server, /export async function startServer/)
  assert.match(read('forge-ui/server/start.ts'), /startServer\(\)/)
  assert.match(read('src/core/onboarding/cli.ts'), /forge ui.*Start the FORGE Platform UI/s)
})
