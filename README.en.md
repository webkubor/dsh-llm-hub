<p align="center">
  <img src="https://img.webkubor.online/oss/dsh-llm-hub/banner.png" alt="dsh-llm-hub" width="100%" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-llm-hub"><img src="https://img.shields.io/npm/v/dsh-llm-hub?style=flat-square&color=4C7EF3&label=npm" alt="npm" /></a>
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

## Install

```sh
cd ~/.dsh/profiles/web && npm i dsh-llm-hub
```

Add `dsh-llm-hub` to `dsh.profile.bundles` in that same `package.json`, then run `~/.dsh/restart.sh`.
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

## Install

```sh
# 1) Deploy into the web profile's node_modules
npm run deploy

# 2) Wire it into the boot graph (once): in ~/.dsh/profiles/web/package.json
#      dependencies        += "dsh-llm-hub": "file:<path to this repo>"
#      dsh.profile.bundles += "dsh-llm-hub"
#    This package's cordis.patch.yml is inserted automatically via the bundle
#    mechanism, so no hand-written row is needed.

# 3) Restart (the boot graph changed, so a restart is required)
~/.dsh/restart.sh
```

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
npm run deploy    # sync into the web profile
```

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
