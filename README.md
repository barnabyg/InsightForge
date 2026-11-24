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

Concept Screen mock runs produce three deterministic 1024 × 768 PNG interfaces. Include `[mock:image-failure-once-2]` in the Insight Source to fail Screen 2 once, then exercise explicit resume without regenerating Screen 1.

By default, application data is stored in the current user's operating-system application-data directory. Tests and isolated development sessions can set `INSIGHTFORGE_DATA_DIR` to override that location.

## Review a generated project

From the repository root in PowerShell 7 with Node.js 24 or later, this command installs dependencies and starts the app in mock mode with a separate local review workspace:

```powershell
& { $env:INSIGHTFORGE_OPENAI_MODE = 'mock'; $env:INSIGHTFORGE_DATA_DIR = Join-Path $env:LOCALAPPDATA 'InsightForge-UX-Review'; npm.cmd ci && npm.cmd run dev }
```

Open [the local app](http://127.0.0.1:5173), create a project, and enter a short observation. Choose **Generate complete workflow**, confirm the five operations, then choose **Review design brief**. Continue to Concept Screens and open a screen. **Fit** shows the full image and **Actual size** shows one image pixel per CSS pixel. Continue to the PRD and search for `FR-001`. Enter and Shift+Enter move between matches.

Open **Generation settings and actions** on the PRD and choose **Edit PRD prompt**. Prompt text, model, and image quality are saved together as an unpublished draft. **Save globally** applies the stage settings to future runs. **Return to PRD** reopens the same project. In the library, **Back up project** includes its history and **Download deliverables** packages its current outputs.

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
