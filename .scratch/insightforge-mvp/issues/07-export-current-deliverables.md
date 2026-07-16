# 07 — Export current deliverables

**What to build:** A straightforward deliverables export that packages the current Design Brief, Concept Screens, PRD, and a human-readable provenance manifest without exposing secrets or internal database files.

**Type:** feature

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] Users can download a ZIP containing the current generated deliverables.
- [ ] Markdown artifacts and PNG screens have predictable, readable names.
- [ ] A manifest records project, stage, model, prompt, and generation metadata needed to understand the outputs.
- [ ] API keys, internal database files, and incomplete candidates are never included.
