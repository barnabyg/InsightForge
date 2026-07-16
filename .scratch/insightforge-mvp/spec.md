Status: ready-for-agent

# InsightForge MVP

## Problem Statement

A solo product manager or founder can start with a promising product insight yet struggle to turn it into a coherent Design Brief, visual product concept, and PRD. Using general-purpose LLM and image tools separately creates repetitive copying, inconsistent downstream artifacts, lost prompt provenance, and little incentive to improve the reusable prompts that produced the work. Directly editing generated documents may improve one output while leaving the underlying workflow unchanged, so the same defects recur on the next Project.

The Author needs a private, attractive, iteration-first workspace where the workflow itself is the product: shared prompts can be refined, every result remains explainable, downstream artifacts stay internally consistent, and repeated generation is safe even when it is expensive or fails partway through.

## Solution

Build InsightForge as a local, desktop-first product studio for one Author. Each saved Project contains one evolving chain:

`Insight Source -> Design Brief -> Concept Screen Set -> PRD`

The Insight Source is the only Project-specific authored content. Generated Artifacts are read-only. To improve a result, the Author either revises its upstream source or improves the shared Stage Prompt and runs the stage again. A rerun cascades through every existing downstream stage, builds a complete Candidate Workflow, and promotes it atomically only after all required Stage Runs succeed and pass deterministic validation. The prior coherent state is automatically retained as a Workflow Snapshot.

The app provides a guided stage-by-stage path and a one-pass Full Generation path. It persists all durable state through a localhost-only server, integrates only with OpenAI, preserves exact prompt/model/settings provenance, supports complete backup and practical deliverable export, and includes deterministic mock generation for testability.

## User Stories

