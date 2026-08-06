import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTruthBoardReadModel } from '../src/core/domain/tdUi062c'
import { asEvidenceId } from '../src/core/domain/tdUi062b'
import { currentEvidence, fixtureProject, highConfidenceDimensions, staleEvidence, unknownDimensions } from '../src/core/domain/tdUi062b.fixtures'

test('TD-UI-062C creates all Truth Board sections in stable order', () => {
  const board = buildTruthBoardReadModel({ project: fixtureProject, evidence: [currentEvidence], confidenceDimensions: highConfidenceDimensions })
  assert.deepEqual(board.sections.map(section => section.key), ['project-status', 'truth-confidence', 'crawl', 'app-model', 'test-readiness', 'execution', 'results', 'insights'])
  assert.equal(board.truthConfidence.level, 'high')
})

test('missing section evidence is explicitly unknown and has no conclusion', () => {
  const board = buildTruthBoardReadModel({ project: fixtureProject, evidence: [], confidenceDimensions: unknownDimensions })
  const crawl = board.sections.find(section => section.key === 'crawl')!
  assert.equal(crawl.confidence, 'unknown')
  assert.equal(crawl.evidenceIds.length, 0)
  assert.equal(crawl.conclusion, undefined)
  assert.match(crawl.preventedHigherState ?? '', /cannot be asserted/i)
})

test('stale evidence remains referenced but cannot produce current high confidence', () => {
  const board = buildTruthBoardReadModel({ project: fixtureProject, evidence: [staleEvidence], confidenceDimensions: highConfidenceDimensions })
  assert.equal(board.truthConfidence.level, 'unknown')
  assert.deepEqual(board.evidenceIds, [staleEvidence.id])
  assert.ok(board.truthConfidence.blockers.some(blocker => blocker.kind === 'currency'))
})

test('cross-project and dangling evidence references fail closed', () => {
  assert.throws(() => buildTruthBoardReadModel({ project: fixtureProject, evidence: [{ ...currentEvidence, projectId: 'other-project' as typeof currentEvidence.projectId }], confidenceDimensions: highConfidenceDimensions }), /belongs to another project/)
  assert.throws(() => buildTruthBoardReadModel({ project: fixtureProject, evidence: [currentEvidence], confidenceDimensions: highConfidenceDimensions, sections: { crawl: { meaning: 'x', why: 'x', impact: 'x', evidenceIds: [asEvidenceId('missing')], unknowns: [], blockers: [], preventedHigherState: null, recommendedNextStep: null } } }), /not in the read model input/)
})

test('read model does not mutate caller-owned values', () => {
  const project = { ...fixtureProject }
  const evidence = [{ ...currentEvidence, provenance: { ...currentEvidence.provenance } }]
  const board = buildTruthBoardReadModel({ project, evidence, confidenceDimensions: highConfidenceDimensions })
  board.evidenceIds.push(asEvidenceId('local-only'))
  board.sections[0].unknowns.push({ id: 'local-only', subject: 'test', reason: 'test', severity: 'informational', evidenceIds: [] })
  assert.deepEqual(project, fixtureProject)
  assert.deepEqual(evidence, [currentEvidence])
})
