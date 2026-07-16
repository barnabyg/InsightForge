# Use a TypeScript local web stack

The MVP uses React, TypeScript, and Vite for the interface and a Fastify TypeScript server for OpenAI calls and durable local state. The server stores structured data in SQLite and Concept Screen binaries in an application-data directory. CSS Modules and a small bespoke design system support a distinctive interface without adopting a large component framework. Vitest, React Testing Library, and a focused Playwright workflow cover behavior and end-to-end integration with mocked OpenAI responses.

## Consequences

Frontend and server share TypeScript contracts, while all durable state and credential handling remain outside the browser. The browser orchestrates workflow sequencing and persists each transition through the server. The application is optimized for a locally served web experience rather than native packaging or hosted multi-user deployment.
