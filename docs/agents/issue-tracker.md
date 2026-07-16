# Issue tracker: GitHub Issues

Implementation issues for this repository live in [GitHub Issues](https://github.com/barnabyg/InsightForge/issues). Durable product specifications live in the repository under `docs/product/`; do not maintain duplicate local ticket files.

## Conventions

- Use one GitHub issue per independently testable vertical slice.
- Associate MVP work with the [InsightForge MVP milestone](https://github.com/barnabyg/InsightForge/milestone/1).
- Record the outcome, specification link, dependencies, and testable acceptance criteria in the issue body.
- Express dependencies with GitHub issue references such as `Blocked by #4`.
- Use the canonical triage labels documented in `docs/agents/triage-labels.md`.
- Use the `feature` label for product functionality and `in-progress` while an issue is claimed.
- Treat issue comments as the implementation history; do not copy that history into repository Markdown.

## Finding the next ticket

The frontier is the lowest-numbered open issue in the active milestone that:

1. has the `ready-for-agent` label;
2. has no open issue named in its `Blocked by` section; and
3. is not already labelled `in-progress`.

Inspect the full issue body and every linked dependency before starting work.

## Claiming and resolving

1. Claim an issue by replacing `ready-for-agent` with `in-progress` before changing code.
2. Implement and verify only that issue's scope.
3. Create one focused commit for the issue and reference it in the commit subject, for example `feat: generate concept screens (#5)`.
4. Push the commit, add a completion comment containing the commit link and verification results, remove `in-progress`, then close the issue as completed.
5. If work is abandoned, remove `in-progress` and restore the appropriate triage label.

Do not combine unrelated issues into one commit. Review findings that require independent fixes should likewise receive one focused commit per finding.
