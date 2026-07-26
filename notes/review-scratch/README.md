# notes/review-scratch/ — ephemeral review artifacts (gitignored)

This directory is the single home for **ephemeral working artifacts**: diffs written for
review, audit reports, staged-diff and gate/CI captures, spike scratch output.

**Everything in this directory is gitignored and MUST NEVER be committed.** The `.gitignore`
ignores `notes/review-scratch/*` (this `README.md` is the one tracked exception, so the
directory and its purpose exist in the repo).

Durable audit outputs are the **deliberate exception**: when something depends on an artifact
(e.g. a design that rests on a feasibility spike), it is *promoted* to a tracked docs location
(`docs/architecture/spikes/`). Default is ignored; tracking is a conscious choice, not the norm.

See "Documentation and Working Artifacts" in root `AGENTS.md`.