1. As an Author, I want to create a Project from a product insight, so that I can develop one idea through a coherent workflow.
2. As an Author, I want each Project to contain one evolving artifact chain, so that I do not have to manage branches in the MVP.
3. As an Author, I want to type or paste an Insight Source, so that I can begin from whatever evidence or idea I already have.
4. As an Author, I want to import UTF-8 `.txt` or `.md` content into the Insight Source, so that test inputs are convenient to load.
5. As an Author, I want imported content normalized into the same editable text block, so that file origin does not complicate the workflow.
6. As an Author, I want an initial Project name derived locally from the first meaningful source line, so that creating a Project requires little ceremony.
7. As an Author, I want to rename a Project, so that my Project Library remains understandable.
8. As an Author, I want Projects saved continuously without a manual save button, so that work is not lost.
9. As an Author, I want to reopen saved Projects from a Project Library, so that I can continue earlier work.
10. As an Author, I want to duplicate a Project without its old snapshots or failed attempts, so that I can explore a different direction without adding branching.
11. As an Author, I want to delete a Project only after confirmation, so that destructive actions are deliberate.
12. As an Author, I want Project data independent of cookies and browser site storage, so that browser cleanup does not erase my work.
13. As an Author, I want to generate a Design Brief from the Insight Source, so that the raw idea becomes a disciplined product-design interpretation.
14. As an Author, I want the Design Brief to be authoritative for downstream work, so that later stages do not reinterpret the original Insight Source independently.
15. As an Author, I want to generate exactly three coordinated Concept Screens from the Design Brief, so that the primary journey becomes tangible at predictable cost.
16. As an Author, I want Concept Screens to be mid-fidelity and visually neutral, so that they communicate structure without pretending to be final design.
17. As an Author, I want one interface screen per Concept Screen image, so that each journey moment is easy to inspect and reference.
18. As an Author, I want the three Concept Screens to share a platform, layout system, navigation, and visual language, so that they feel like one product.
19. As an Author, I want to generate the PRD from the Design Brief and Concept Screen Set only, so that stage boundaries remain meaningful.
20. As an Author, I want the PRD to reference all three Concept Screens, so that requirements reconcile written intent and visual interaction.
21. As an Author, I want each Stage Run to be single-shot and non-interactive, so that the workflow remains predictable.
22. As an Author, I want missing information expressed as assumptions or open questions, so that the model does not invent false certainty.
23. As an Author, I want to generate the workflow stage by stage, so that I can inspect and improve each result before it becomes an input.
24. As an Author, I want a Full Generation action from the Insight Source, so that I can demonstrate or prototype an idea rapidly.
25. As an Author, I want Full Generation to run each stage once rather than autonomously iterating, so that cost and behavior remain bounded.
26. As an Author, I want a preview of affected stages and models before a cascade, so that I understand what will run.
27. As an Author, I want one active generation attempt across the app, so that cost, progress, and recovery remain understandable.
28. As an Author, I want event-based progress for each stage and Concept Screen number, so that long generation feels responsive without exposing partial Artifacts.
29. As an Author, I want elapsed time, completed-step indicators, validation status, and promotion status, so that I know what the app is doing.
30. As an Author, I want to cancel a cascade before later requests start, so that I can stop unnecessary work.
31. As an Author, I want a failed or cancelled Candidate Workflow preserved, so that successful candidate stages are not needlessly regenerated.
32. As an Author, I want to resume at the failed or interrupted operation, so that recovery is explicit and economical.
33. As an Author, I want each OpenAI operation attempted exactly once, so that the app does not hide service problems behind automatic retries.
34. As an Author, I want the current coherent workflow to remain untouched when generation fails, so that partial results never corrupt the Project.
35. As an Author, I want downstream stages regenerated whenever an upstream stage changes, so that the current workflow never mixes incompatible Artifacts.
36. As an Author, I want the previous coherent workflow preserved automatically when a candidate is promoted, so that regeneration never destroys the earlier result.
37. As an Author, I want to inspect, restore, export, or delete Workflow Snapshots, so that history remains useful and manageable.
38. As an Author, I want snapshot restoration to preserve the workflow it replaces, so that restoration itself is reversible.
39. As an Author, I want Workflow Snapshot restoration to leave global Stage Configurations unchanged, so that a local action cannot affect every Project.
40. As an Author, I want generated Artifacts to be read-only, so that improvement happens through sources and prompts rather than one-off document edits.
41. As an Author, I want a clear choice between improving the source and improving the prompt, so that Project facts and reusable workflow improvements do not become confused.
42. As an Author, I want a focused Revise Insight interaction after generation, so that an Insight Revision and its regeneration feel like one simple action.
43. As an Author, I want an unfinished Insight Revision recoverable after refresh, so that accidental navigation does not lose work.
44. As an Author, I want the Insight Source replaced only with its successfully generated Candidate Workflow, so that the Project always remains coherent.
45. As an Author, I want one shared Stage Prompt per generated stage across all Projects, so that I maintain one reusable workflow rather than Project-specific prompt copies.
46. As an Author, I want prompt instructions editable while Stage Input attachment remains app-owned, so that I cannot break placeholder wiring.
47. As an Author, I want large Stage Prompts editable in a focused, searchable, line-wrapped editor, so that prompt work is comfortable.
48. As an Author, I want prompt editing to create a recoverable Prompt Draft, so that incomplete instructions never become globally active.
49. As an Author, I want a live diff between a Prompt Draft and the active Stage Prompt, so that I understand the change I am making.
50. As an Author, I want explicit Save globally and Save & regenerate actions, so that global prompt changes are intentional.
51. As an Author, I want unsaved-change protection when closing a prompt editor, so that prompt work is not discarded accidentally.
52. As an Author, I want to preview the fully assembled request, so that app-owned instructions and attached Stage Inputs remain transparent.
53. As an Author, I want every Stage Run to retain the exact prompt, model, and generation settings used, so that an older result remains explainable.
54. As an Author, I want to restore a historical prompt explicitly as the global Stage Prompt, so that a successful prompt can be recovered without creating multiple active copies.
55. As an Author, I want prompt restoration confirmed as a global action, so that one Project cannot silently change all future generation.
56. As an Author, I want a neutral Update Available indicator when a current Artifact used an earlier Stage Configuration, so that configuration drift is visible without declaring a coherent workflow invalid.
57. As an Author, I want regeneration to begin at the earliest changed stage, so that all affected downstream Artifacts are refreshed consistently.
58. As an Author, I want Regenerate from here to be primary when input or configuration changed, so that meaningful iteration is obvious.
59. As an Author, I want Generate another variation as a separate secondary action when nothing changed, so that nondeterministic sampling is deliberate.
60. As an Author, I want one OpenAI model selection per text stage and one GPT Image model selection for Concept Screens, so that development cost and output quality can be tuned independently.
61. As an Author, I want image quality selectable as low, medium, or high, so that I can use low quality for testing and stronger quality for final runs.
62. As an Author, I want available models discovered using my configured OpenAI API access, so that selectors reflect what I can actually use.
63. As an Author, I want model discovery cached with bootstrap fallbacks, so that temporary connectivity problems do not empty the selectors.
64. As an Author, I want a static Default Workflow Configuration, so that I can bootstrap the app and recover from unusable prompt changes.
65. As an Author, I want to reset one Stage Configuration or the complete workflow after a before/after confirmation, so that recovery can be narrow or comprehensive.
66. As an Author, I want resetting configuration to leave existing Projects untouched, so that regeneration remains deliberate.
67. As an Author, I want to export and import the shared Workflow Configuration without an API key, so that prompts and model choices can be backed up and transferred safely.
68. As an Author, I want a complete self-contained Project Export, so that all current Artifacts, Workflow Snapshots, images, and provenance can be restored elsewhere.
69. As an Author, I want Project import validated transactionally, so that malformed or unsupported JSON cannot create partial data.
70. As an Author, I want imported Projects assigned new local identifiers, so that imports cannot overwrite existing Projects.
71. As an Author, I want a Deliverable Export containing Markdown documents, three Concept Screen images, and a provenance manifest, so that finished work is easy to hand off.
72. As an Author, I want Design Brief and PRD Artifacts rendered as structured Markdown, so that long results are pleasant to read.
73. As an Author, I want a sticky section outline, in-artifact search, and a full-screen focus view, so that large Artifacts remain navigable.
74. As an Author, I want a Raw Markdown view, copy action, and `.md` download, so that exact output is inspectable and portable.
75. As an Author, I want the three Concept Screens shown in a coordinated gallery with zoom and individual downloads, so that visual detail is easy to inspect.
76. As an Author, I want Concept Screens regenerated only as one set, so that individual replacements cannot break their visual continuity.
77. As an Author, I want a Run Inspector for every Stage Run, so that I can debug requests, usage, timing, provenance, and failures.
78. As an Author, I want the Run Inspector to show full error diagnostics without duplicating opaque successful API payloads, so that storage remains useful rather than noisy.
79. As an Author, I want hard Artifact Validation to prevent malformed or incomplete outputs from being promoted, so that current workflows remain usable.
80. As an Author, I want non-blocking Sanity Warnings for unexpectedly thin text, repetitive content, or undersized images, so that questionable results receive human review.
81. As an Author, I want both Design Brief and PRD warned below 250 words, so that obviously thin output is visible during testing.
82. As an Author, I want actual text word counts and image dimensions shown in diagnostics, so that validation is explainable.
83. As an Author, I want request counts, models, and reported token/image consumption shown without an unstable currency estimate, so that usage is transparent.
84. As an Author, I want local storage usage visible by Project and in total, so that image-heavy history can be managed.
85. As an Author, I want snapshots retained until I delete them, so that history is never silently pruned.
86. As an Author, I want generation blocked before storage exhaustion can corrupt a candidate, so that the app fails safely.
87. As an Author, I want existing Projects, prompts, snapshots, and exports usable without OpenAI connectivity, so that network loss does not lock me out of local work.
88. As an Author, I want a labelled connectivity indicator checked at startup and before generation, so that OpenAI availability is clear.
89. As an Author, I want connection states to distinguish checking, connected, unavailable, and missing key, so that a red light is not the only diagnostic.
90. As an Author, I want to refresh connectivity manually without periodic polling, so that network checks are predictable.
91. As an Author, I want the app to open when no API key is configured, so that local work and setup guidance remain accessible.
92. As an Author, I want OpenAI credentials read only from the server environment, so that they never enter browser storage, Projects, exports, or logs.
93. As an Author, I want the local server reachable only from my machine, so that private product data and credentials are not exposed to the LAN.
94. As an Author, I want no accounts, cookie sessions, or cloud synchronization, so that the MVP remains private and low-friction.
95. As an Author, I want no telemetry or third-party runtime services beyond OpenAI, so that the app's external data flow is minimal and explicit.
96. As an Author, I want a first-run explanation of what content is sent to OpenAI, so that generation is informed and transparent.
97. As an Author, I want a calm, editorial product-studio interface, so that long-form thinking and iteration feel focused rather than gimmicky.
98. As an Author, I want the desktop workspace organized as a stage rail, artifact canvas, and Stage Studio, so that workflow state and prompt work remain visible together.
99. As an Author, I want Workflow Snapshots accessible from a history drawer, so that history does not crowd the primary workspace.
100. As an Author, I want WCAG 2.2 AA keyboard, contrast, focus, semantic structure, live status, and reduced-motion behavior, so that the app is broadly usable.
101. As a developer, I want a visibly labelled deterministic mock mode, so that the complete workflow can be developed and demonstrated without OpenAI cost.
102. As a developer, I want mock scenarios for progress, failure, cancellation, warnings, and resume, so that difficult states are reproducible.
103. As a developer, I want the same mock boundary used by end-to-end tests, so that test behavior and local development behavior do not diverge.
104. As a developer, I want durable behavior tested through confirmed public seams, so that internal refactoring does not invalidate the suite.

