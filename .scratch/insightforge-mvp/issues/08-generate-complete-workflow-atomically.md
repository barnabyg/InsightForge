# 08 — Generate the complete workflow atomically

**What to build:** Full Generation from the Insight Source through all three stages, using a Candidate Workflow so the visible current workflow changes only after every stage succeeds. Include clear progress, cancellation, warning handling, and resumable failed candidates.

**Type:** feature

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] A user can generate the complete workflow from a valid Insight Source with one action.
- [ ] Only one generation is active for a Project at a time.
- [ ] Work is isolated in a Candidate Workflow and promoted only after every required artifact succeeds.
- [ ] Failure or cancellation leaves the prior current workflow untouched.
- [ ] Failed candidates can be resumed or discarded explicitly, with no automatic retry.
- [ ] Warnings are summarized before promotion without weakening hard validation failures.
