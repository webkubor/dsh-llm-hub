<p align="center">
  <img src="https://img.webkubor.online/oss/dsh-llm-hub/banner.png" alt="dsh-llm-hub" width="100%" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@dsh-plugins/dsh-llm-hub"><img src="https://img.shields.io/npm/v/@dsh-plugins/dsh-llm-hub?style=flat-square&color=4C7EF3&label=npm" alt="npm" /></a>
  <img src="https://img.shields.io/badge/deps-0-5A9E6F?style=flat-square" alt="zero deps" />
  <img src="https://img.shields.io/badge/license-MIT-777?style=flat-square" alt="MIT" />
  &nbsp;·&nbsp; <a href="README.md">中文</a> · <a href="CHANGELOG.md">Changelog</a>
</p>

On DSH's Models page, the official adapters leave half the job undone. This plugin finishes it:

| | Official adapter | dsh-llm-hub |
|---|---|---|
| Which DeepSeek models exist | invisible | **one click, live list** |
| How much credit is left | invisible | **balance row on the card** |
| Is the gateway up, how fast | button does nothing | **measured latency & status** |
| How many models it serves | invisible | **71 measured** (11 hand-typed) |
| Why it can't be probed | no hint | **says "no baseURL"** |

<p align="center">
  <img src="https://img.webkubor.online/oss/dsh-llm-hub/v060/models-piai-cards.png" alt="The models page after install: each provider card gains a row — protocol, endpoint, configured models, balance, with probe and catalog actions on the right" width="100%" />
  <br />
  <sub>The models page after install: each provider card gains a row — protocol, endpoint, configured models, balance, with probe and catalog actions on the right</sub>
</p>

## Install

```sh
dsh plugin --profile web add @dsh-plugins/dsh-llm-hub
```

Add `@dsh-plugins/dsh-llm-hub` to `dsh.profile.bundles` in `~/.dsh/profiles/web/package.json`, then run `~/.dsh/restart.sh`.
Open **Settings → Models** — a new row appears under the provider cards.

<sub>A boot-graph change requires a restart; hot reload won't pick it up. `cordis.patch.yml` is inserted automatically by the bundle mechanism.</sub>

---

## What it fills in

DSH already ships every mechanism involved; what was missing is that the
official adapter never used them:

| Capability | Official mechanism | State on the direct route |
|---|---|---|
| Model discovery | `llm` service's `registerModelDiscovery(ns, discover)` + the Models page's "Fetch available models" | `@deepseek-ai/dsh-llm-deepseek` **never registers one** (`discover` has zero occurrences in both 0.1.2-rc.1 and 0.1.5-rc.2) |
| Provider-card extension | `settings.models.provider-card` (keyed by `settingsNs`) | No registrant → the area renders nothing |
| Account balance | DeepSeek `GET /user/balance` | Not exposed by the adapter |

**The discovery registry permits exactly one registration per settings
namespace** (a second throws `DUPLICATE_DISCOVERY`), and the `llm-deepseek`
namespace is unoccupied — so this plugin takes it. DSH's own
`slot-contract.d.ts` states plainly that those two slots exist for **plugins
distributed outside the repository**.

## Usage

**Model discovery** — Settings → Models → the **DeepSeek** card → **"Fetch
available models"**. It live-fetches `https://api.deepseek.com/models` and
offers every advertised model for adoption.

**Balance** — a balance row appears under the same DeepSeek card (fetched on
mount, with a manual refresh).

**pi-ai bypass card** — under any pi-ai provider card (modelgo / minimax /
zai-coding-cn …): a standing row with the configured model count and key state,
a **Probe gateway** button reporting reachability, latency and the remote
catalog size, and — modelgo only — **Fetch catalog** with one-click id copy.
Providers without a `baseURL` (zai-coding-cn) show an honest "cannot probe"
hint instead.

## Behaviour

### Connection facts

`baseURL` and `apiKey` resolve in the same order the adapter itself uses, and
the `llm-deepseek` settings section is **re-read lazily on every call** — at
plugin-apply time the section may not be registered yet (a startup race), and
the adapter re-resolves its own connection facts per request:

| | Resolution order |
|---|---|
| baseURL | `request.baseURL` → the section's `baseURL` → `$DEEPSEEK_BASE_URL` → `https://api.deepseek.com` |
| apiKey | `request.apiKey` (a one-shot key typed into the form) → the credential named by the section's `apiKeyEnv` → that environment variable |

