# Terminal TUI design

**Status:** approved 2026-11-08
**Goal:** give `blank` an OpenCode-class terminal interface that works in Windows
Terminal, PowerShell, Git Bash and the VS Code integrated terminal, without a
bundler or runtime dependency.

## Constraints

- Node built-ins only. No React, no Ink, no blessed, no build step.
- `blank run` and every non-interactive path keep their current output.
- Plain REPL remains available through `--plain`, `NO_TUI=1`, `TERM=dumb`, or a
  non-TTY stdin/stdout.
- Renderer sandbox, key storage and session formats do not change.
- The TUI owns the alternate screen, so it must restore the terminal on every
  exit path, including signals and uncaught errors.

## Runtime selection

`bin/blank.js` picks the interface for the `chat` command:

1. `--plain`, `NO_TUI=1`, `TERM=dumb`, `!stdin.isTTY` or `!stdout.isTTY` → plain REPL.
2. otherwise → TUI.

`--verbose` and `--yes` keep working in both.

## Modules

```
src/cli/runtime.js        sessions, config, slash commands, run driver (no I/O)
src/cli/plain.js          existing readline REPL on top of runtime
src/cli/tui/width.js      display width, wrapping, truncation (CJK, emoji, ANSI)
src/cli/tui/theme.js      style tokens → ANSI, NO_COLOR aware
src/cli/tui/keys.js       raw key parser (escape sequences, ctrl, alt, paste)
src/cli/tui/composer.js   multi-line buffer, cursor, history, completion state
src/cli/tui/transcript.js blocks → styled lines (markdown-lite, tool rows)
src/cli/tui/screen.js     alt screen, raw mode, resize, row-diff paint
src/cli/tui/app.js        layout, state machine, agent events, overlays
```

`runtime.js` is extracted from `bin/blank.js`; the plain REPL and the TUI call it,
so slash commands and session handling exist once.

## Layout

- **Header** — workspace (home shortened to `~`), session title or id, model, mode.
- **Transcript** — scrollable viewport with a viewport offset and follow mode.
  Blocks: user, assistant, reasoning, tool, notice, error, meta.
- **Composer** — fixed, multi-line, grows up to 8 rows, history, slash popup.
- **Footer** — token usage, run state, scroll indicator, key hints.
- Approvals and pickers render as an overlay that replaces the composer area.

Transcript auto-follows new output until the user scrolls up. New output while
detached shows `↓ N new`. End resumes follow.

## Transcript rendering

- User text is prefixed `›`; assistant text labels the first row `blank`.
- Markdown-lite: fenced code blocks (no wrap, dim frame), headings, bullets,
  inline code, bold, italic, links reduced to `text (url)`.
- Tool rows start `◇ name · summary`, then update in place to `✓`/`✕`.
  Ctrl+O toggles the most recent tool output expansion; `--verbose` expands all.
- Reasoning is dim and hidden unless verbose or Ctrl+O.
- Width wrapping is span based so ANSI never breaks CJK alignment.

## Keys

| Key | Action |
| --- | --- |
| Enter | send (or accept palette selection) |
| Alt+Enter, Ctrl+J | newline (Ctrl+J may be captured by VS Code; Alt+Enter is primary) |
| Esc | stop the run, close palette/overlay |
| ↑ / ↓ | history (composer empty) or palette navigation |
| Tab | accept completion |
| PgUp / PgDn | scroll transcript by a page |
| End | return to live output |
| Ctrl+O | expand/collapse tool output |
| Ctrl+L | clear transcript |
| Ctrl+P | command palette |
| Ctrl+C | stop run → clear composer → exit |
| Ctrl+D | exit |
| y / a / n | approval: allow once / always / deny (Esc denies) |

## Screen

- Uses `?1049h` alternate screen, bracketed paste, hidden cursor, and restores
  all three on stop.
- Repaints only changed rows; full repaint on resize or width change.
- Streaming repaints are throttled to ~30 ms; a spinner advances while running.
- Resize is handled through `SIGWINCH` where available and polled size on paint.
- Any VT-unsupported terminal falls back to `--plain` guidance instead of garbage.

## Errors and safety

- Uncaught exceptions and SIGINT/SIGTERM call `screen.stop()` before exit.
- Approval prompts always show the tool, reason and args summary; default is deny.
- No tool can bypass the existing approval policy through the TUI.
- Ctrl+C never loses the composer text; it clears only after interrupting a run.

## Testing

Unit tests (`node --test`):

- width: CJK/emoji width, ANSI stripping, wrap, truncate
- keys: arrows, Home/End/Delete, PgUp/PgDn, Alt+Enter, Ctrl codes, paste, split chunks
- composer: insert, newline, backspace/delete, home/end, history, completion
- transcript: markdown-lite, tool rows, wrapping, expansion
- screen: row diff, resize full paint, stop restores terminal
- app: state transitions (follow/scroll, approval keys, palette, run status)

Integration:

- spawned `--plain` CLI with piped stdin for `/help`, `/mode`, `/config`
- TUI frame snapshots through an injected fake TTY (80×24 and 120×30)
- manual: Windows Terminal, PowerShell, Git Bash, VS Code terminal, `blank run` pipe

## Out of scope

Mouse input, syntax highlighting beyond inline code, image rendering, and
concurrent session tabs. Session files remain the source of truth for history.
