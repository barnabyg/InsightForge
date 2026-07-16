# 09 — Regenerate changed stages without mixed state

**What to build:** Safe stage reruns and variations. Detect upstream, prompt, and model changes; explain the affected downstream cascade; optionally snapshot the current workflow; and atomically replace the entire affected suffix while still allowing an explicitly chosen identical-input variation run.

**Type:** feature

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] The interface identifies when a stage update is available and explains what changed.
- [ ] Rerunning an affected stage necessarily regenerates every downstream stage in one Candidate Workflow.
- [ ] The user is offered a snapshot before the existing affected artifacts are replaced.
- [ ] The current workflow is never left as a mixture of generations.
- [ ] Identical-input reruns remain available as clearly labelled Variation Runs.
- [ ] Prompt, model, and input fingerprints make rerun decisions inspectable and testable.
