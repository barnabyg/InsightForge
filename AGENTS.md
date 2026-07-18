# Agent guidance

## GitHub access on native Windows

GitHub CLI authentication is stored under the normal Windows user, while the elevated Codex sandbox runs commands as a separate Windows user that cannot reliably access that keyring.

- Do not run `gh auth login` merely because sandboxed `gh auth status` reports an invalid token. Treat that result as inconclusive.
- Prefer the connected GitHub app for supported repository, issue, pull-request, comment, and label operations.
- When `gh` is required, request narrowly scoped execution outside the sandbox so it can use the host user's credential store.
- Request separately scoped outside-sandbox execution for authenticated remote Git operations when needed.
- Do not switch to Full Access, persist `GH_TOKEN` or `GITHUB_TOKEN`, or use `gh auth login --insecure-storage` solely to work around sandbox keyring isolation.

See `docs/research/github-access-from-codex-on-windows.md` for the supporting research and upstream issue links.

## Agent skills

### Issue tracker

Implementation work is tracked in GitHub Issues. Product specifications remain in the repository. See `docs/agents/issue-tracker.md`.

### Triage labels

The repository uses the five default engineering-skill triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository with a root glossary and system-wide ADRs. See `docs/agents/domain.md`.