## Implementation Decisions

### Product and workflow model

- The initial user is one private Author: a product manager or founder. Collaboration, roles, reviews, and approvals are excluded.
- A Project contains one current chain and no branches. Duplication is the MVP escape hatch for alternative directions.
- The fixed workflow is Insight Source to Design Brief to Concept Screen Set to PRD.
- The Design Brief consumes only the Insight Source. The Concept Screen Set consumes only the Design Brief. The PRD consumes only the Design Brief and Concept Screen Set; it must not receive the Insight Source.
- The Insight Source is one block of text. Import supports UTF-8 `.txt` and `.md` only and replaces the editor content after confirmation.
- Before first generation, the Insight Source is directly editable. After Artifacts exist, Revise Insight creates a recoverable Insight Revision whose promotion is coupled to a successful full cascade.
- Design Brief and PRD are Markdown Artifacts. Raw HTML is not executed when rendering Markdown.
- Generated Artifacts are immutable. There is no inline or raw-source editing path for generated content.
- Concept Screen Set is one Artifact containing exactly three Concept Screens. Individual screens may be viewed or downloaded but not replaced, deleted, or regenerated independently.
- The first workflow can be built stage by stage or through one-pass Full Generation. Autonomous iteration and interactive clarification are excluded.

### Default Stage Prompt contracts

