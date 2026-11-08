# Network proxy policy — design

**Date:** 2026-11-08
**Status:** Proposed — awaiting approval before implementation
**Source:** report from @kokomaru167 (proxy policy request)
**Related:** `2026-11-07-automation-triggers-design.md`, `2026-11-08-terminal-tui-design.md`

## Problem

blank has no proxy layer. Every outbound request uses the global `fetch`
(Node/undici via Electron main) or the global `WebSocket`, both of which:

- ignore the operating system proxy and its exception list,
- ignore PAC / auto-configuration,
- ignore `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`,
- therefore always connect directly, no matter what the environment requires.

`electron-updater` is the only component that follows Chromium's session proxy,
because it uses `net.request` on its own partition. Everything else is direct.

Users in two kinds of environments cannot use blank at all:

1. Networks that require a proxy for every destination, including
   `localhost`, loopback, private ranges and internal hostnames.
2. Networks that forbid any proxy (a local agent, a PAC file, or environment
   variables that route traffic somewhere else) and need a guaranteed direct
   connection.

The report asks for three selectable modes and consistent application to
provider registration/authentication, OAuth token exchange and refresh, model
listing and usage, HTTP/SSE model calls, WebSocket, Cursor HTTP/2, and custom
or local provider connections, including connection tests performed during
registration.

## Goals

1. Three modes, selectable in Settings, persisted in `~/.blank/config.json`:
   - **System** — follow the OS proxy and the OS exception list.
   - **Proxy** — force every request through one proxy; only user-entered
     exceptions connect directly; no implicit loopback/private bypass;
     fail closed.
   - **Direct** — ignore the OS proxy, PAC, and proxy environment variables.
2. Apply the selected mode to every outbound path in the main process and the
   CLI, through one module, with a guard test that prevents future call sites
   from bypassing it.
3. Fail visibly and safely: an invalid Proxy configuration is a configuration
   error, proxy connection failures never fall back to direct, and secrets in
   proxy URLs are never rendered, logged or audited.
4. Keep the vanilla stack: CommonJS, no bundler. Add one pinned runtime
   dependency (`undici`) because its `ProxyAgent` and WebSocket `dispatcher`
   are not reachable through Node's built-ins.

## Non-goals

- Evaluating PAC/WPAD in the CLI. The desktop app delegates to Chromium, which
  does evaluate PAC; the CLI does not ship a JS PAC engine.
- SOCKS upstream proxies. `socks4/5://` is rejected at validation with a
  message pointing to an HTTP proxy. (An HTTP proxy front-end such as the
  mixed port of common local proxy tools is the supported path.)
- Proxy authentication that comes from the OS credential store in **System**
  mode. Credentials are supported only when they are part of a **Proxy** URL.
- Per-provider or per-tool proxy overrides; one policy per installation.
- Changing OS proxy settings, trusting custom roots, or MITM support.
- Routing the renderer, the remote-control page, or inbound servers
  (OAuth loopback listener, messenger webhooks, remote control) through the
  proxy. Those are local surfaces, not egress.

## Terminology

- **Destination** — the origin of an outbound request (`https://api.openai.com`).
- **Proxy URL** — `http://[user:pass@]host:port` or `https://[user:pass@]host:port`.
  The scheme describes the connection to the proxy itself.
- **Exception** — a user-entered destination pattern that connects directly in
  Proxy mode.
- **Resolution** — turning a destination into `direct` or a proxy URL, either
  from the mode's configuration or from the OS.

## Configuration

New top-level object in `~/.blank/config.json`:

```json
{
  "network": {
    "mode": "system",
    "proxy": "",
    "exceptions": []
  }
}
```

Defaults (added to `DEFAULTS` in `src/core/config.js`):

| Field | Default | Rules |
| --- | --- | --- |
| `mode` | `"system"` | one of `system`, `proxy`, `direct` |
| `proxy` | `""` | required when `mode === "proxy"`; `http:` or `https:` URL; optional `user:pass`; no path, query or fragment; port required |
| `exceptions` | `[]` | max 100 entries; each a host pattern (see below); max 253 characters; no scheme, port, path or whitespace |

Deep merge in `loadConfig` supplies the defaults, so no config version bump or
migration is required.

### Validation

Validation lives in `src/core/net-policy.js` as pure functions:

