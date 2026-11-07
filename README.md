<p align="center">
  <a href="https://purplemacaron.github.io/blank/">
    <img src="docs/media/readme-hero.png" alt="blank — a quiet, local-first agent harness for your desktop" width="100%">
  </a>
</p>

<p align="center">
  <a href="https://github.com/purplemacaron/blank/releases/latest"><img src="https://img.shields.io/github/v/release/purplemacaron/blank?style=flat-square&color=2f6bff&label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/purplemacaron/blank?style=flat-square&color=2f6bff" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-2f6bff?style=flat-square" alt="Windows, macOS and Linux">
  <img src="https://img.shields.io/badge/Electron-45-2f6bff?style=flat-square&logo=electron&logoColor=white" alt="Electron 45">
  <a href="https://purplemacaron.github.io/blank/"><img src="https://img.shields.io/badge/site-purplemacaron.github.io-2f6bff?style=flat-square" alt="Download site"></a>
</p>

<p align="center">
  <a href="https://purplemacaron.github.io/blank/"><strong>Download blank</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/purplemacaron/blank/releases">Releases</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/purplemacaron/blank">Source</a>
</p>

A quiet, local-first agent harness for your desktop. White by default, blue accent, keyboard friendly, and built to span chat, code, tools, media, Paper, and remote control — not just one of them.

```
npm install
npm start
```

The first launch walks through connecting a provider and choosing a model. Nothing is sent until you add a key or start a local runtime.

<p align="center">
  <a href="docs/media/readme-chat.png"><img src="docs/media/readme-chat.png" alt="blank chat with a live plan rail, tool runs and delivered file cards" width="100%"></a>
  <br>
  <sub>Chat, live plans, tool runs and file cards — in English or Korean.</sub>
</p>

## What it does

**Agent loop**
Streaming responses, tool calls with per-tool approvals, a live plan rail, checkpoints, automatic context compaction, fallback models, subagents, skills, durable memory, and opt-in self-improvement notes after runs.

**Models and providers**
- Built in: Anthropic, OpenAI, Google, OpenRouter, xAI, DeepSeek, Mistral, Groq, Together, Cerebras, Ollama and LM Studio.
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
The interface ships in Korean and English and follows your system language by default. Pick **Auto (system)**, **한국어** or **English** in **Settings → General → Interface language**; an explicit choice persists, and switching reloads the window.

**MCP and plugins**
stdio and HTTP MCP servers with namespaced tools (`mcp__server__tool`). HTTP servers can sign in with OAuth; tokens are stored user-only and never shown. The Plugins page installs curated servers and skills in one click — filesystem, GitHub, Playwright, Context7, accessibility and performance audits — and MCP servers can start with the app.

**Computer use**
Screenshot capture plus native mouse and keyboard input. A transparent, click-through overlay draws the cursor so you can see what the agent is doing. Every action goes through the normal approval policy.

**Remote control**
An opt-in authenticated web app served from the desktop app. Each start issues a fresh pairing token, binds to loopback unless you allow LAN access, rate-limits requests, and can optionally accept approvals from your phone. Find it in **Settings → Remote**.

**Media in chat**
Open the media button in the chat composer (or `/media`) to generate and edit images, video, audio, and 3D models without leaving the conversation. Audio includes speech synthesis through installed system voices (Windows SAPI, macOS `say`, Linux espeak) with voice and rate controls. Generation runs through engines you connect: your own ComfyUI HTTP server, OpenAI Images, Google Imagen/Veo, Stability, ElevenLabs, Replicate, fal, or Higgsfield. Every engine is gated by its saved key and exposes only the models it supports. Local sharp/ffmpeg tools trim, resize, and convert assets without pretending to be AI engines. Assets live in a local library with favorites, import/export, and a 3D viewer.

**Paper**
Agent-created pages, documents, graphics and code live in a local Paper library. `create_paper` and `update_paper` write versioned files under `~/.blank/papers`; chat shows a Paper card that opens the result. The viewer switches between Preview and Code and between desktop, tablet and phone widths. HTML and SVG render through a dedicated `blank-paper` protocol inside a sandboxed frame without same-origin access, so a page cannot reach the app or its data.

