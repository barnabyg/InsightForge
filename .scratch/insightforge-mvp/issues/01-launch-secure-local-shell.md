# 01 — Launch the secure local InsightForge shell

**What to build:** A runnable local InsightForge application foundation with the agreed editorial visual direction, localhost-only HTTP boundary, per-user SQLite and asset storage bootstrap, OpenAI-key/connectivity status, and an unmistakable mock-mode indicator. Establish the first public HTTP and UI test seams without implementing workflow stages.

**Type:** feature

**Blocked by:** Nothing

**Status:** resolved

- [x] The browser client and local server start together through documented development commands.
- [x] The server binds to loopback and rejects non-local Host and Origin values.
- [x] Application data is initialized in a per-user directory, with a test-only/configuration override, using SQLite plus an asset directory.
- [x] The shell reports API-key and connectivity state without exposing the key or requiring cookies.
- [x] Mock mode is deterministic and visibly identified in both API state and the interface.
- [x] The initial interface has an accessible, responsive editorial shell suitable for later workflow views.
- [x] Public HTTP and rendered-UI tests cover the launch, security, and status behavior.

## Answer

Implemented the React/Vite and Fastify application foundation with a production shell served from loopback, strict local Host/Origin checks, per-user SQLite and asset initialization, non-blocking single-attempt OpenAI connectivity, deterministic mock mode, and an accessible responsive CSS-Module interface. The public HTTP and rendered UI contracts are covered by eight tests, including a real loopback listener, a production-shell security case, and a one-request startup connectivity transition without polling. Verification passes for tests, typechecking, production build, npm audit, and a production asset smoke check. See [the development and launch guide](../../../README.md) and the public seams under `src/server` and `src/client`.
