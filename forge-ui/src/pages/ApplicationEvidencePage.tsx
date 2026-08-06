import { ApplicationWorkspace } from '../components/application-workspace/ApplicationWorkspace'

/** The evidence adapter is intentionally not inferred from legacy API fields. */
export function ApplicationEvidencePage() {
  return <ApplicationWorkspace><div className="rounded-lg border border-border bg-surface p-8 text-center"><h2 className="text-lg font-semibold text-primary">Evidence</h2><p className="mx-auto mt-2 max-w-xl text-sm text-secondary">The Evidence presentation is ready for a typed read-model adapter. No evidence claims are shown until validated evidence is supplied.</p></div></ApplicationWorkspace>
}
