# 12 — Export a complete Project backup

**What to build:** A portable JSON-and-assets Project backup that captures the Project, current workflow, candidates, snapshots, provenance, and necessary configuration references for later transactional import.

**Type:** feature

**Blocked by:** 10, 11

**Status:** ready-for-agent

- [ ] Users can export a complete, versioned Project backup with all referenced assets.
- [ ] The backup preserves current workflow, snapshots, resumable candidates, and provenance.
- [ ] The archive is self-describing and includes integrity metadata.
- [ ] Secrets and machine-specific absolute paths are excluded.
