/**
 * Thin FORGE validation orchestrator.
 *
 * It invokes existing build/test tools, inspects live SQLite read-only, and
 * persists one deterministic report. It does not repair storage, apply
 * migrations, generate tests, or invoke the adaptive FORGE pipeline.
 */
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import {
  aggregateValidationStatus,
  classifyAgainstBaseline,
  createGateResult,
  deterministicValidationReportJson,
  inspectSqliteReadOnly,
  ValidationGateResult,
  ValidationProfile,
  ValidationReport,
  ValidationStatus,
} from '../src/core/validation/ValidationBaseline'
import { resolveSqlitePath } from '../src/core/storage/db'

const ROOT = path.resolve(__dirname, '..')
const SAUCEDEMO_URL = 'https://www.saucedemo.com'
const SAUCEDEMO_TEST_FILES = [
  'src/apps/desktop/ui/saucedemo/tests/loginFast.spec.ts',
  'src/apps/desktop/ui/saucedemo/tests/e2e-journey.spec.ts',
]
const SAUCEDEMO_SMOKE_TITLES = [
  'Standard user login',
  'Invalid credentials',
  'TC033 - Complete user journey: Login → Browse → Cart → Checkout → Complete',
]
const SAUCEDEMO_GREP = 'Standard user login|Invalid credentials|TC033'

export interface CommandSpec {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  required: boolean
}

export interface CommandExecution {
  exitCode: number | null
  error: string | null
}

export type CommandExecutor = (spec: CommandSpec) => CommandExecution

interface CliOptions {
  profile: ValidationProfile
  databasePath: string
  reportPath: string
  baselinePath: string | null
  establishBaseline: boolean
  humanAttestationPath: string | null
}

interface HumanAttestation {
  schemaVersion: 'forge-human-validation/v1'
  status: Exclude<ValidationStatus, 'NOT_RUN'>
  validator: string
  commit: string
  completedChecks: string[]
  evidence: string[]
}

function packageCommand(name: 'npm' | 'npx'): { command: string; prefix: string[] } {
  if (process.platform !== 'win32') return { command: name, prefix: [] }
  const cli = path.join(
    path.dirname(process.execPath),
    'node_modules',
    'npm',
    'bin',
    `${name}-cli.js`,
  )
  return { command: process.execPath, prefix: [cli] }
}