**Schedules and notifications**
Run a prompt on an hourly, daily or weekday timer from **Settings → Schedules**; each run becomes a normal session. Native desktop notifications report finished runs, pending approvals and scheduled results while the window is in the background, with per-category switches and a test action in **Settings → Notifications**.

**Send while responding**
Press send during a run and the message is queued in the composer tray. The queue drains automatically when the current run finishes; individual queued messages can be removed first. Press **Ctrl+Enter** (⌘+Enter on macOS) to stop the current run instead and send that message next, ahead of anything already queued.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Launch the desktop app |
| `npm run dev` | Launch with developer tooling |
| `npm run cli` | Use blank from a terminal (`bin/blank.js`) |
| `npm test` | Run the Node test suite |
| `npm run dist` | Build an installer with electron-builder (NSIS, DMG, AppImage) |

### Terminal

The terminal client shares providers, configuration and sessions with the desktop app.

```sh
node bin/blank.js                 # interactive session
node bin/blank.js -c              # continue the latest session in this folder
node bin/blank.js run "..."       # one-shot task
git diff | node bin/blank.js run -  # prompt from stdin
```

Inside a session, `/sessions` lists recent conversations, `/resume <n|id>` switches to one, and `/rename <title>` names the current session. Tab completes commands, `/model` and `/mode`. Sessions started in the app resume in the terminal and the other way around.

## Install site (GitHub Pages)

The live site is [purplemacaron.github.io/blank](https://purplemacaron.github.io/blank/). `docs/` is a dependency-free static download page. At runtime it reads the latest GitHub Release, detects the visitor's OS and architecture, and points the primary button at the matching installer. Without a configured repository it shows a neutral "downloads not configured" state.

Publishing is automated:

1. Push to `main`. The **Deploy install site** workflow injects the repository name into `docs/config.js` and deploys `docs/` to Pages. Pages must be set to **GitHub Actions** under **Settings → Pages** once.
2. Create a release to attach installers. The **Build installers** workflow builds Windows, macOS and Linux packages and uploads them to the GitHub Release:

   ```sh
   git tag v1.1.5
   git push origin v1.1.5
   ```

The site reads `https://api.github.com/repos/<owner>/<repo>/releases/latest`, so it updates as soon as a release is published. For local checks, serve `docs/` over HTTP with any static file server, or run `npx electron scripts/qa-site.js` to capture desktop and mobile screenshots in `qa/`.

## Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/). Windows release installers are built by this repository's GitHub Actions workflow and signed after manual approval. The signature links the installer to the public source repository.

- Committers and reviewers: [@purplemacaron](https://github.com/purplemacaron)
- Approvers: [@purplemacaron](https://github.com/purplemacaron)
- Privacy policy: [docs/privacy.html](docs/privacy.html)
- Site policy: [purplemacaron.github.io/blank/terms.html#code-signing](https://purplemacaron.github.io/blank/terms.html#code-signing)

The same policy appears in the site footer and the Terms page. Only artifacts built from this repository are signed; third-party components bundled with blank are not signed by this certificate.

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
  js/            app shell, chat, views, components, API bridge
src/core/        agent loop, providers, tools, config, MCP, paper,
                 schedules, OAuth, search, plugins, remote, media engines
src/cli/         terminal argument, session and completion helpers
bin/             terminal client
examples/        MCP echo server used in the MCP examples
assets/          app icon assets
docs/            GitHub Pages download site
.github/         Pages deployment and installer release workflows
test/            Node unit tests
scripts/         site QA harness
```

## Notes

- There is no demo backend or preview model. The desktop app talks to the providers you connect.
- Local providers (Ollama, LM Studio) need their runtime running; local providers otherwise appear ready because they require no key.
- Computer use needs OS-level input access. Review the approval matrix before granting `computer_use` broad permissions.
- Remote control is off by default. Keep LAN access off on untrusted networks and stop remote control when you are done.

## License

MIT. See [LICENSE](LICENSE).