- `normalizeNetwork(input)` — trims, lowercases patterns, deduplicates, drops
  empty entries, and returns the canonical object.
- `validateNetwork(input)` — returns `{ ok, value, error }`; on failure `error`
  is a short English message with a code:
  - `proxy_required` — Proxy mode without a proxy URL.
  - `proxy_invalid` — unparsable URL, unsupported scheme, missing port, or a
    path/query/fragment.
  - `proxy_credentials` — userinfo present but malformed.
  - `exception_invalid` — an exception contains a scheme, port, path, or
    whitespace.
- `maskProxy(proxyUrl)` — replaces the password (and keeps the user name) with
  `***`, e.g. `http://user:***@127.0.0.1:7890`. Used by `publicConfig`,
  `net.describe()`, error messages, logs and audit events.

`electron/ipc.js` adds `network` to the `config:update` allowlist and runs
`validateNetwork`. Invalid input throws before the config is written, so the
renderer can show the message inline and keep the old value. `config:get`
returns the masked proxy URL only. The CLI (`bin/blank.js`) and `src/cli/runtime.js`
warn once at startup if the stored config is invalid, keep running, and let
requests fail with `E_PROXY_CONFIG`; no request is ever sent directly as a
fallback.

### Exception matching

`matchesException(hostname, patterns)`:

| Pattern | Matches |
| --- | --- |
| `example.com` | `example.com` only |
| `.example.com`, `*.example.com` | `example.com` and any subdomain |
| `telemetry.corp` | that exact host |
| `10.0.0.0/8`, `fd00::/8` | any address inside the CIDR |
| `127.0.0.1`, `::1` | that address only |
| `*` | every destination (an explicit "send everything direct") |

Hostnames are compared case-insensitively after stripping a trailing dot and
converting IDN labels to ASCII. IPv6 literals arrive without brackets. A
pattern never matches on suffix alone (`ample.com` does not match
`example.com`).

In Proxy mode this matcher is the *only* bypass: there are no hardcoded
loopback, link-local or private-range exemptions. An empty exception list means
every destination — including `127.0.0.1`, `localhost`, `10.0.0.1` and the
default Ollama/LM Studio ports — goes through the proxy.

## Architecture

One module owns all egress configuration and transport construction:

```
src/core/net.js          configure(), fetch(), createWebSocket(), describe(), reset()
src/core/net-policy.js   normalize / validate / mask / exception matching (pure)
src/core/net-system.js   per-platform system proxy readers (pure parsers + exec)
```

`net.js` holds the active policy and its dispatchers. Every call site imports
`net` and uses `net.fetch` or `net.createWebSocket`. The module exposes:

```js
net.configure(network, { resolveSystemProxy } = {}) // called at startup and on save
net.fetch(url, init)                                // drop-in fetch replacement
net.createWebSocket(url, protocols)                // WebSocket instance for current policy
net.describe()                                     // { mode, proxy (masked), exceptions, status, detail }
net.reset()                                        // tests: close dispatchers, clear state
```

`configure` validates, stores a generation id, builds dispatchers lazily, and
retires the previous generation's dispatchers after 30 seconds so in-flight
streams are not cut. `describe().status` is one of `ok`, `config-error`,
`system-error`, or `system-pac` (CLI only) so the UI and CLI can show the same
state.

`electron/ipc.js` injects the desktop resolver once the app is ready:

```js
net.configure(config.network, {
  resolveSystemProxy: (url) => session.defaultSession.resolveProxy(url),
});
```

and calls `net.configure` again after every successful `config:update` of the
`network` section. The CLI calls `configure` with no resolver, selecting the
platform readers.

### Dispatcher composition

Add `undici@^7.30.1` to `dependencies` (currently only transitive, so it must
be pinned for packaged builds). It provides:
`ProxyAgent`, `Agent`, `Dispatcher`, `WebSocket`, `Socks5ProxyAgent` (not used).

**Direct mode** — `new Agent()`; no resolution, no environment lookup. This is
deliberately an explicit agent, not the process-wide default dispatcher, so a
stray `setGlobalDispatcher` cannot change the mode.

**Proxy mode** — a `PolicyDispatcher extends Dispatcher`:

```js
dispatch(opts, handler) {
  const host = new URL(opts.origin).hostname;
  const target = matchesException(host, exceptions) ? directAgent : proxyAgent;
  return target.dispatch(opts, handler);
}
```