- The default Design Brief Stage Prompt requests: insight summary; problem or opportunity; target user and context; evidence, assumptions, and unknowns; desired outcomes and success measures; product principles; primary journey; scope and non-goals; constraints and risks; open questions; and direction for three Concept Screens. It avoids detailed implementation requirements and labels missing facts as assumptions or questions.
- The default Concept Screens Stage Prompt requests three sequential primary-journey moments, one interface per image, a consistent platform and visual system, neutral mid-fidelity styling, representative content, and no branding, marketing art, device photography, hands, perspective mockups, or multi-screen collages.
- The default PRD Stage Prompt requests: overview and context; goals, measures, and non-goals; target user and journey; walkthrough of all Concept Screens; stable functional-requirement IDs; loading, empty, error, success, and recovery states; business rules and data needs; accessibility, privacy, security, and performance expectations; analytics; dependencies, risks, assumptions; release scope and acceptance criteria; and open questions. It calls out contradictions and avoids invented certainty.
- Each Stage Run is single-shot. Prompts instruct the model to make conservative explicit assumptions rather than asking follow-up questions.
- App-owned request assembly attaches Stage Inputs and output/orchestration requirements separately from the editable Stage Prompt. The complete assembled request remains previewable.

### Stage Configuration and prompting

- There is one global Stage Configuration per generated stage, shared across all Projects. Project-level prompt overrides do not exist.
- A Stage Configuration contains the active Stage Prompt, selected OpenAI model, and stage-specific settings such as image quality.
- Prompt editing uses a temporary, recoverable Prompt Draft. Only explicit Save globally or Save & regenerate commits it.
- Save & regenerate commits the shared prompt before beginning the Project cascade. If generation fails, the new global prompt remains active and the Project shows Update Available.
- Each Stage Run stores an immutable snapshot of the fully assembled request, Stage Prompt, model ID, generation settings, upstream lineage, timing, usage, validation results, request identifier when present, normalized status, and full error details.
- Restoring a prompt from history is a separate confirmed global action. Restoring a Workflow Snapshot never changes shared Stage Configurations.
- The Default Workflow Configuration is a static bootstrap and recovery baseline. There is no default-version notification or migration system.
- Reset this stage and Reset entire workflow show a before/after summary and require confirmation. Reset does not regenerate Projects.
- Workflow Configuration Export contains the three active Stage Configurations and no credential. Import validates completely before replacing anything.

