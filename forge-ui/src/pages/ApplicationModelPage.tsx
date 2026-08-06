import { ApplicationWorkspace } from '../components/application-workspace/ApplicationWorkspace'

/** The model adapter is intentionally not inferred from legacy API fields. */
export function ApplicationModelPage() {
  return <ApplicationWorkspace><div className="rounded-lg border border-border bg-surface p-8 text-center"><h2 className="text-lg font-semibold text-primary">Application Model</h2><p className="mx-auto mt-2 max-w-xl text-sm text-secondary">The Application Model presentation is ready for a typed read-model adapter. No structure claims are shown until model evidence is supplied.</p></div></ApplicationWorkspace>
}
