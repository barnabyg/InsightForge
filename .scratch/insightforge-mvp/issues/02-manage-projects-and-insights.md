# 02 — Manage Projects and Insight Sources

**What to build:** The Project Library and Project workspace entry flow, including project creation, loading, renaming, duplication, deletion, Insight Source text entry, autosave, and convenient plain-text or Markdown import.

**Type:** feature

**Blocked by:** 01

**Status:** resolved

- [x] Users can create, load, rename, duplicate, and delete locally saved Projects.
- [x] Each Project contains exactly one workflow chain and one Insight Source text block.
- [x] Insight text autosaves and can be imported from `.txt` or `.md` files.
- [x] Destructive actions are clearly confirmed and preserve unrelated Projects.
- [x] Project and Insight behavior is covered through public service and UI seams.

## Answer

Implemented a SQLite-backed Project service and localhost API for create, list, load, rename, duplicate, delete, and Insight Source updates. The browser now provides an editorial Project Library and focused Insight workspace with local name derivation, debounced autosave, pending/save/error feedback, autosave flushing on navigation, browser-history support, UTF-8 `.txt`/`.md` replacement confirmation, and accessible rename/delete dialogs.

Verified through real temporary SQLite service tests, injected Fastify API tests, and a Playwright journey covering creation, reload, Markdown import, rename, duplication, confirmed deletion, navigation-time autosave, and browser Back behavior. The existing shell/privacy journey remains green.