### OpenAI integration

- OpenAI is the sole MVP provider. No provider abstraction is introduced.
- The server reads `OPENAI_API_KEY` from its environment. There is no browser credential field.
- Text stages use the Responses API with app-owned Structured Outputs equivalent to a required Markdown string wrapper. Model refusal, truncation, or schema incompatibility fails the operation.
- Bootstrap defaults are `gpt-5.6-luna` for Design Brief and PRD, and `gpt-image-2` at medium quality for Concept Screens.
- Text and image model selectors use live `GET /v1/models` discovery through the server, filtered by maintained compatible model-family rules because the Models API does not expose capability metadata. The last successful list is cached; bootstrap defaults remain available when discovery fails.
- A selected model is validated when used. An incompatible or unavailable model returns an explicit failed attempt; the app does not silently substitute another model.
- Concept Screen 1 is generated from the Design Brief and assembled Stage Prompt. Screen 2 uses Screen 1 as a visual reference. Screen 3 uses Screens 1 and 2 as visual references. All three OpenAI image operations are one Stage Run.
- The first Concept Screen uses automatic size selection. Later screens use the first screen's dimensions. Output is PNG. Size, orientation, format, compression, and moderation controls are not user settings in the MVP.
- Image quality is globally selectable as low, medium, or high and is captured in provenance.
- There are no automatic API retries. A request is attempted once; a failure is surfaced and the Candidate Workflow remains resumable.
- The app exposes model/request counts and reported token/image usage, not a monetary estimate.

### Regeneration, atomicity, and history

- A stage is eligible for primary regeneration when it has no Artifact or when its Stage Input, saved Stage Prompt, model, or settings differ from the provenance of its current Artifact.
- With unchanged input and configuration, the primary action is disabled and a secondary Generate another variation action is available.
- Rerunning an upstream stage automatically includes every existing downstream stage. There is no state in which newly promoted upstream content coexists with older downstream Artifacts.
- A cascade creates a Candidate Workflow. Successful operations persist before the next begins.
- Promotion is one server-side transaction: preserve the old coherent workflow as a Workflow Snapshot, promote the complete candidate and any Insight Revision, and update current lineage together.
- A hard validation failure, OpenAI failure, cancellation, browser interruption, or insufficient local storage prevents promotion.
- A failed or cancelled candidate retains successful intermediate operations and can be resumed from the first incomplete operation. The Author can also discard it.
- A Sanity Warning places the structurally valid candidate into an Author-review state. Accepting the warning promotes it; rejecting it keeps the current workflow and leaves the candidate available for revision or discard.
- Restoring a Workflow Snapshot first preserves the current workflow, then promotes a copy of the selected snapshot. The selected historical snapshot itself remains immutable.
- Workflow Snapshots are retained until manually deleted. There is no automatic pruning or maximum count.
- The MVP supports inspection, restoration, deletion, and export of snapshots, but not side-by-side snapshot comparison or semantic diffing.

