<p align="center">
  <img src="https://img.webkubor.online/oss/dsh-llm-hub/models-piai-cards.png" alt="dsh-llm-hub — pi-ai gateway probe and catalog" width="88%" />
</p>

<h1 align="center">🔌 dsh-llm-hub</h1>

<p align="center">
  <strong>Tells DSH's Models page what it never knew: is this gateway up, and how many models does it actually serve.</strong>
</p>

<p align="center">
  <sub>Gateway reachability, model discovery and balance — the parts DSH's official LLM adapters leave empty.<br/>
  Zero runtime dependencies · touches no file inside your DSH installation</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-llm-hub"><img src="https://img.shields.io/npm/v/dsh-llm-hub?style=for-the-badge&color=4C7EF3&logo=npm&logoColor=white" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/dsh-llm-hub"><img src="https://img.shields.io/npm/dm/dsh-llm-hub?style=for-the-badge&color=5A9E6F" alt="downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-777777?style=for-the-badge" alt="MIT" /></a>
  <img src="https://img.shields.io/badge/runtime%20deps-0-B4694F?style=for-the-badge" alt="zero deps" />
</p>

<p align="center">
  <a href="README.md">中文</a> · <a href="CHANGELOG.md">Changelog</a>
</p>

## 🏆 Why you need it

DSH already has every mechanism. What's missing is an official adapter using them.
Same Models page, with and without this plugin:

| What you want to know | Official adapter | dsh-llm-hub |
|---|:---:|:---:|
| Which DeepSeek models can I pick | ❌ discovery never registered | ✅ one click, live list |
| How much credit is left | ❌ not exposed | ✅ balance row on the card |
| Is this gateway (e.g. modelgo) up | ❌ protocol not listable, button is a no-op | ✅ measured latency + count |
| How many models does it serve | ❌ invisible | ✅ 71 measured (11 hand-typed) |
| Why can't this provider be probed | ❌ no hint | ✅ says "no baseURL configured" |

## 🔥 Three capabilities

- **🛰️ Gateway reachability** — a persistent row under each provider card: `pi-ai · name · N models · Key ✓`. One click measures latency and live model count, no terminal round-trip
- **📋 Catalog bypass** — gateways speaking `anthropic-messages` cannot be listed by the official discovery; this pulls the full id list and copies it in one go. It does not compete for the discovery slot — it bypasses it
- **💰 Balance at a glance** — DeepSeek's balance and availability right under its card, fetched on mount. Amounts keep the upstream strings verbatim, no float conversion

## ⚡ Quickstart

```sh
cd ~/.dsh/profiles/web && npm i dsh-llm-hub
```

Then wire it into the boot graph — append one entry to `dsh.profile.bundles` in that same `package.json`:

```json
"bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-llm-hub"]
```

```sh
~/.dsh/restart.sh                       # boot graph changed — restart is required
```

Open **Settings → Models**; a new row appears under the provider cards.
`cordis.patch.yml` is inserted automatically by the bundle mechanism.

> Installing from source: see [Install](#install) below.

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