### Balance route

`GET /api/dsh-llm-hub/balance` →
`{ ok, isAvailable, balances: [{ currency, total, granted, toppedUp }] }`

Amounts are kept **as the strings DeepSeek returns** (the upstream sends
strings; parsing them would invite floating-point drift). Only `GET`/`HEAD` are
accepted (otherwise 405), and cross-origin reads are refused (`Sec-Fetch-Site`
other than `same-origin`/`none` → 403) — a balance is account information and
should not be readable by a cross-site page even when the server is bound to
loopback.

### UI mount point

`settings.models.provider-card` with `key = 'llm-deepseek'`. The owner prop
`keyConfigured` decides whether a request is made at all: with no key
configured the card shows a hint instead of fetching.

## Model dropdown availability (only what works)

The composer's model dropdown lists **every configured provider** regardless of whether it can
actually be called: an expired key, an empty balance, or a gateway returning 401 all still show up
and only fail once you pick them. This plugin hides providers that are **confirmed unusable**:

Criteria are evidence-only (fail-open — anything inconclusive is kept; hiding a working model is
worse than showing a broken one):

| Signal | Hides when |
|---|---|
| Credential | the variable named by `apiKeyEnv` resolves nowhere (neither the credential store nor the environment) |
| Probe | the gateway answers the catalog endpoint with `401`/`403`/`402` |
| Balance | DeepSeek `/user/balance` reports `is_available=false` or a zero balance; a MiniMax/Zhipu quota is provably exhausted |
| Runtime | a real request failed with `INVALID_CREDENTIAL` / `QUOTA_EXCEEDED` (via `agent/request-error`) |

**Recovery is automatic**: after you fix the key or top up, `settings/document-updated` invalidates
the cache and the next read re-probes; a successful real request also clears the runtime mark at once.
The **"Re-check all"** button at the bottom of Settings → Models forces a full re-probe.

**Hidden providers do not disappear**: their cards stay in Settings → Models; the card just grows a
red "hidden from dropdown" chip in its action row (the reason lives in its tooltip). The footer carries
the global count and the **"Re-check all"** action. There is deliberately no separate panel restating
each provider — the cards already show their own state, so that would only be duplication.

