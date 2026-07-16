# 11 — Inspect and manage workflow snapshots

**What to build:** A compact history experience for the explicitly preserved workflow snapshots created before replacements, supporting inspection, restoration, and deletion without turning the product into a branching or comparison system.

**Type:** feature

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] Users can list snapshots with meaningful creation and provenance details.
- [ ] A snapshot's artifacts can be inspected read-only.
- [ ] Restoring a snapshot atomically replaces the current workflow after confirmation.
- [ ] Deleting a snapshot reclaims its unreferenced assets safely.
- [ ] Restoring workflow artifacts does not silently overwrite the global prompt configuration.
- [ ] No branching, merging, or side-by-side comparison controls are introduced.