Delegating on `opts.origin` per dispatch (rather than inspecting only the first
URL) keeps redirects honest: a redirect from a proxied host to an exception is
sent directly, and vice versa. `close()`/`destroy()` close both agents.

- A proxy connection failure propagates as-is (wrapped with
  `E_PROXY_CONNECT`, proxy host only, never credentials). There is no retry
  without the proxy anywhere in the module.
- No `RetryAgent`, no auto-fallback, no second attempt.

**System mode** — resolution happens before each request because
`Dispatcher.dispatch` is synchronous:

- Electron: the injected `resolveSystemProxy(url)` calls
  `session.defaultSession.resolveProxy(url)`; results are cached per origin for
  60 seconds and invalidated by `configure`. Values are parsed from Chromium's
  form: `DIRECT`, `PROXY host:port`, `HTTPS host:port`, `SOCKS…`.
  `DIRECT` selects the direct agent; `PROXY`/`HTTPS` build a `ProxyAgent`;
  a SOCKS-only result raises `E_PROXY_SYSTEM` with guidance to use Proxy mode.
- CLI (no Chromium): `src/core/net-system.js` reads the platform source:
  - Windows: `reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings"`
    for `ProxyEnable`, `ProxyServer`, `ProxyOverride`, `AutoConfigURL`.
  - macOS: `scutil --proxy`.
  - Linux: `HTTPS_PROXY`/`http_proxy`/`ALL_PROXY` and `NO_PROXY` variants.
  - Static proxy plus the platform exception list (`ProxyOverride`,
    `ExceptionsList`, `NO_PROXY`) select proxy/direct per destination. The
    reader reports per-scheme proxies; an `https` destination uses the
    `https`/`HTTPSProxy` entry, an `http` destination uses `http`, and
    `ALL_PROXY` is the fallback when a scheme-specific entry is absent.
  - **PAC-only** (auto-config enabled with no static server): raise
    `E_PROXY_SYSTEM` telling the user the CLI cannot evaluate PAC and to use
    Proxy mode. Silent direct is not allowed.
  - Reader failure (registry/scutil error) also raises `E_PROXY_SYSTEM`; the
    user may switch to Direct deliberately.
- Known difference: System mode resolves the initial origin, so a redirect to a
  different host reuses that decision. Chromium may re-resolve per hop for the
  updater; application traffic uses the initial decision. Documented, not a
  silent bypass.

**DNS** — in Proxy and System-proxy cases the destination hostname is sent to
the proxy (`CONNECT` for TLS); blank does not resolve it locally. This matches
how browsers behave and keeps internal names resolvable only at the proxy.

### WebSocket

Node's global WebSocket is undici and ignores proxies. `net.createWebSocket`
returns an `undici.WebSocket` instance built with the current dispatcher:

- Direct: no dispatcher.
- Proxy: `PolicyDispatcher` (exceptions and redirects as above).
- System: resolver runs for the WS origin (`ws`→`http`, `wss`→`https`) before
  connecting, then the chosen dispatcher is passed.

`src/core/messengers.js` keeps its `options.WebSocket` injection (used by
tests) and defaults it to a factory provided by `net`, covering the Discord
gateway (`wss://gateway.discord.gg`) and Slack Socket Mode. The Telegram and
Slack REST calls and the local loopback webhook endpoint route as follows:
REST through the policy, loopback endpoint unaffected (inbound).

### Updater

`electron/updater.js` configures the `electron-updater` partition session
(`session.fromPartition('electron-updater')`) whenever the policy changes and
before `checkForUpdates`:

| Mode | `session.setProxy` options |
| --- | --- |
| System | `{ mode: 'system' }` |
| Direct | `{ mode: 'direct' }` |
| Proxy | `{ proxyRules: <proxy URL without userinfo>, proxyBypassRules: exceptions.join(',') + ',<-loopback>' }` |

`<-loopback>` removes Chromium's implicit loopback bypass, which is required by
"loopback must also use the proxy"; when the list is empty the rule is exactly
`<-loopback>`. In Proxy mode with credentials, an `app.on('login')` handler on
the main process answers proxy challenges for the configured proxy host using
the in-memory credentials (never passed to the renderer). If Electron does not
surface the challenge for updater requests, the update fails with an updater
error; it never downgrades to direct.

### Credentials