![The "hidden from dropdown" chip on the ModelGo card, and the footer's "hidden 1 · Re-check all"](https://img.webkubor.online/oss/dsh-llm-hub/v060/availability.png)

### How it works, and the trade-off

Filtering happens in the **host half, on `ctx.llm.listProviders()`** — the only seam that covers every
consumer at once (composer dropdown, `/model` popup, subagent picker, ACP), and it is subtractive and
reverted when the plugin unloads. The settings page reads the configurable-provider directory
(`listConfigurableProviders`) instead, so it is unaffected.

Wrapping `ctx.modelDirectories` in the client half was tried and **fails**: it is a cordis
inject-tracking proxy whose methods come back as traceable proxies, so a plugin fiber without the
`remote.session` inject throws `cannot get property "remote.session" without inject` — measured on
2026-09-16, it crashes the shipped model seat right out of the composer. The contract marks
`conversation.input.model` as a single slot with `replaceRisk: shadows-shipped-ui`; taking it over
means re-implementing the whole menu and tracking upstream forever, which is not worth it.

One more counter-intuitive trap: **judging must be driven by the settings section, never by
`listProviders()`** — the latter is the filter's own output, so treating it as the target means a
hidden provider never enters the next probe round: hidden forever. Likewise, a cordis service method
**cannot** be verified with `!==` (every access through a traceable proxy yields a new object); check
the property descriptor instead.

## External harness subagents (they appear only if installed)

Registers the external agent CLIs **already installed on this machine** as DSH
subagent providers, so a session can hand a self-contained task to one of them —
each billed against its own subscription:

| Tool | Requires | Actually runs |
|---|---|---|
| `subagent_codex` | `codex` | `codex exec --skip-git-repo-check <task>` |
| `subagent_claude_code` | `claude` | `claude -p <task>` |
| `subagent_antigravity` | `agy` | `agy -p <task> --dangerously-skip-permissions` |

**What isn't installed doesn't show up.** A provider is registered only when its
executable actually resolves, and `dsh-tool-subagent` logs a single info line for
a missing provider while deferring the tool row until that provider appears. On a
machine without codex, `subagent_codex` never enters the tool catalog and the host
still starts normally — no switch, no configuration.

Detection goes through `ctx.subprocess.resolveExecutable` (the kernel's own
resolver, sharing the PATH view the child process will actually get) rather than
scanning PATH by hand: a login-shell alias fools `command -v` (`agy` is commonly
aliased with `--dangerously-skip-permissions`), and a launchd-started host never
reads `.zshrc` at all.

### Pinned edge cases

- **`agy` must carry `--dangerously-skip-permissions`**: in headless print mode it
  auto-denies the `command` permission, so any task touching files or commands
  exits 0 with **no output** — no error, the subagent just "succeeds" having done
  nothing.
- **Exit 0 with empty output always fails**, never folds to `completed` (otherwise
  the parent agent proceeds on an empty answer).
- **`codex` carries `--skip-git-repo-check`**: the parent cwd is not necessarily a
  git repository, and without the flag codex refuses to run.
- **Only an 8 KiB stderr tail is kept**: agy's glog bridge emits 300+ lines when its
  log directory is not writable.
- The child **does not inherit parent context** and advertises no start-time
  capabilities (persona, tool filter, depth cap, structured output cannot be
  enforced inside another runtime), so the kernel rejects requests needing them up
  front instead of silently ignoring them.

### Coexisting with the official bundles and preset rows

- The official `@deepseek-ai/dsh-subagent-codex` / `-claude-code` register providers
  under the same names (`codex` / `claude-code`). **First one wins**: this plugin logs
  one info line, skips, and keeps registering the rest. Remove those bundles from the
  profile to let this plugin provide all three.
- ⚠️ If you hand-added rows like `tool-subagent-codex` in
  `~/.dsh/.agent-presets/*/agent.cordis.yml`, **delete them** — the same `toolName`
  cannot be registered twice.

### Why kernel symbols are imported dynamically

`@deepseek-ai/dsh-subagent` / `-session` are supplied by the host (resolved through
`.dsh-module-fallback` inside a profile) and **cannot be resolved from the repository**.
A top-level static import would fail both ways: `MODULE_NOT_FOUND` when running the
repo's tests, and — should a host version ever drop one of those exports — a plugin
that fails to load entirely, taking balance and model discovery down with it. Lazy
loading confines that risk to this feature. Detection and registration never touch a
kernel import at all: the empty capability advertisement is inlined.

## Known limitation

**Discovery candidates cannot carry `inputModalities`.** The llm service keeps
only `id`/`name`/`contextWindow`/`maxTokens`. So a `deepseek-flash` added
through the button lands as a **text-only** entry, while it actually accepts
image input. Patch it by hand afterwards:

```yaml
llm-deepseek:
  models:
    - id: deepseek-flash
      inputModalities: [ text, image ]
```

This is a limit of the harness's discovery contract itself (the official pi-ai
route has it too); no plugin can fix it.

## Development

```sh
npm run check     # syntax of both halves
npm test          # regression tests (node:test, zero dependencies)
npm run deploy    # sync into the web profile
```

Tests live in `test/` and use only `node:test` + `node:assert`; CI runs them. Each case pins a
**bug that was actually hit** — the availability chain (credential → probe → balance → runtime)
is long, and degrading any link produces no compile error: it just silently hides a working model
or leaves a broken one in the dropdown.

### Releasing

Pushing a `v*` tag triggers `.github/workflows/publish.yml`: it re-runs syntax + regression
tests + the publish-artifact check **before** publishing (rather than trusting that some earlier
CI run passed), then `npm publish`, then creates the GitHub Release from the matching CHANGELOG
section when one is missing. Requires an `NPM_TOKEN` repository secret.

A missed or failed publish can be retried without re-pushing the tag:

```sh
gh workflow run publish.yml -f tag=v0.7.0
```

Idempotency comes from two checks — the tag must match `package.json`'s version, and an
already-published version is skipped. Release existence is probed separately, so "npm succeeded
but no Release was created" is recoverable by re-running.

- **Host half** `lib/index.js`: ESM (the cordis loader reads it as ESM).
- **Client half** `lib/client.js`: **source is the artifact**, a classic script
  (no top-level `import`/`export`) registered through
  `window.__ModuleLoader__.load({ id, factory })`. Its `id` **must exactly equal
  package.json's `name`**, or DSH refuses the registration. React arrives via
  `factory(require)` and is never bundled into the artifact. At the current size
  no build step is warranted; if it ever splits into several files, add esbuild
  (`format: 'iife'`, with React and friends marked external).

## License

MIT
