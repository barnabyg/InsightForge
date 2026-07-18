# GitHub access from Codex on Windows

Date: 2026-07-17

## Executive finding

The behaviour observed in InsightForge is a known, still-open Codex sandbox problem rather than a failure to persist the GitHub login.

On Windows, GitHub CLI normally stores its token in the Windows credential store. Codex's preferred elevated Windows sandbox runs commands under dedicated lower-privilege sandbox users. Those users do not necessarily see credentials stored for the interactive Windows user. The result is the misleading combination seen locally: `gh auth status` reports an invalid token inside the sandbox, while the same `gh.exe` and account work outside it.

The exact reproduction is tracked in [openai/codex issue #21821](https://github.com/openai/codex/issues/21821), which remains open and is labelled `bug`, `auth`, `sandbox`, and `windows-os`. Related open reports include the built-in Fix CI skill failing for the same reason in [issue #10695](https://github.com/openai/codex/issues/10695) and valid credentials being reported as invalid only inside Codex in [issue #19262](https://github.com/openai/codex/issues/19262).

There is no completed transparent fix that makes the host user's keyring-backed `gh` login automatically available to every native Windows Codex sandbox. The best-supported operating model is:

1. Authenticate `gh` once under the normal Windows user.
2. Prefer the GitHub connector for supported repository, issue, and pull-request operations.
3. Run CLI-specific `gh` operations outside the sandbox through narrowly scoped, persistent Codex rules.
4. Add durable repository guidance so new tasks request that execution path instead of attempting another login.

## Why it happens

[OpenAI's Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox) says the preferred `elevated` sandbox uses dedicated lower-privilege Windows users, filesystem boundaries, and firewall rules. Its `unelevated` fallback instead uses a restricted token derived from the current user and provides weaker isolation.

[GitHub CLI's authentication documentation](https://cli.github.com/manual/gh_auth_login) says the browser login flow stores the token in the operating system's credential store. The two documented designs therefore create an identity boundary:

| Context | Windows identity | Credential result |
| --- | --- | --- |
| Normal or approved host execution | Interactive user (`saturn\bob` locally) | Can access Bob's GitHub CLI keyring entry |
| Elevated Codex sandbox | Dedicated sandbox user (`saturn\codexsandboxoffline` locally) | Can read shared `hosts.yml` metadata but not Bob's keyring entry |

This is also what the local diagnostics showed on 2026-07-17:

- Sandboxed execution used `saturn\codexsandboxoffline` and reported the `barnabyg` token as invalid.
- Approved execution outside the sandbox used `saturn\bob` and reported `barnabyg` as logged in through the keyring.
- Both contexts used `C:\Program Files\GitHub CLI\gh.exe`.
- `GH_TOKEN`, `GITHUB_TOKEN`, and `GH_CONFIG_DIR` were not set.

This means the credential is persistent. What changes is the identity and security context attempting to read it.

## What people are doing

### 1. Scoped host execution with persistent rules

This is the closest thing to the documented standard approach.

[OpenAI's rules documentation](https://learn.chatgpt.com/docs/agent-configuration/rules) explicitly uses `gh pr view` as its example of a command allowed to run outside the sandbox. Rules under the user layer at `~/.codex/rules/` are loaded at startup and persist across future tasks. A rule can:

- `allow` a matching command outside the sandbox without prompting;
- `prompt` for every matching invocation; or
- `forbidden` to block it.

OpenAI's Windows guidance recommends keeping sandbox boundaries and using rules for specific exceptions rather than using Full Access for routine automation.

There is an important current limitation: a rule governs a request to execute outside the sandbox, but it does not necessarily reroute an ordinarily sandboxed command automatically. That missing separation between permission and sandbox placement is tracked in open [issue #20917](https://github.com/openai/codex/issues/20917), whose motivating example is `gh` needing access to the user's normal authentication state.

For reliable behaviour across new tasks, rules should therefore be paired with a durable instruction telling Codex to request scoped outside-sandbox execution whenever it needs `gh`.

### 2. Connector-first, CLI for gaps

The installed first-party GitHub plugin follows a hybrid model:

- use the GitHub connector for repository, issue, pull-request, comment, label, and similar structured operations;
- use local `git` and `gh` only for gaps such as current-branch PR discovery, some Actions/CI inspection, committing, and pushing.

This avoids the Windows keyring boundary for operations the connector supports. It also avoids treating a sandboxed `gh auth status` failure as proof that all GitHub access is broken.

For InsightForge, the connector was verified as `barnabyg` with admin and push permissions on `barnabyg/InsightForge`.

### 3. Full Access

Several users report that switching a task to Full Access makes `gh` work because the command runs in the host user's security context. It is effective but broad.

[OpenAI's Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox) warns that Full Access removes the project boundary and can permit unintended destructive actions. It recommends narrowly scoped rules for safer automation. Full Access is therefore reasonable as a diagnostic or inside a separately isolated environment, but not as the default answer to GitHub authentication.

### 4. `GH_TOKEN` injection

GitHub supports `GH_TOKEN` and `GITHUB_TOKEN`; they take precedence over stored credentials and are intended primarily for headless automation. See [GitHub CLI environment variables](https://cli.github.com/manual/gh_help_environment) and [GitHub CLI authentication](https://cli.github.com/manual/gh_auth_login).

Users sometimes inject a process-scoped token so sandboxed `gh` does not need the Windows credential store. This has drawbacks for local interactive Codex use:

- the token is exposed to the subprocess environment;
- it disappears with the process unless deliberately persisted;
- Codex's default shell-environment policy filters variable names containing `KEY`, `SECRET`, or `TOKEN` unless explicitly configured otherwise, as documented in [advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced);
- storing the token in repository configuration or shell profiles widens the secret boundary.

This is suitable for controlled headless automation, but it is not the preferred desktop workaround.

### 5. Authenticate the sandbox identity separately

Some users authenticate `gh` from inside the network-enabled sandbox so the sandbox user's own credential-store view contains a separate token. This can work, but it creates multiple credentials and is sensitive to whether Codex uses its online or offline sandbox identity. Interactive device login is also awkward from a tool call.

This is a community workaround, not documented as the standard Codex workflow.

### 6. Plaintext credential storage

GitHub CLI offers `--insecure-storage`, which writes credentials outside the secure keyring. That can make credentials visible to the sandbox, but GitHub explicitly describes it as insecure storage. It should not be used to work around this problem.

## Recommended operating model for InsightForge

### Repository guidance

Add durable guidance equivalent to the following to the repository's `AGENTS.md`:

> GitHub CLI is authenticated under Bob's normal Windows identity. The elevated Codex sandbox runs as a separate Windows user and cannot reliably access that keyring. Do not reauthenticate when sandboxed `gh auth status` fails. Prefer the GitHub connector for supported issue, pull-request, and repository operations. When `gh` is required, request narrowly scoped execution outside the sandbox.

### Persistent rules

Create narrowly scoped rules for the read-only command families used repeatedly, for example:

- `gh auth status`
- `gh pr view`, `gh pr list`, `gh pr status`, and `gh pr checks`
- `gh issue view` and `gh issue list`
- `gh run view` and `gh run list`

Retain prompts for mutations such as creating or editing pull requests, rerunning workflows, or pushing branches. Do not broadly allow `gh api`, because it can perform arbitrary reads and writes depending on its arguments.

Rules should be tested with `codex execpolicy check`, as described in the [rules documentation](https://learn.chatgpt.com/docs/agent-configuration/rules). On Windows, also confirm the rule matches the actual command form surfaced by Codex rather than assuming a Unix-style wrapper.

### Task behaviour

Each new implementation task should follow this sequence:

1. Use the connector to read the ticket and related GitHub context.
2. Work locally and run tests inside the normal workspace sandbox.
3. Use a scoped outside-sandbox `gh` command only where the connector does not cover the operation.
4. Use separately scoped approval for remote `git` operations such as `git push`.
5. Never use a sandboxed `gh auth status` failure as a reason to run `gh auth login` again.

## Conclusion

The repeated-login experience is a product limitation at the intersection of the native Windows sandbox and keyring-backed GitHub CLI authentication. It is known upstream and remains open as of 2026-07-17.

The secure, repeatable approach is not to reauthenticate every task. It is to authenticate once under the host user, use the GitHub connector where possible, and persist narrowly scoped rules plus repository instructions for the `gh` commands that must run outside the sandbox.

## Primary sources

- [OpenAI: Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)
- [OpenAI: Rules](https://learn.chatgpt.com/docs/agent-configuration/rules)
- [OpenAI: Agent approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security)
- [GitHub CLI: `gh auth login`](https://cli.github.com/manual/gh_auth_login)
- [GitHub CLI: environment variables](https://cli.github.com/manual/gh_help_environment)
- [openai/codex #21821: Windows sandbox cannot access valid `gh` keyring auth](https://github.com/openai/codex/issues/21821)
- [openai/codex #10695: Fix CI skill cannot access GitHub auth in the app sandbox](https://github.com/openai/codex/issues/10695)
- [openai/codex #19262: `gh auth status` misreported as invalid inside Codex](https://github.com/openai/codex/issues/19262)
- [openai/codex #20917: per-command sandbox exclusion request](https://github.com/openai/codex/issues/20917)
