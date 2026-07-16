# 06 — Generate and inspect a PRD

**What to build:** The final stage that transforms only the current Design Brief and three Concept Screens into a structured, read-only Markdown PRD, with the same validation, provenance, progress, usage, and diagnostic quality as the Design Brief stage.

**Type:** feature

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] The PRD stage receives the Design Brief and all three Concept Screens, but not the original Insight Source.
- [ ] The saved PRD prompt and selected text model are used through structured output.
- [ ] The returned artifact receives structural validation and a warning when below 250 words.
- [ ] Successful output is shown in a comfortable read-only Markdown viewer.
- [ ] Provenance, timing, token usage, validation, and failures are visible in the Run Inspector.
