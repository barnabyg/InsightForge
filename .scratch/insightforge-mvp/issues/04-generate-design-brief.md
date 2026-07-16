# 04 — Generate and inspect a Design Brief

**What to build:** The first complete workflow stage: transform an Insight Source into a structured, read-only Markdown Design Brief through real or deterministic mock OpenAI execution, with validation, progress, provenance, usage information, and useful diagnostics.

**Type:** feature

**Blocked by:** 02, 03

**Status:** resolved

- [x] A user can run the Design Brief stage from a non-empty Insight Source.
- [x] The saved stage prompt and selected text model are used through the app-owned structured-output contract.
- [x] The returned artifact receives structural validation and a warning when below 250 words.
- [x] Successful output is shown in a comfortable read-only Markdown viewer.
- [x] Progress, provenance, timing, token usage, validation, and errors are available in the Run Inspector.
- [x] Deterministic mock mode exercises the same application boundary without an OpenAI call.

## Answer

Implemented the first generated workflow stage end to end. A Project can run its active Design Brief Stage Configuration against a protected Insight Source through a strict Responses API JSON schema or the deterministic mock boundary. Successful Markdown Artifacts and full Stage Run diagnostics persist locally; incomplete, refused, empty, or failed responses never become current Artifacts. Validation reports measured word count and a non-blocking warning below 250 words.

The Project workspace now provides generation progress, a read-only rendered/raw Markdown viewer with search, copy, and download controls, and a Run Inspector containing assembled request, prompt snapshot, model, timing, usage, validation, request identifiers, and safe errors. The current Insight Source locks after generation to preserve workflow consistency until the later Insight Revision flow is available.

Verification completed with 26 unit/API tests, TypeScript checking, a production build, six end-to-end browser journeys, and desktop/tablet visual QA.
