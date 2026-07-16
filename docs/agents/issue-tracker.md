# Issue tracker: Local Markdown

Issues and specs (also known as PRDs) for this repo live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`; never use one combined tickets file
- Triage state is recorded as a `Status:` line near the top of an issue file
- Comments and conversation history append under a `## Comments` heading

## Publishing

When a skill says to publish to the issue tracker, create a new file under `.scratch/<feature-slug>/`, creating the directory if needed.

When a skill says to fetch a ticket, read the referenced local Markdown file.

## Wayfinding

- Map: `.scratch/<effort>/map.md`
- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md`
- A child ticket records `Type:`, `Status:`, and optional `Blocked by:` lines
- The frontier is the lowest-numbered open, unblocked, unclaimed child ticket
- Claim by setting `Status: claimed` before work
- Resolve by appending an `## Answer`, setting `Status: resolved`, and adding a context pointer to the map