### Artifact Validation

- Hard validation for text requires a successful non-refusal Structured Output, a non-empty Markdown string, and a complete response.
- Hard validation for Concept Screens requires exactly three decodable image files with recorded dimensions and a consistent dimension pair across the set.
- Hard validation is deterministic and never delegates quality judgment to another LLM.
- Both Design Brief and PRD receive a non-blocking Sanity Warning below 250 words.
- Deterministic warnings may also flag exact or near-exact repeated paragraphs and unexpectedly small image dimensions. Every warning must explain the measured reason.
- The Run Inspector shows actual word counts, image dimensions, and validation results.

### Persistence and data model

- The app is a local browser interface served by Fastify and bound only to `127.0.0.1`.
- The server rejects non-local host and origin headers. LAN exposure is not configurable in the MVP.
- Durable state is server-owned and cookie-independent. The browser owns interaction and cascade sequencing but writes every durable transition through the server.
- Structured state is stored in SQLite. Concept Screen binaries are stored as files under the same application-data root and referenced by stable asset identifiers.
- The data root defaults to the operating system's per-user application-data directory and can be overridden through an environment variable for development and tests.
- The repository never stores live Project data, credentials, or the production SQLite database.
- Core records include Projects, current workflow lineage, Insight Revisions, Artifacts, Stage Runs, Workflow Snapshots, Candidate Workflows, candidate operations, Stage Configurations, Prompt Drafts, model-discovery cache, binary assets, validation results, and usage records.
- Database and asset changes that form one logical operation use transactional or compensating behavior so metadata never points to missing files and failed imports never leave partial records.
- Project and Workflow Configuration JSON include an explicit schema version. Imports reject malformed, unsupported, or newer schemas before any write.
- Imported Projects receive fresh local identifiers. Names are preserved, with a visible suffix when needed to avoid ambiguity.
- Project Export is self-contained and includes the Insight Source, current workflow, Workflow Snapshots, candidate history required for recovery, Concept Screen data, and Stage Run provenance. It excludes credentials and active global Stage Configurations.
- Deliverable Export is a ZIP containing Design Brief Markdown, PRD Markdown, three PNG Concept Screens, and a small provenance/lineage manifest. It excludes snapshots and failed attempts.
- Workflow Configuration Export includes active prompts, model IDs, and image quality only. It excludes Projects, history, and credentials.
- Storage usage is reported per Project and in total. Before starting a candidate, the server verifies that persistence can proceed safely; generation is blocked rather than risking partial state.

### Service and HTTP contracts

- The browser calls public server capabilities grouped around Project lifecycle, Insight editing/import, Stage Configuration drafts and commits, model discovery/connectivity, generation operations, candidate resume/cancel/discard, snapshot lifecycle, Artifact retrieval, storage usage, and imports/exports.
- Mutating requests use explicit command semantics and return the resulting public resource representation or a stable operation status. Reads never mutate workflow state.
- Long-running work reports progress events containing the generation attempt, current stage, Concept Screen ordinal where relevant, elapsed timing, completed operations, validation phase, and promotion phase. Partial Artifact bytes or incomplete Markdown are not streamed to the artifact canvas.
- Cancel stops the browser from initiating subsequent operations. An already submitted OpenAI request may still complete or incur usage; its result is accepted only if it belongs to the active candidate operation.
- The server provides startup/configuration state without requiring OpenAI. Missing credentials or network access never prevents local reads and exports.
- Connectivity uses model discovery as its check at app startup, on manual refresh, and immediately before generation. There is no periodic polling.
- Connection state is one of checking, connected, OpenAI unavailable, or API key not configured, with the last-check time and accessible text label.
- Full errors use stable app-owned error codes plus safe human-readable messages and diagnostic details. Credentials and authorization headers are always redacted.