function optionValue(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}.`)
  return value
}

export function parseOptions(args: string[]): CliOptions {
  const profileValue = optionValue(args, '--profile') ?? 'offline'
  if (!['offline', 'product', 'full'].includes(profileValue)) {
    throw new Error(`Unknown validation profile '${profileValue}'. Expected offline, product, or full.`)
  }
  const profile = profileValue as ValidationProfile
  const databasePath = path.resolve(
    optionValue(args, '--db') ?? resolveSqlitePath(undefined, ROOT),
  )
  const reportPath = path.resolve(
    optionValue(args, '--report')
      ?? path.join(ROOT, 'reports', 'validation', `${profile}-baseline.json`),
  )
  const baselineValue = optionValue(args, '--baseline')
  const attestationValue = optionValue(args, '--human-attestation')
  const establishBaseline = args.includes('--establish-baseline')
  if (establishBaseline && baselineValue) {
    throw new Error('--establish-baseline and --baseline are mutually exclusive.')
  }
  return {
    profile,
    databasePath,
    reportPath,
    baselinePath: baselineValue ? path.resolve(baselineValue) : null,
    establishBaseline,
    humanAttestationPath: attestationValue ? path.resolve(attestationValue) : null,
  }
}

export function profileCommandSpecs(profile: ValidationProfile): CommandSpec[] {
  const npm = packageCommand('npm')
  const specs: CommandSpec[] = [
    {
      id: 'build.root-typecheck',
      title: 'Root and eval TypeScript checks',
      command: npm.command,
      args: [...npm.prefix, 'run', 'check'],
      cwd: ROOT,
      required: true,
    },
    {
      id: 'test.unit',
      title: 'Unit test suite',
      command: npm.command,
      args: [...npm.prefix, 'run', 'test:unit'],
      cwd: ROOT,
      required: true,
    },
    {
      id: 'build.ui-typecheck',
      title: 'forge-ui TypeScript check',
      command: npm.command,
      args: [...npm.prefix, 'run', 'check'],
      cwd: path.join(ROOT, 'forge-ui'),
      required: true,
    },
  ]

  if (profile === 'full') {
    specs.push({
      id: 'build.ui-production',
      title: 'forge-ui production build',
      command: npm.command,
      args: [...npm.prefix, 'run', 'build'],
      cwd: path.join(ROOT, 'forge-ui'),
      required: true,
    })
  }
  return specs
}

export function sauceDemoCommandSpec(): CommandSpec {
  const npx = packageCommand('npx')
  return {
    id: 'product.saucedemo-smoke',
    title: 'SauceDemo primary-reference smoke',
    command: npx.command,
    args: [
      ...npx.prefix,
      '--no-install',
      'playwright',
      'test',
      ...SAUCEDEMO_TEST_FILES,
      '--project=chromium',
      '--grep',
      SAUCEDEMO_GREP,
      '--reporter=line',
      '--workers=1',
      '--retries=0',
    ],
    cwd: ROOT,
    required: true,
  }
}

export const executeCommand: CommandExecutor = spec => {
  console.log(`\n[validation] ${spec.id}`)
  console.log(`[validation] ${spec.command} ${spec.args.join(' ')}`)
  const result = spawnSync(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, CI: '1', FORGE_VALIDATION_MODE: '1' },
    stdio: 'inherit',
    shell: false,
  })
  return {
    exitCode: result.status,
    error: result.error?.message ?? null,
  }
}

export function commandResult(
  spec: CommandSpec,
  execution: CommandExecution,
): ValidationGateResult {
  if (execution.error) {
    return createGateResult({
      id: spec.id,
      title: spec.title,
      required: spec.required,
      status: 'BLOCKED',
      detail: `Command could not start: ${execution.error}`,
      evidence: {
        command: [spec.command, ...spec.args],
        cwd: spec.cwd,
        exitCode: execution.exitCode,
      },
      remedy: {
        tier: 1,
        action: `Install or restore the required local toolchain, then rerun gate ${spec.id}.`,
      },
    })
  }
  if (execution.exitCode === 0) {
    return createGateResult({
      id: spec.id,
      title: spec.title,
      required: spec.required,
      status: 'PASS',
      detail: 'Command exited successfully.',
      evidence: {
        command: [spec.command, ...spec.args],
        cwd: spec.cwd,
        exitCode: 0,
      },
      remedy: null,
    })
  }
  return createGateResult({
    id: spec.id,
    title: spec.title,
    required: spec.required,
    status: 'FAIL',
    detail: `Command exited with code ${execution.exitCode ?? 'unknown'}.`,
    evidence: {
      command: [spec.command, ...spec.args],
      cwd: spec.cwd,
      exitCode: execution.exitCode,
    },
    remedy: {
      tier: 1,
      action: `Inspect the raw command output above, correct gate ${spec.id}, and rerun validation.`,
    },
  })
}

function profileNotRunGate(
  id: string,
  title: string,
  detail: string,
): ValidationGateResult {
  return createGateResult({
    id,
    title,
    required: false,
    status: 'NOT_RUN',
    detail,
    evidence: null,
    remedy: {
      tier: 1,
      action: id === 'build.ui-production'
        ? 'Run the full release-equivalent profile when a production UI build is required.'
        : 'Run the product or full profile when live SauceDemo evidence is required.',
    },
  })
}

async function sauceDemoPreflight(): Promise<{ ok: true } | { ok: false; detail: string }> {
  dotenv.config({ path: path.join(ROOT, '.env') })
  const missing = ['USER_STANDARD', 'PASSWORD'].filter(key => !process.env[key])
  if (missing.length > 0) {
    return { ok: false, detail: `Missing required credential environment variable(s): ${missing.join(', ')}.` }
  }

  try {
    const response = await fetch(SAUCEDEMO_URL, {
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    })
    if (response.status >= 500) {
      return { ok: false, detail: `SauceDemo preflight returned HTTP ${response.status}.` }
    }
    return { ok: true }
  } catch (cause) {
    return {
      ok: false,
      detail: `SauceDemo preflight could not reach the external application: ${
        cause instanceof Error ? cause.message : String(cause)
      }.`,
    }
  }
}

async function productGate(executor: CommandExecutor): Promise<ValidationGateResult> {
  const preflight = await sauceDemoPreflight()
  if (!preflight.ok) {
    return createGateResult({
      id: 'product.saucedemo-smoke',
      title: 'SauceDemo primary-reference smoke',
      required: true,
      status: 'BLOCKED',
      detail: preflight.detail,
      evidence: {
        referenceApplication: 'SauceDemo',
        baseUrl: SAUCEDEMO_URL,
        credentialsPresent: !preflight.detail.startsWith('Missing required'),
        tests: SAUCEDEMO_SMOKE_TITLES,
      },
      remedy: {
        tier: 2,
        action: 'Provide USER_STANDARD and PASSWORD and restore access to SauceDemo, then rerun the product profile.',
      },
    })
  }
  const spec = sauceDemoCommandSpec()
  return commandResult(spec, executor(spec))
}

function gitOutput(args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.error?.message || 'unknown error'}`)
  }
  return result.stdout.trim()
}

