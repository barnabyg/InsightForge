# Run as a local browser application

The MVP runs as a browser interface served from a local application server bound only to `127.0.0.1`. The server rejects non-local host and origin headers, persists Project data, shared Stage Configurations, and Workflow Snapshots in the operating system's per-user application-data directory, with an environment-variable override for development and tests. It reads the OpenAI API key from the environment and performs OpenAI requests. The browser uses no cookie-based identity or persistence. This preserves a lightweight web UX without exposing the credential or private product data to the LAN, depending on browser site-data retention, or introducing accounts and cloud infrastructure.

## Consequences

The MVP requires a local start command, a supported browser, and a writable application-data directory. Native installation, cross-device synchronization, hosted multi-user operation, cookie-based sessions, and frontend-managed API credentials are outside its scope.
