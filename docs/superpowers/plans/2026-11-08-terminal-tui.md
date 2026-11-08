# Terminal TUI implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.
> Steps use checkbox (`- [ ]`) syntax. Implement in order; each task ends green.

**Goal:** ship blank 1.5.0 with a full-screen terminal UI and a plain fallback.

**Architecture:** pure modules for width, keys, composer editing, transcript
rendering, screen diffing and app state; one runtime extracted from `bin/blank.js`
that both interfaces share.

**Tech stack:** Node built-ins (`readline`, `tty`, `string_decoder`), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-08-terminal-tui-design.md`

## Global constraints

- No new runtime dependency, no build step, no bundler.
- Every TUI exit path restores alternate screen, cursor and raw mode.
- Existing `blank run`, non-TTY output and plain REPL behavior stay unchanged.
- Copy is English in source; no Turkish-i style casing traps in key names.
- Do not log or render provider keys; approvals keep deny-by-default.

---

### Task 1: Display width

**Files:** create `src/cli/tui/width.js`, `test/tui-width.test.js`

- [ ] Tests first: ASCII width, CJK (가, 漢) width 2, emoji width 2, combining
      mark 0, stripAnsi, wrap at width preserving words and explicit newlines,
      wrap long unbroken token, truncate with ellipsis and ANSI stripping.
- [ ] Implement `stripAnsi`, `charWidth`, `displayWidth`, `wrapPlain`, `truncate`.
- [ ] Run `node --test test/tui-width.test.js` → green.

### Task 2: Key parser

**Files:** create `src/cli/tui/keys.js`, `test/tui-keys.test.js`

- [ ] Tests first: printable text, Enter `\r`, Alt+Enter `\x1b\r`, Ctrl+J `\n`,
      backspace, tab, Shift+Tab, arrows, Home/End, Delete, PgUp/PgDn, Ctrl+A/C/D/L/O/P,
      Alt+letter, bracketed paste, split escape sequence across chunks,
      lone Esc resolved on flush.
- [ ] Implement `createKeyParser({escapeDelay})` with `feed(chunk)` and `flush()`;
      events are `{name, alt, ctrl, shift, text}`.
- [ ] Run tests → green.

### Task 3: Composer

**Files:** create `src/cli/tui/composer.js`, `test/tui-composer.test.js`

- [ ] Tests first: insert at cursor, newline, backspace across newline, delete,
      left/right/home/end, surrogate pair movement, clear, history push/prev/next
      (only from empty draft), completion filtering via `completeLine`.
- [ ] Implement pure functions/state transitions; no terminal I/O.
- [ ] Run tests → green.

### Task 4: Theme and transcript

**Files:** create `src/cli/tui/theme.js`, `src/cli/tui/transcript.js`,
`test/tui-transcript.test.js`

- [ ] Tests first: inline code/bold/italic, headline and bullets, fenced code
      without wrapping, link reduction, streaming-unclosed fence, tool row
      states, reasoning visibility, CJK wrapping at 20 and 40 columns.
- [ ] Implement `createTheme({color})` and `renderTranscript(blocks, {width, verbose})`
      returning styled line spans.
- [ ] Run tests → green.

### Task 5: Screen diff and lifecycle

**Files:** create `src/cli/tui/screen.js`, `test/tui-screen.test.js`

- [ ] Tests first: identical frames produce no writes, one changed row repaints
      only that row, resize forces full repaint, start/stop emit alt-screen
      enable/disable and cursor show/hide exactly once.
- [ ] Implement `changedRows`, `createScreen({input, output, color})` with
      `start`, `stop`, `render(lines, cursor)`, `size`.
- [ ] Run tests → green.

### Task 6: App state machine

**Files:** create `src/cli/tui/app.js` (state part), `test/tui-app.test.js`

- [ ] Tests first: follow mode pauses on PgUp and resumes on End, new-lines
      counter, approval keys map to allow/always/deny, palette selection,
      composer growth capped at 8 rows, running status transitions.
- [ ] Implement `createState`, `reduce(key, state)`, `layout(state, size)`.
- [ ] Run tests → green.

### Task 7: Runtime extraction

**Files:** create `src/cli/runtime.js`, `src/cli/plain.js`; modify `bin/blank.js`;
`test/cli-runtime.test.js`

- [ ] Move session loading, slash command switch and run driver out of `bin/blank.js`
      behind `{print, askApproval, onLifecycle}`.
- [ ] Keep every current slash command and its copy.
- [ ] Spawn the CLI with `BLANK_HOME` in a temp dir, piped stdin and `--plain`
      for `/help`, `/mode`, `/config`; assert exit code 0 and expected text.
- [ ] Run full suite → green; `blank --help`, `blank models` output unchanged.

### Task 8: TUI wiring

**Files:** create/extend `src/cli/tui/app.js`; modify `bin/blank.js`

- [ ] Stream `runAgent` events into blocks, spinner, throttled render.
- [ ] Slash popup, session and model pickers, approval overlay.
- [ ] Ctrl+C / Esc / Ctrl+D / SIGTERM clean exit; restore terminal.
- [ ] `--plain` and non-TTY keep the old REPL.
- [ ] Fake-TTY snapshot test for one idle and one streaming frame.

### Task 9: Docs, version, release

- [ ] README terminal section: TUI keys, VS Code note, `--plain` fallback.
- [ ] Version 1.5.0 in package.json, package-lock, docs config/fallbacks and
      cache-buster.
- [ ] `npm test` 0 failures, `node --check` on changed files.
- [ ] Build Windows installer (temp output, unsigned), copy into `dist/`.
- [ ] Commit, tag `v1.5.0`, push, monitor workflows, verify release assets and
      live site with a cold query string.
