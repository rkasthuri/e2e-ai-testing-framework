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

import { useSearchParams } from 'react-router-dom'
import { ProjectSession } from '../utils/ProjectSession'

/**
 * The currently-selected project, read from the `?project=` URL param.
 *
 * Navigation state (not React state) so the selection survives page unmount
 * and tab switches — see TD-UI-022 follow-up. When the URL carries the param it
 * is the source of truth and is mirrored into session storage; when the URL is
 * bare (e.g. a param-less tab click) the last session selection is returned as
 * a fallback. Returns null when neither is available.
 */
export function useCurrentProject(): string | null {
  const [searchParams] = useSearchParams()
  const param = searchParams.get('project')
  if (param) { ProjectSession.setCurrent(param); return param }
  return ProjectSession.getCurrent()
}
