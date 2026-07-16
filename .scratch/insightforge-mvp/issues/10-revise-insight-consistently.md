# 10 — Revise an Insight without mixed state

**What to build:** A disciplined Insight Revision flow that lets a user change the source text while preserving the current workflow until a complete replacement workflow has generated and passed validation.

**Type:** feature

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] Editing an Insight with generated artifacts creates a revision rather than mutating current provenance.
- [ ] The effect on every downstream stage is explained before generation starts.
- [ ] The current workflow remains usable throughout generation and after any failure or cancellation.
- [ ] A successful revision atomically promotes the new Insight and complete workflow.
- [ ] Incomplete revisions can be resumed or discarded explicitly.
