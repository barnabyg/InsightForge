# Testing strategy

InsightForge is developed in vertical red-green slices: one failing behavioral test, the smallest implementation that satisfies it, then the next slice. Tests exercise public seams and must survive internal refactoring.

## Confirmed test seams

### Workflow service

Exercise public commands and queries such as creating and retrieving Projects, running a stage, resuming a Candidate Workflow, restoring a Workflow Snapshot, and exporting data. Use real SQLite and image files in a temporary application-data directory, with a fake OpenAI boundary. Verify results through service queries rather than direct database access.

### HTTP API

Exercise request and response contracts, input validation, localhost host/origin enforcement, transactional imports, and error mapping through the Fastify interface.

### Browser

Exercise critical Author journeys through Playwright against server mock mode. Do not mock internal React modules or assert on implementation details.

### OpenAI adapter

Exercise assembled text and image requests, Structured Output parsing, sequential image-reference behavior, usage capture, and error normalization. Mock only the external OpenAI SDK and use independently authored fixture responses.

## Mock mode

Server mock mode is enabled only through an environment variable. It provides deterministic artifacts and scenarios for progress, failure, cancellation, validation warnings, and resume behavior. The interface always labels mock mode visibly.

## Rules

- Write the failing behavioral test before its implementation.
- Work one vertical slice at a time.
- Test outcomes through public interfaces, not internal calls or private state.
- Do not inspect SQLite directly to prove service behavior.
- Do not mock application-owned modules.
- Keep expected values independent from the implementation under test.
