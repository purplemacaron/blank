# Blank

A quiet, local-first agent harness for your desktop. White by default, blue accent, keyboard friendly, and built to span chat, code, tools, media, Paper, and remote control — not just one of them.

[Download Blank](https://purplemacaron.github.io/blank/) · [Source](https://github.com/purplemacaron/blank) · [Releases](https://github.com/purplemacaron/blank/releases)

```
npm install
npm start
```

The first launch opens on the sandbox model, so the app works before any key is configured.

## What it does

**Agent loop**
Streaming responses, tool calls with per-tool approvals, a live plan rail, checkpoints, automatic context compaction, fallback models, subagents, skills, durable memory, and opt-in self-improvement notes after runs.

**Models and providers**
- Built in: Anthropic, OpenAI, Google, OpenRouter, xAI, DeepSeek, Mistral, Groq, Together, Cerebras, Ollama, LM Studio, plus the offline Blank sandbox.
- Any OpenAI-, Anthropic-, or Gemini-compatible endpoint can be added with a base URL, protocol, and model list. One-click presets cover LiteLLM, vLLM, LocalAI, Open WebUI, and Jan.
- Several API keys per provider, with labels, an active key, automatic rotation on 401/402/403/429, masked previews, and environment fallbacks (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …).
- Probe an endpoint to fetch its model list, and choose a fallback model used when the primary errors or rate-limits.

**Tools**
Workspace-scoped read/write/edit, glob, grep, shell commands, web fetch, configurable web search (DuckDuckGo, Brave, Tavily, Exa, Serper, SearXNG), todo plans, memory, media, MCP, and computer use.

**SSH over MCP**
SSH is a built-in MCP server. Add hosts in **MCP → SSH** with sealed passwords or private keys, pin the host key fingerprint on first connect, and let the agent run approval-gated commands through `ssh_run`. Secrets stay on this device.

**Agent team (MAS)**
Enable a small team of read-only specialists — Scout, Architect and Critic by default — with per-member models and roles. `team_delegate` fans a brief out in parallel and returns the reports to the main agent. Configure it in **Settings → Agent team**.

**Language**
The interface ships in Korean and English. Switch in **Settings → General → Interface language**; the choice persists and reloads the window.

**MCP and plugins**
stdio and HTTP MCP servers with namespaced tools (`mcp__server__tool`). HTTP servers can sign in with OAuth; tokens are stored user-only and never shown. The Plugins page installs curated servers and skills in one click — filesystem, GitHub, Playwright, Context7, accessibility and performance audits — and MCP servers can start with the app. Anthropic and OpenAI provider cards also offer experimental subscription sign-in alongside API keys.

**Computer use**
Screenshot capture plus native mouse and keyboard input. A transparent, click-through overlay draws the cursor so you can see what the agent is doing. Every action goes through the normal approval policy.

**Remote control**
An opt-in authenticated web app served from the desktop app. Each start issues a fresh pairing token, binds to loopback unless you allow LAN access, rate-limits requests, and can optionally accept approvals from your phone. Find it in **Settings → Remote**.

**Media studio**
Generate and edit images, video, audio, and 3D models. Audio includes speech synthesis through installed system voices (Windows SAPI, macOS `say`, Linux espeak) with voice and rate controls. Generation runs through engines you connect: your own ComfyUI HTTP server, OpenAI Images, Google Imagen/Veo, Stability, ElevenLabs, Replicate, fal, or Higgsfield. Every engine is gated by its saved key and exposes only the models it supports. Local sharp/ffmpeg tools trim, resize, and convert assets without pretending to be AI engines. Assets live in a local library with favorites, import/export, and a 3D viewer.

**Paper**
Agent-created pages, documents, graphics and code live in a local Paper library. `create_paper` and `update_paper` write versioned files under `~/.blank/papers`; chat shows a Paper card that opens the result. The viewer switches between Preview and Code and between desktop, tablet and phone widths. HTML and SVG render through a dedicated `blank-paper` protocol inside a sandboxed frame without same-origin access, so a page cannot reach the app or its data.

**Schedules and notifications**
Run a prompt on an hourly, daily or weekday timer from **Settings → Schedules**; each run becomes a normal session. Native desktop notifications report finished runs, pending approvals and scheduled results while the window is in the background, with per-category switches and a test action in **Settings → Notifications**.

**Send while responding**
Press send during a run and the message is queued in the composer tray. The queue drains automatically when the current run finishes; individual queued messages can be removed first.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Launch the desktop app |
| `npm run dev` | Launch with developer tooling |
| `npm run cli` | Use Blank from a terminal (`bin/blank.js`) |
| `npm run preview` | Serve the renderer with mock data at `http://127.0.0.1:4173` |
| `npm test` | Run the Node test suite |
| `npm run dist` | Build an installer with electron-builder (NSIS, DMG, AppImage) |

Visual QA can be run with `npx electron scripts/qa-screenshots.js`; it writes screenshots of every page to `qa/`.

## Install site (GitHub Pages)

The live site is [purplemacaron.github.io/blank](https://purplemacaron.github.io/blank/). `docs/` is a dependency-free static download page. At runtime it reads the latest GitHub Release, detects the visitor's OS and architecture, and points the primary button at the matching installer. Opening `docs/index.html?demo=1` previews it with a simulated release; without a configured repository it shows a neutral "downloads not configured" state.

Publishing is automated:

1. Push to `main`. The **Deploy install site** workflow injects the repository name into `docs/config.js` and deploys `docs/` to Pages. Pages must be set to **GitHub Actions** under **Settings → Pages** once.
2. Create a release to attach installers. The **Build installers** workflow builds Windows, macOS and Linux packages and uploads them to the GitHub Release:

   ```sh
   git tag v1.1.4
   git push origin v1.1.4
   ```

The site reads `https://api.github.com/repos/<owner>/<repo>/releases/latest`, so it updates as soon as a release is published. For local checks, serve `docs/` over HTTP with any static file server, or run `npx electron scripts/qa-site.js` to capture desktop and mobile screenshots in `qa/`.

## Where data lives

Everything is plain files under `~/.blank`:

```
config.json      providers, keys, permissions, agent settings
sessions/        conversation transcripts and checkpoints
memory.json      durable memories
skills/          user skills (SKILL.md)
media/           generated and imported assets
papers/          Paper pages, documents, graphics and code
schedules.json   timer definitions and last run state
logs/            runtime logs
```

Set `BLANK_HOME` to use a different folder. Keys are stored locally in `config.json`; requests go directly from this machine to the provider you choose.

## Project layout

```
electron/        main process, preload, IPC, cursor overlay
renderer/        Chromium UI (classic scripts, no build step)
  js/            app shell, chat, views, components, mock API
src/core/        agent loop, providers, tools, config, MCP, paper,
                 schedules, OAuth, search, plugins, remote, media engines
bin/             terminal client
examples/        MCP echo server used in the MCP examples
assets/          app icon assets
docs/            GitHub Pages download site
.github/         Pages deployment and installer release workflows
test/            Node unit tests
scripts/         preview server and visual QA harness
```

## Notes

- The browser preview uses `renderer/js/mock.js` — it is a UI sandbox, not a second backend.
- Local providers (Ollama, LM Studio) need their runtime running; local providers otherwise appear ready because they require no key.
- Computer use needs OS-level input access. Review the approval matrix before granting `computer_use` broad permissions.
- Remote control is off by default. Keep LAN access off on untrusted networks and stop remote control when you are done.