### Interface and experience

- The primary target is desktop browsers on laptop-sized and larger screens. Tablet-sized layouts may remain usable; polished phone support is excluded.
- The Project Library provides create, open, rename, duplicate, import, export, and confirmed delete actions. Projects sort by recent activity and show workflow progress and relevant Update Available state.
- The Project workspace uses a persistent four-stage rail, a large Artifact canvas, a right-side Stage Studio, and a separate snapshot-history drawer.
- Stage selection is non-linear; the interface is not a wizard. Initial review gates are expressed through available actions and state rather than forced pages.
- The Stage Studio contains the active prompt summary, model selector, Concept Screen image quality, provenance summary, run eligibility, and generation actions.
- Large prompt editing occurs in a focus editor with wrapping, search, draft recovery, diff against active, Save globally, and Save & regenerate.
- Large text Artifacts render Markdown with a sticky outline, search, scroll-position preservation, raw view, copy, `.md` download, and focus view.
- The Concept Screen gallery supports coordinated overview, zoom, focus, and individual downloads. It contains no edit or single-screen regeneration control.
- A Run Inspector exposes assembled request, configuration provenance, lineage, timestamps, elapsed duration, usage, request identifier, status, validation, and errors.
- Cascade confirmation shows affected stages, models, one text request per affected text stage, three image operations for Concept Screens, and selected image quality.
- The visual direction is a calm editorial product studio: warm off-white canvas, white work surfaces, deep ink text, restrained indigo/cobalt accent, generous spacing, subtle borders, and little decorative gradient. Artifact typography is editorial; prompt and diagnostic typography is compact and utilitarian.
- Motion explains progress and promotion rather than decorating the interface. Reduced-motion preferences are honored.
- WCAG 2.2 AA is the MVP target: full keyboard operation, visible focus, semantic headings and landmarks, labelled controls, sufficient contrast, live generation announcements, reduced motion, and no color-only status.

### Privacy and offline behavior

- There are no accounts, cookie sessions, cloud synchronization, analytics, crash reporting, update tracking, or third-party runtime fonts/assets.
- The only external runtime service is OpenAI, and only the required assembled prompt and Stage Inputs are sent.
- A first-run notice explains this boundary. The Run Inspector makes sent content inspectable.
- Logs and exports never contain the API key. Authorization data is redacted before error persistence.
- Project browsing, Artifact viewing, prompt drafting, snapshot actions, local model-cache viewing, and exports remain usable without OpenAI. Only discovery, connection testing, and generation require connectivity.

### Development and mock mode

- React, TypeScript, and Vite implement the browser interface. Fastify and TypeScript implement the local server. SQLite stores structured state; the file system stores Concept Screen binaries. CSS Modules and a small bespoke design system implement the interface.
- Frontend and server share public TypeScript contracts without sharing hidden persistence representations.
- Mock mode is selected only by a server startup environment variable and is always visibly labelled in the UI.
- The fake OpenAI boundary produces deterministic Design Brief, Concept Screen, and PRD fixtures and controllable progress, validation warning, refusal, model incompatibility, network failure, cancellation, and resume scenarios.
- Mock mode is not a normal user preference and cannot be toggled from the browser.

## Testing Decisions

