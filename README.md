# InsightForge

InsightForge is a local workflow application for turning a product insight into a Design Brief, three Concept Screens, and a PRD. Generated artifacts are read-only; iteration happens by improving the shared prompts and rerunning a consistent workflow.

The product definition is in [the MVP specification](docs/product/insightforge-mvp.md), and implementation work is tracked in the [InsightForge MVP milestone](https://github.com/barnabyg/InsightForge/milestone/1).

## Development

InsightForge currently requires Node.js 24 or later because its local persistence layer uses the built-in SQLite module.

```powershell
npm install
npm run dev
```

The browser client is available at `http://127.0.0.1:5173`. Its API is served on `http://127.0.0.1:4317`. Both development servers bind only to loopback.

To build the browser client and serve the complete production application from Fastify at `http://127.0.0.1:4317`:

```powershell
npm run serve
```

For live connectivity, provide an OpenAI API key to the server process:

```powershell
$env:OPENAI_API_KEY='your-key'
npm run dev
```

For deterministic local development without OpenAI calls:

```powershell
$env:INSIGHTFORGE_OPENAI_MODE='mock'
npm run dev
```

Mock mode is always labelled in the interface. The application does not use accounts or cookies, and never returns the API key to the browser.

Design Brief mock runs are deterministic. For validation and diagnostic testing, include one of these markers in the Insight Source:

- `[mock:short]` returns a structurally valid brief below the 250-word recommendation.
- `[mock:failure]` simulates a failed OpenAI request.
- `[mock:refusal]` simulates an explicit model refusal.

By default, application data is stored in the current user's operating-system application-data directory. Tests and isolated development sessions can set `INSIGHTFORGE_DATA_DIR` to override that location.

## Verification

Install the Playwright browser once on a development machine:

```powershell
npx playwright install chromium
```

```powershell
npm test
npm run test:e2e
npm run typecheck
npm run build
```
