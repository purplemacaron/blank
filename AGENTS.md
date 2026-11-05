# AGENTS.md

Guidance for coding agents working in this repository. blank reads this file automatically at the start of every run.

## What blank is

blank is a quiet, local-first desktop agent harness. It is an Electron app with a sandboxed renderer, a terminal CLI, and a static download site on GitHub Pages. The product promise is restraint: real providers and tools, local files, no accounts, no demo responses.

- Electron 45, CommonJS in the main process, classic IIFEs in the renderer. No bundler.
- White surfaces, hairline borders, one blue accent, Korean by default with an English switch.
- Sessions, configuration, media and papers live under `~/.blank` (`BLANK_HOME` moves it).

## Commands

```sh
npm test                 # node:test suite
npm start                # run the desktop app
npm run dev              # dev mode with DevTools access
node bin/blank.js        # terminal CLI
npm run dist             # electron-builder installer
```

If `electron-builder` fails because a running app locks `dist/`, build to a temporary output directory:

```sh
npx electron-builder --publish never --config.directories.output=C:/Users/<you>/AppData/Local/Temp/blank-dist
```

Site QA uses Electron itself (not plain Node):

```sh
./node_modules/electron/dist/electron.exe scripts/qa-site.js
```

CDP helpers expect a running app with `--remote-debugging-port=9336` (or `CDP_PORT=...`):

```sh
node scripts/cdp-eval.js "expression"
node scripts/cdp-shot.js qa/shot.png
```

## Architecture map

- `electron/main.js` — window lifecycle, protocol handlers, permission policy, single-instance lock.
- `electron/preload.js` — the only bridge exposed to the renderer as `window.API`.
- `electron/ipc.js` — IPC handlers, config validation, run lifecycle, approval queues, remote service wiring.
- `electron/updater.js` — electron-updater feed, background download and quit-to-install flow. Updates come from GitHub releases; the release assets must include `latest.yml` and the NSIS blockmap.
- `src/core/agent.js` — model loop, tool dispatch, subagents, compaction, session persistence.
- `src/core/tools.js` — tool specs, handlers, permission resolution.
- `src/core/approvals.js` — risk classification for important-only confirmations.
- `src/core/config.js` — defaults, `~/.blank/config.json`, key storage and migration.
- `src/core/providers.js` / `catalog.js` — real provider transports and live model discovery.
- `src/core/media/` — media engines, local processing, system-voice speech.
- `src/core/paper.js` — versioned local Paper library.
- `renderer/index.html`, `renderer/js/*.js`, `renderer/styles.css` — the app UI. Scripts are classic, ordered `<script>` files; do not add ESM or a build step.
- `renderer/js/i18n.js` — runtime Korean translation dictionaries and patterns.
- `docs/` — the static site served by GitHub Pages. `docs/config.js` is filled by the Pages workflow.
- `assets/skills/` — bundled skills.
- `test/` — Node test runner tests.

## Data and secrets

- Everything user-owned lives under `~/.blank`: `config.json`, `sessions`, `media`, `papers`, `skills`, `logs`, `checkpoints`.
- Provider keys are stored in `config.json` only. Never print, log, commit or send them to the renderer. The UI may receive masked metadata only.
- MCP OAuth tokens must be written user-only (mode `0600`) and never shown or logged.
- SSH passwords and private-key passphrases are sealed in the main process. Never expose them in UI, logs or tool output.
- The renderer is sandboxed with `contextIsolation`. Keep secrets and privileged filesystem work in the main process.
- Do not read or commit `.env` files, credentials, tokens or local QA artifacts.

## Working agreements

- Read a file before changing it. Keep changes focused on the request; do not refactor unrelated code.
- Preserve the vanilla stack. Do not introduce React, a bundler, Tailwind or runtime dependencies without a clear need.
- Respect the renderer CSP: no inline scripts or style attributes; self-host assets.
- Real providers only. Never add demo models, mock responses, sample keys or placeholder output that looks real.
- UI copy is written in English in the source and translated at runtime. Add new strings to `renderer/js/i18n.js` in Korean and English where relevant. Korean should read naturally, not word-for-word.
- Use existing icon and UI helpers (`Icons`, `UI`, `U`) instead of ad-hoc markup.
- Keep the composer, plan rail, approvals, queue and paper flows working. Verify every page you touch.
- Do not leave test sessions, media or config changes in `~/.blank`. Back up and restore real config when QA needs it.
- Never run destructive git commands, force pushes or history rewrites. Do not commit build output, `qa/`, logs or `node_modules`.

## Verification

- For logic changes: `npm test`.
- For UI changes: run the real app, exercise the flow, and capture a screenshot at 1440 and a narrow width. Check for horizontal overflow and English flashes before the Korean layer loads.
- For installer changes: build, install, launch the installed binary, confirm the version and exercise the changed feature. Verify the CLI reports the same version.
- Do not claim a check passed unless it actually ran. State what remains unverified.

## UI and design conventions

- White background, soft gray insets, `#e6eaf0` hairlines, `#2f6bff` accent, tight letter spacing, quiet motion.
- Reuse the existing spacing and type scale. Avoid gradients, glassmorphism, emoji icons and decorative clutter.
- Keep the chat reading width around 800px and preserve the plan rail.
- Focus states must be visible; controls need labels; motion must respect `prefers-reduced-motion`.
- Any new surface needs a Korean translation and a sensible empty, loading, error and disabled state.

## Known pitfalls

- The Korean i18n layer uses a MutationObserver. Never map a string to itself, and guard title writes against identical values or the renderer can freeze.
- Electron denies permissions by default. Microphone, screen capture and similar capabilities must be explicitly allowed for the app origin.
- A prior installed instance holds the single-instance lock; kill it before launching another build with a new CDP port.
- `electron-builder` can fail on Windows when `dist/win-unpacked` is locked by a running app.
- Never display a real API key after saving it. Show only a masked state and a replace action.

## Release checklist

1. Bump `package.json` and `docs/config.js` to the same version.
2. Run `npm test` and exercise the changed flow in the real app.
3. Build the installer and verify the installed app plus `blank --version`.
4. Commit with a focused message; do not commit secrets or generated output.
5. Tag `vX.Y.Z`, push the tag and `main`.
6. Wait for the installers and Pages workflows; verify the release assets, including `latest.yml` and the NSIS blockmap, and the live site.
7. Report exactly what was verified and link the release and site.
