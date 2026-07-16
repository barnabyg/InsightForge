# 03 — Configure the shared workflow safely

**What to build:** A global workflow configuration experience for the three stage prompts and stage-specific OpenAI model choices, with large-draft editing, protected placeholders, live model discovery, explicit save, reset to bundled defaults, and configuration import/export.

**Type:** feature

**Blocked by:** 01

**Status:** resolved

- [x] One saved prompt and model configuration is shared across all Projects.
- [x] Prompt drafts can be edited comfortably, compared with the saved version, explicitly saved, or discarded.
- [x] Required placeholders cannot be deleted or malformed by prompt editing.
- [x] Available compatible text and image models are obtained from OpenAI and filtered for the relevant stage.
- [x] Image quality can be selected independently of the image model.
- [x] Users can reset to bundled defaults and export or import the global configuration.

## Answer

Implemented a local Prompt Studio for the three generated stages. It persists one shared configuration and recoverable prompt drafts in SQLite, keeps workflow inputs outside editable prompt text, discovers and filters compatible OpenAI model IDs with safe cache/default fallbacks, and supports explicit global saves, image quality, previews, comparisons, stage/all reset, and strict versioned JSON import/export.

The service, HTTP API, OpenAI discovery adapter, and browser workflow have automated coverage. Verification completed with 19 unit/API tests, TypeScript typechecking, the production build, and all 3 end-to-end journeys.
