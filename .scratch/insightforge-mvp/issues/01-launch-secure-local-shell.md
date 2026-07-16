# 01 — Launch the secure local InsightForge shell

**What to build:** A runnable local InsightForge application foundation with the agreed editorial visual direction, localhost-only HTTP boundary, per-user SQLite and asset storage bootstrap, OpenAI-key/connectivity status, and an unmistakable mock-mode indicator. Establish the first public HTTP and UI test seams without implementing workflow stages.

**Type:** feature

**Blocked by:** Nothing

**Status:** claimed

- [ ] The browser client and local server start together through documented development commands.
- [ ] The server binds to loopback and rejects non-local Host and Origin values.
- [ ] Application data is initialized in a per-user directory, with a test-only/configuration override, using SQLite plus an asset directory.
- [ ] The shell reports API-key and connectivity state without exposing the key or requiring cookies.
- [ ] Mock mode is deterministic and visibly identified in both API state and the interface.
- [ ] The initial interface has an accessible, responsive editorial shell suitable for later workflow views.
- [ ] Public HTTP and rendered-UI tests cover the launch, security, and status behavior.
