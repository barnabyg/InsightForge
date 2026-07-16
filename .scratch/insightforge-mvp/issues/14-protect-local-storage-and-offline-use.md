# 14 — Protect local storage and offline use

**What to build:** Production hardening for local durability and offline operation: startup recovery, orphan cleanup, storage visibility, graceful OpenAI unavailability, and packaging behavior that keeps all non-generation features useful without network access.

**Type:** feature

**Blocked by:** 11, 13

**Status:** ready-for-agent

- [ ] The application recovers safely from interrupted writes and detects unusable local data at startup.
- [ ] Unreferenced temporary assets and abandoned operations are cleaned without deleting valid history.
- [ ] Users can see local storage consumption and the location of their application data.
- [ ] Projects, prompts, artifacts, snapshots, exports, and imports remain usable while OpenAI is unavailable.
- [ ] Connectivity loss is reported clearly and never triggers automatic retry.
- [ ] The production package preserves loopback-only access and the tested local persistence guarantees.