function loadBaseline(filePath: string): ValidationReport {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ValidationReport
  if (parsed.schemaVersion !== 'forge-validation-baseline/v1' || !Array.isArray(parsed.gates)) {
    throw new Error(`Not a FORGE validation baseline report: ${filePath}`)
  }
  return parsed
}

export function humanGate(
  profile: ValidationProfile,
  attestationPath: string | null,
  commit: string,
): ValidationGateResult {
  if (profile !== 'full') {
    return profileNotRunGate(
      'human.checklist',
      'Human validation checklist',
      'Human attestation is outside the offline/product profile.',
    )
  }
  if (!attestationPath) {
    return createGateResult({
      id: 'human.checklist',
      title: 'Human validation checklist',
      required: true,
      status: 'NOT_RUN',
      detail: 'The full profile requires a human-validation attestation.',
      evidence: null,
      remedy: {
        tier: 2,
        action: 'Complete docs/project/FORGE_HUMAN_VALIDATION_CHECKLIST.md and rerun with --human-attestation <file>.',
      },
    })
  }

  let attestation: HumanAttestation
  try {
    attestation = JSON.parse(fs.readFileSync(attestationPath, 'utf8')) as HumanAttestation
  } catch (cause) {
    return createGateResult({
      id: 'human.checklist',
      title: 'Human validation checklist',
      required: true,
      status: 'BLOCKED',
      detail: `Human attestation is unreadable: ${cause instanceof Error ? cause.message : String(cause)}`,
      evidence: { attestationPath },
      remedy: {
        tier: 2,
        action: 'Provide a readable forge-human-validation/v1 attestation file.',
      },
    })
  }

  const structurallyValid = attestation.schemaVersion === 'forge-human-validation/v1'
    && ['PASS', 'FAIL', 'BLOCKED'].includes(attestation.status)
    && typeof attestation.validator === 'string'
    && attestation.validator.trim().length > 0
    && Array.isArray(attestation.completedChecks)
    && Array.isArray(attestation.evidence)
  if (!structurallyValid || attestation.commit !== commit) {
    return createGateResult({
      id: 'human.checklist',
      title: 'Human validation checklist',
      required: true,
      status: 'BLOCKED',
      detail: attestation.commit !== commit
        ? `Human attestation commit '${attestation.commit}' does not match '${commit}'.`
        : 'Human attestation does not satisfy forge-human-validation/v1.',
      evidence: { attestationPath, commit: attestation.commit ?? null },
      remedy: {
        tier: 2,
        action: 'Complete and attest the checklist against the exact commit being validated.',
      },
    })
  }

  return createGateResult({
    id: 'human.checklist',
    title: 'Human validation checklist',
    required: true,
    status: attestation.status,
    detail: `Human validation was attested by ${attestation.validator}.`,
    evidence: {
      attestationPath,
      validator: attestation.validator,
      commit: attestation.commit,
      completedChecks: [...attestation.completedChecks].sort(),
      evidence: [...attestation.evidence].sort(),
    },
    remedy: attestation.status === 'PASS'
      ? null
      : {
          tier: 2,
          action: 'Address the failed or blocked checklist items recorded in the attestation, then repeat human validation.',
        },
  })
}

