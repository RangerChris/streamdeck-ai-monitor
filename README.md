# AI Monitor — Stream Deck plugin

Stream Deck Neo plugin that keeps your AI usage visible at a glance.

## Actions

| Action | Where | What it shows |
|---|---|---|
| Ollama Usage Info Bar | Neo info bar | Ollama session and weekly usage as live progress bars |
| Ollama Balance | Key | Ollama usage as a ring gauge, colored green → amber → red at configurable thresholds |
| Claude Tokens Today | Key | Local Claude Code token usage (input + output) for today, ring = today's share of the rolling week |
| Live Claude Sessions | Key | Busy/live Claude Code sessions on this machine |
| Current Model | Key | Most recently active session's model and context-window fill |
| Tree | Key | A tree that grows as you burn AI tokens; press to pick it as the recipient |

## Setup

1. `npm install`
2. `npm run build`
3. Install into Stream Deck: `npx streamdeck link com.segment7.aimonitor.sdPlugin`
4. For the Ollama actions, create an API key at [ollama.com/settings/keys](https://ollama.com/settings/keys) and set it outside the plugin:
   ```powershell
   setx OLLAMA_API_KEY "<your-key>"
   ```
   Then restart the Stream Deck app so the plugin inherits the variable. The key is never stored or logged by the plugin.

## Develop

- `npm run watch` — rebuild + restart the plugin on every change
- `npm test` — vitest suite
- `npx streamdeck restart com.segment7.aimonitor` — manual reload

## How it works

- Ollama numbers come from the documented cloud API (`/api/balance`, `/api/show`), polled far inside its 10 req/min limit with `Retry-After` backoff.
- Claude numbers are computed locally from the JSONL transcripts and the sessions registry under `%USERPROFILE%\.claude` — nothing is sent anywhere.
- Context-window fill resolves per model: Property Inspector override → the harness's enforced budget (`CLAUDE_CODE_MAX_CONTEXT_TOKENS` in `~\.claude\settings.json`) → ollama.com's model registry → a built-in table.
- Key art is generated at runtime as SVG (`data:image/svg+xml;base64` URIs — Stream Deck app 7.6 ignores raw SVG strings in `setImage`).
- The Grove grows from two feeds: today's Claude transcript tokens (delta-scan each poll, reset-proofed against the local-midnight rollover) and Ollama cloud usage deltas (tracked per hourly bucket, so the 24h window sliding doesn't double-count). The last pressed tree takes the tokens first; when it's full grown, a random young tree gets them.