# 04 — Generate and inspect a Design Brief

**What to build:** The first complete workflow stage: transform an Insight Source into a structured, read-only Markdown Design Brief through real or deterministic mock OpenAI execution, with validation, progress, provenance, usage information, and useful diagnostics.

**Type:** feature

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [ ] A user can run the Design Brief stage from a non-empty Insight Source.
- [ ] The saved stage prompt and selected text model are used through the app-owned structured-output contract.
- [ ] The returned artifact receives structural validation and a warning when below 250 words.
- [ ] Successful output is shown in a comfortable read-only Markdown viewer.
- [ ] Progress, provenance, timing, token usage, validation, and errors are available in the Run Inspector.
- [ ] Deterministic mock mode exercises the same application boundary without an OpenAI call.