export async function buildValidationReport(
  options: CliOptions,
  executor: CommandExecutor = executeCommand,
): Promise<ValidationReport> {
  const commit = gitOutput(['rev-parse', 'HEAD'])
  const dirty = gitOutput(['status', '--short']).length > 0
  const gates = profileCommandSpecs(options.profile)
    .map(spec => commandResult(spec, executor(spec)))

  if (options.profile !== 'full') {
    gates.push(profileNotRunGate(
      'build.ui-production',
      'forge-ui production build',
      'The UI production build is release-only and runs only in the full profile.',
    ))
  }

  if (options.profile === 'product' || options.profile === 'full') {
    gates.push(await productGate(executor))
  } else {
    gates.push(profileNotRunGate(
      'product.saucedemo-smoke',
      'SauceDemo primary-reference smoke',
      'Live product smoke is outside the offline profile.',
    ))
  }

  try {
    gates.push(...inspectSqliteReadOnly(options.databasePath).gates)
  } catch (cause) {
    gates.push(createGateResult({
      id: 'storage.database-open',
      title: 'SQLite database availability',
      required: true,
      status: 'BLOCKED',
      detail: `SQLite inspection could not start: ${cause instanceof Error ? cause.message : String(cause)}`,
      evidence: { databasePath: options.databasePath },
      remedy: {
        tier: 2,
        action: 'Provide an existing readable SQLite database path and rerun validation.',
      },
    }))
  }

  gates.push(humanGate(options.profile, options.humanAttestationPath, commit))
  const baselineReport = options.baselinePath ? loadBaseline(options.baselinePath) : undefined
  const classified = classifyAgainstBaseline(gates, {
    establishBaseline: options.establishBaseline,
    baselineReport,
  })

  return {
    schemaVersion: 'forge-validation-baseline/v1',
    profile: options.profile,
    referenceApplication: {
      name: 'SauceDemo',
      baseUrl: SAUCEDEMO_URL,
      smokeTests: SAUCEDEMO_SMOKE_TITLES,
    },
    repository: { commit, dirty },
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    databasePath: options.databasePath,
    comparison: {
      mode: options.establishBaseline
        ? 'establish'
        : (options.baselinePath ? 'baseline' : 'none'),
      baselinePath: options.baselinePath,
    },
    gates: classified,
    overallStatus: aggregateValidationStatus(classified),
  }
}

function exitCode(status: ValidationStatus): number {
  if (status === 'PASS') return 0
  if (status === 'BLOCKED' || status === 'NOT_RUN') return 2
  return 1
}

function printSummary(report: ValidationReport, reportPath: string): void {
  console.log('\nFORGE Validation Baseline')
  console.log(`Profile: ${report.profile}`)
  for (const gate of report.gates) {
    const finding = gate.findingKind === 'NONE' ? '' : ` · ${gate.findingKind}`
    console.log(`${gate.status.padEnd(7)} ${gate.id}${finding}`)
    if (gate.status !== 'PASS') {
      console.log(`          ${gate.detail}`)
      console.log(`          remedy: ${gate.remedy?.action}`)
    }
  }
  console.log(`Overall: ${report.overallStatus}`)
  console.log(`Machine report: ${reportPath}`)
}

export async function run(args: string[]): Promise<number> {
  let options: CliOptions
  try {
    options = parseOptions(args)
  } catch (cause) {
    console.error(`ERROR: ${cause instanceof Error ? cause.message : String(cause)}`)
    return 2
  }

  try {
    const report = await buildValidationReport(options)
    fs.mkdirSync(path.dirname(options.reportPath), { recursive: true })
    fs.writeFileSync(options.reportPath, deterministicValidationReportJson(report), 'utf8')
    printSummary(report, options.reportPath)
    return exitCode(report.overallStatus)
  } catch (cause) {
    console.error(`ERROR: ${cause instanceof Error ? cause.message : String(cause)}`)
    return 2
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then(code => {
    process.exitCode = code
  })
}