- Stored only in `config.json` (`~/.blank`, user-only).
- Never included in `config:get`, Settings state, `net.describe()`, CLI output,
  logs, audit events, error objects, or updater logs.
- `Proxy-Authorization` is only sent to the proxy; undici handles that.
- Errors name the proxy host and port only (`proxy 127.0.0.1:7890`).

## Call-path coverage

The transport is only effective if every call site uses it. The migration:

| Category | File(s) | Notes |
| --- | --- | --- |
| Provider list/test/auth | `src/core/providers.js` (`listModels`, `listModelsAt`), `electron/ipc.js` (`providers:test`) | Registration connection tests use the same layer |
| Chat, SSE, usage | `src/core/providers.js` (openai, anthropic, google, ollama) | Streaming bodies unchanged |
| OAuth exchange/refresh | `src/core/oauth.js` (`fetchJson`) | Loopback listener inbound, untouched; system browser is outside the app |
| Model usage | `src/core/providers.js` (stream `usage` events) | Same requests as chat |
| API request tool | `src/core/apis.js` | |
| MCP | `src/core/mcp.js` (JSON and SSE responses) | |
| Messengers REST | `src/core/messengers.js` (Telegram, Discord, Slack) | |
| Messengers WebSocket | `src/core/messengers.js` (Discord gateway, Slack) | Via `net.createWebSocket` |
| Web fetch search | `src/core/search.js` | |
| Web fetch tool | `src/core/tools.js` | |
| Media cloud/local | `src/core/media/cloud.js`, `src/core/media/comfy.js` | Local ComfyUI is proxied in Proxy mode, as required |
| Dictation | `src/core/dictation.js` | |
| Custom providers | `src/core/providers.js`, `src/core/catalog.js` | Custom base URLs go through the same calls |
| Updates | `electron/updater.js` | Partition session proxy |
| Local files / remote page | `src/core/remote-page.js`, `electron/main.js` `net.fetch(file://)` | Excluded: local surfaces |

Cursor HTTP/2: this codebase has no Cursor transport (no `http2` client and no
Cursor provider). If one is added later, it must route through `net.js` and is
covered by the same guard test.

## Settings UI

New Settings section `#settings-network` with a navigation item
(`data-settings-go="network"`, icon `network`/`globe`) between Web search and
Computer, plus a command-palette entry "Network settings".

Content:

- Three radio cards (`data-network-mode`), each with a one-line description:
  - **Use system proxy** — "Follow your operating system's proxy and exception
    list, including PAC where the app supports it."
  - **Force proxy** — "Send everything through this proxy. Only the exceptions
    below connect directly. Local addresses are proxied too."
  - **Force direct** — "Ignore the OS proxy, PAC, and proxy environment
    variables. Always connect directly."
- Proxy URL input (`type="url"`, placeholder `http://127.0.0.1:7890`), enabled
  only in Proxy mode; masked display when saved, with a Replace action,
  mirroring the provider key pattern (never render a saved secret again).
- Exceptions textarea, one pattern per line, enabled only in Proxy mode.
- Save (`data-save-network`) with inline validation; success toast.
- Status line from `net.describe()`: `System — direct`, `System — proxy
  10.0.0.1:8080`, `Proxy — 127.0.0.1:7890 (2 exceptions)`, or an error
  message for `E_PROXY_CONFIG` / `E_PROXY_SYSTEM`.

Korean strings are added to `renderer/js/i18n.js` in natural Korean, with the
English source in `views.js`. No inline scripts or styles; CSP unchanged.

## CLI

`bin/blank.js` and `src/cli/runtime.js` call `net.configure` immediately after
loading the config, before any provider or messenger initializes. `blank config`
and the TUI `/config` command print the mode and the masked proxy, e.g.
`network     system — direct`. Invalid stored settings print one warning line
and requests fail with `E_PROXY_CONFIG`; the CLI never guesses a mode. No new
command-line flags in this release.

## Testing (TDD)

Each item is written red first.

1. `test/net-policy.test.js`
   - defaults, mode validation, proxy URL validation (scheme, port, path,
     userinfo), exception normalization and rejection, matching table,
     `maskProxy` in `describe()` and error messages.
