# 13 — Import a Project backup transactionally

**What to build:** Safe Project import from the versioned backup format, with integrity and compatibility validation, collision handling, and all-or-nothing persistence.

**Type:** feature

**Blocked by:** 12

**Status:** ready-for-agent

- [ ] Valid Project backups can be imported without requiring accounts, cookies, or cloud services.
- [ ] Version, structure, asset integrity, and references are validated before any durable change.
- [ ] Name and identifier collisions are handled without overwriting an existing Project.
- [ ] Invalid or interrupted imports leave storage unchanged and provide actionable errors.
- [ ] Imported Projects retain usable workflow, snapshot, candidate, and provenance data.
