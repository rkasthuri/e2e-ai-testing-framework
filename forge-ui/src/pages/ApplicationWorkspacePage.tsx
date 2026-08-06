import { ApplicationWorkspace } from '../components/application-workspace/ApplicationWorkspace'
import { ApplicationOverview } from '../components/application-workspace/ApplicationOverview'
import { buildApplicationOverviewReadModel } from '../components/application-workspace/applicationOverviewAdapter'
import { useCurrentProject } from '../hooks/useCurrentProject'
import { useProject } from '../hooks/useApi'

/** The adapter is intentionally not inferred from legacy API fields. */
export function ApplicationWorkspacePage() {
  const selectedProject = useCurrentProject()
  const projectQuery = useProject(selectedProject)

  return <ApplicationWorkspace>
    {!selectedProject && <div className="rounded-lg border border-border bg-surface p-8 text-center"><h2 className="text-lg font-semibold text-primary">No application selected</h2><p className="mx-auto mt-2 max-w-xl text-sm text-secondary">Select a project to load its persisted onboarding and detection evidence.</p></div>}
    {selectedProject && projectQuery.isPending && <div className="rounded-lg border border-border bg-surface p-8 text-center" role="status">Loading application evidence…</div>}
    {selectedProject && projectQuery.isError && <div className="rounded-lg border border-fail/40 bg-surface p-8 text-center" role="alert"><h2 className="text-lg font-semibold text-primary">Application data unavailable</h2><p className="mx-auto mt-2 max-w-xl text-sm text-secondary">{projectQuery.error instanceof Error ? projectQuery.error.message : 'The selected project could not be loaded.'}</p><p className="mt-3 text-xs text-muted">Confirm the FORGE control plane is running, or select an existing project.</p></div>}
    {projectQuery.data && <ApplicationOverview readModel={buildApplicationOverviewReadModel(projectQuery.data.project, projectQuery.data.detection, projectQuery.data.latestObservation)} />}
  </ApplicationWorkspace>
}