2. `test/net-fetch.test.js` with a local mock forward proxy
   (`test/helpers/proxy.js`, absolute-form + CONNECT):
   - Proxy mode routes a loopback target through the proxy (proves no implicit
     bypass) and a `10.0.0.5` destination never resolves locally.
   - Exceptions connect directly; the proxy records nothing for them.
   - Redirect from proxied host to an exception uses direct and vice versa.
   - Proxy credentials appear only in `Proxy-Authorization` to the proxy.
   - Dead proxy: fetch rejects with `E_PROXY_CONNECT`, the target server
     receives zero requests (fail-closed).
   - Direct mode ignores `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` and the injected
     system reader entirely.
   - System mode with an injected resolver: DIRECT, PROXY, caching, and
     resolver rejection → `E_PROXY_SYSTEM`.
   - Invalid policy → `E_PROXY_CONFIG`; no socket is opened.
3. `test/net-system.test.js` — fixture strings for Windows `reg query`,
   macOS `scutil --proxy`, Linux environment; PAC-only detection; `<local>`
   and `NO_PROXY` semantics; reader failure.
4. `test/net-websocket.test.js` — WebSocket through a CONNECT proxy using a
   minimal upgrade echo server and handshake in the test; exceptions; direct.
5. `test/net-egress.test.js` — static scan: outside the allowlist
   (`src/core/net.js`, `src/core/net-policy.js`, `src/core/net-system.js`,
   `src/core/remote-page.js`, `electron/main.js` file fetch), no source file
   calls `fetch(` or constructs a raw `WebSocket`.
6. `test/updater-network.test.js` — `updaterProxyOptions(network)` output for
   all three modes, `<-loopback>` present, credentials stripped.
7. Representative end-to-end paths through the mock proxy:
   provider model list/test and SSE chat (`providers.listModelsAt`, streaming),
   OAuth token exchange (`src/core/oauth.js`), one messenger REST call, and the
   WebSocket case above.

Manual QA in the real app:

- Settings at 1440 and a narrow width, Korean; save valid/invalid; masked proxy
  after reload; error line for invalid stored config.
- Provider test and a chat call with the mock proxy in each mode; toggling
  applies without restart.
- CLI `/config`, `/models`, and a chat call with Proxy (mock) and with a dead
  proxy (fails, no direct hit).
- `~/.blank/logs`, audit JSONL and renderer state contain no proxy password.
- Updater proxy options are unit-tested only; end-to-end update download is
  verified on the next release.

## Documentation and release

- `docs/guide.js` gains a "Network" section (three modes, exceptions,
  limitations: PAC in CLI, SOCKS, authenticated system proxies).
- README settings list mentions the network modes.
- Version 1.6.0 (new feature), following the release checklist in `AGENTS.md`.
- Release notes call out the default (`system`) and how to switch to Direct for
  users whose environment variables point at a proxy they do not want to use.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| New default follows environment proxies where blank used to be direct | Release note; Direct is one click; invalid Proxy config never silently direct |
| Proxy credentials leak | Single masking function used by config, UI, errors, logs; tests |
| A future call site bypasses the layer | Egress guard test in CI |
| System proxy is PAC-only in the CLI | Explicit `E_PROXY_SYSTEM` with guidance, no silent direct |
| Authenticated OS proxy unsupported | Documented; Proxy mode accepts credentials in the URL |
| Long-lived SSE streams cut by reconfiguration | Retire old dispatchers after 30 s; new requests use the new generation |
| `<-loopback>` behavior in updater | Unit-tested options; verified on next release download |
| Chromium bypass rules do not support CIDR | App traffic honors CIDR exceptions; the updater keeps proxying an excepted CIDR (conservative, never direct); the Settings description says CIDR applies to app requests |

## Acceptance checklist (maps to the report)

- [ ] Three modes selectable and persisted; Apply immediately.
- [ ] System — OS proxy and OS exceptions followed (desktop incl. PAC).
- [ ] Proxy — everything, including loopback/private/internal, goes through
      the configured proxy; only user exceptions are direct; no hardcoded
      bypass; fail-closed; invalid configuration is a visible configuration
      error.
- [ ] Direct — OS proxy, PAC and proxy environment variables ignored.
- [ ] Applied to provider registration/authentication (including test
      connections), OAuth exchange/refresh, model list/usage, HTTP/SSE calls,
      WebSocket, custom/local providers, and update downloads.
- [ ] Proxy URLs with credentials never appear in UI, logs, audit or errors.
- [ ] `npm test` green, real-app QA passed, CLI verified.