- Tests verify observable behavior through public interfaces. They do not assert private method calls, internal module structure, SQL rows, or React implementation details.
- Development follows vertical red-green slices: write one failing behavioral test at a confirmed seam, implement only enough to satisfy it, then take the next slice.
- The highest-value seam is the Workflow service. It is exercised with a real temporary SQLite database and real temporary asset directory while replacing only the external OpenAI boundary. It covers Project lifecycle, Stage Run eligibility, cascades, atomic promotion, failed candidates, resume, cancellation, snapshots, restoration, validation, and exports.
- The HTTP API seam covers request/response contracts, input validation, command idempotency where required, error mapping, localhost host/origin enforcement, transactional import behavior, connectivity state, and safe credential redaction.
- The browser seam uses Playwright against server mock mode for critical Author journeys: create/import an Insight Source; guided generation; Full Generation; prompt draft/save/regenerate; Update Available; Variation Run; failed cascade/resume; warning review; snapshot restore/delete; Project/config/deliverable export; offline local access; missing-key state; and keyboard-accessible focus modes.
- The OpenAI adapter seam mocks only the external OpenAI SDK. It verifies text request assembly and Structured Output parsing, explicit refusal handling, live model-list filtering, Concept Screen reference sequencing, automatic/fixed dimensions, image quality propagation, usage and request-ID capture, no automatic retry, and safe error normalization.
- Test database assertions go through Workflow service queries, never direct SQL. Browser assertions go through visible and accessible UI state, never internal React state.
- Fixture expectations are independently authored known outputs. Tests must not compute expected values using the same implementation algorithm.
- Accessibility checks include automated rules plus explicit keyboard and live-region scenarios for generation, warnings, errors, and modal/focus interactions.
- Import/export tests round-trip through public APIs, then retrieve and compare public Project behavior and Artifact bytes rather than implementation-specific database layout.
- Promotion tests deliberately fail each operation boundary and prove that the prior current workflow remains coherent, successful candidate work remains resumable, and no orphaned binary references are exposed.
- Mock mode itself is covered by its public OpenAI-boundary contract so Playwright does not depend on accidental fixture implementation details.
- There is no prior application test suite in the repository; the existing testing strategy and confirmed seams are the starting contract.

## Out of Scope

- Accounts, authentication, persistent cookies, teams, sharing, comments, approvals, roles, or real-time collaboration
- Cloud storage, synchronization, hosted deployment, LAN access, or multi-device continuity other than explicit export/import
- Native desktop packaging or installers
- Multiple LLM providers or a provider abstraction
- Project-level Stage Prompts, prompt branches, prompt libraries, or multiple active prompt versions
- Branching workflows or parallel product directions within one Project
- Direct editing of generated Design Briefs, Concept Screens, or PRDs
- Autonomous iteration, AI quality graders, agentic stopping rules, or interactive clarification conversations
- A variable or model-decided number of Concept Screens
- High-fidelity branded mockups, pixel-perfect design output, source design files, or editable design canvases
- Individual Concept Screen replacement or regeneration
- PDF, Word, image, URL, or multi-document Insight Source ingestion
- Snapshot comparison, semantic diffing, or AI-generated change summaries
- Partial text or image streaming into the Artifact viewer
- Automatic OpenAI retries
- Monetary cost estimates or automatic spend limits
- User-configurable image dimensions, format, compression, moderation, or text-model sampling/reasoning parameters
- Default-prompt update notifications, migrations, or default-version management
- Automatic snapshot pruning
- Mobile-first or polished phone layouts
- Telemetry, analytics, crash reporting, or third-party runtime asset services

## Further Notes

- Product name: InsightForge.
- The core design philosophy is intentionally demanding: Artifacts are outcomes; prompts are the reusable workflow asset.
- The consistency invariant is stronger than ordinary revision history. A current Project must always represent one internally compatible lineage.
- A Workflow Snapshot should be created transactionally during successful promotion, not eagerly at cascade start, to avoid redundant snapshots when a candidate fails.
- Because the OpenAI Models API returns identifiers but no capability metadata, model discovery requires maintained family filters and runtime validation: [List models](https://developers.openai.com/api/reference/resources/models/methods/list).
- Text response envelopes should use app-owned Structured Outputs: [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
- Concept Screen generation relies on OpenAI image generation/edit reference workflows and must account for documented limitations in consistency, precise text, and layout control: [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation).
- Bootstrap model choices reflect current guidance at specification time and remain replaceable through live model selectors: [Model guidance](https://developers.openai.com/api/docs/guides/latest-model), [GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2).
- The spec is ready to decompose into vertical implementation tickets; no application code is part of this specification step.
