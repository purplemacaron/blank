'use strict';

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const {
  safePath, readFileText, addMemory, searchMemory, getSkill, listSkills,
  createCheckpoint, isTextFile,
} = require('./store');
/* Heavy or platform-specific modules load on first use. Chat, planning and
   file edits never pay for sharp, ffmpeg or ssh2 in memory. */
let mediaCache = null;
let searchCache = null;
let computerCache = null;
let sshCache = null;
let paperCache = null;
const mediaLibrary = () => (mediaCache || (mediaCache = require('./media')));
const papers = () => (paperCache || (paperCache = require('./paper')));
const search = () => (searchCache || (searchCache = require('./search')));
const computer = () => (computerCache || (computerCache = require('./computer')));
const ssh = () => (sshCache || (sshCache = require('./ssh')));

const MAX_RESULT = 40000;
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tar', '.7z', '.exe', '.dll', '.so', '.dylib', '.mp3', '.mp4', '.mov', '.woff', '.woff2', '.ttf', '.otf', '.class', '.jar', '.wasm', '.bin']);

const TOOL_SPECS = [
  {
    name: 'read_file',
    label: 'Read file',
    description: 'Read a UTF-8 text file inside the workspace. Returns numbered lines. Use offset/limit for large files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root.' },
        offset: { type: 'integer', description: '1-based first line to read.' },
        limit: { type: 'integer', description: 'Maximum lines (default 2000).' },
      },
      required: ['path'],
    },
    planSafe: true,
  },
  {
    name: 'write_file',
    label: 'Write file',
    description: 'Create or overwrite a text file inside the workspace. Parent folders are created. A checkpoint is saved first.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root.' },
        content: { type: 'string', description: 'Complete file contents.' },
      },
      required: ['path', 'content'],
    },
    mutating: true,
  },
  {
    name: 'edit_file',
    label: 'Edit file',
    description: 'Replace an exact string in a workspace file. Read the file first. old_string must match exactly, including whitespace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string', description: 'Exact text to replace.' },
        new_string: { type: 'string', description: 'Replacement text.' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence (default false).' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    mutating: true,
  },
  {
    name: 'list_dir',
    label: 'List folder',
    description: 'List files and folders in a workspace directory.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory relative to the workspace. Defaults to ".".' },
      },
    },
    planSafe: true,
  },
  {
    name: 'glob',
    label: 'Find files',
    description: 'Find files by glob pattern (supports **, *, ? and {a,b}) inside the workspace.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob such as "src/**/*.ts".' },
        path: { type: 'string', description: 'Directory to search from. Defaults to ".".' },
      },
      required: ['pattern'],
    },
    planSafe: true,
  },
  {
    name: 'grep',
    label: 'Search code',
    description: 'Search file contents with a regular expression. Returns path, line number, and matching line.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression or literal text.' },
        path: { type: 'string', description: 'Directory or file. Defaults to ".".' },
        glob: { type: 'string', description: 'Optional file glob filter, e.g. "*.ts".' },
        ignore_case: { type: 'boolean' },
      },
      required: ['pattern'],
    },
    planSafe: true,
  },
  {
    name: 'run_command',
    label: 'Run command',
    description: 'Run a shell command in the workspace. Use for builds, tests, git, and package managers. Requires approval.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout_ms: { type: 'integer', description: 'Timeout in ms (default 120000, max 600000).' },
      },
      required: ['command'],
    },
    mutating: true,
  },
  {
    name: 'web_fetch',
    label: 'Fetch URL',
    description: 'Fetch a URL and return readable text. Use for documentation or references. HTML is reduced to plain text.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        max_chars: { type: 'integer', description: 'Maximum characters (default 20000).' },
      },
      required: ['url'],
    },
    planSafe: true,
  },
  {
    name: 'web_search',
    label: 'Search the web',
    description: 'Search the public web and return ranked results with title, URL and snippet. DuckDuckGo works without a key; Brave, Tavily, Exa, Serper or a self-hosted SearXNG can be selected in Settings. Use web_fetch to read a promising page in full.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A focused search query.' },
        count: { type: 'integer', description: 'Number of results (1-10, default 6).' },
      },
      required: ['query'],
    },
    planSafe: true,
  },
  {
    name: 'computer_screenshot',
    label: 'Capture screen',
    description: 'Capture the screen to a PNG in the Blank data folder and return its path. Use this to see what the user is looking at before suggesting or performing UI actions. Screen contents are sensitive; each capture asks by default.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'computer_use',
    label: 'Control computer',
    description: 'Control the desktop: move or click the mouse, drag, scroll, type text, press keys, list or focus windows. Requires explicit approval for every call by default. Coordinates are absolute screen pixels. Prefer keyboard shortcuts over blind clicks, and verify with a screenshot after meaningful actions.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['move', 'click', 'drag', 'scroll', 'type', 'key', 'wait', 'focus', 'windows'], description: 'The action to perform.' },
        x: { type: 'integer', description: 'Screen x coordinate for move, click, drag or scroll.' },
        y: { type: 'integer', description: 'Screen y coordinate.' },
        to_x: { type: 'integer', description: 'Drag destination x.' },
        to_y: { type: 'integer', description: 'Drag destination y.' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button for click.' },
        clicks: { type: 'integer', description: 'Click count (1-3).' },
        delta: { type: 'integer', description: 'Scroll amount. Negative scrolls down (default -480).' },
        text: { type: 'string', description: 'Text to type for action=type.' },
        key: { type: 'string', description: 'Key for action=key, e.g. c, Enter, F5.' },
        modifiers: { type: 'array', items: { type: 'string', enum: ['ctrl', 'alt', 'shift', 'cmd'] }, description: 'Modifiers for action=key.' },
        title: { type: 'string', description: 'Window title fragment for action=focus.' },
        ms: { type: 'integer', description: 'Milliseconds for action=wait (max 10000).' },
      },
      required: ['action'],
    },
    mutating: true,
  },
  {
    name: 'todo_write',
    label: 'Update plan',
    description: 'Record or update the session plan. Use for multi-step work. Replace the whole list each time.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
    planSafe: true,
  },
  {
    name: 'remember',
    label: 'Save memory',
    description: 'Save a durable fact or preference about the user or project. Use sparingly for information that should survive this session.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'One concise, self-contained sentence.' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['text'],
    },
    planSafe: true,
  },
  {
    name: 'memory_search',
    label: 'Search memory',
    description: 'Search durable memory for relevant facts and preferences.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
    planSafe: true,
  },
  {
    name: 'read_skill',
    label: 'Load skill',
    description: 'Load the full instructions for a skill by name. Read a skill when its description matches the current task.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name or id from the Skills list.' },
      },
      required: ['name'],
    },
    planSafe: true,
  },
  {
    name: 'delegate',
    label: 'Delegate',
    description: 'Ask a read-only sub-agent to investigate a narrow question (files, code, web) and report back. Saves your main context for synthesis.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'A precise research task with expected output.' },
      },
      required: ['task'],
    },
    planSafe: true,
  },
  {
    name: 'team_delegate',
    label: 'Run agent team',
    description: 'Fan one investigation out to the enabled specialist agents in parallel, then return each report. Use for complex work that benefits from independent research, design and review perspectives. All members are read-only.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The shared task, with context and expected output for every specialist.' },
        members: { type: 'array', items: { type: 'string' }, description: 'Optional member ids or names. Omit to run the whole enabled team.' },
      },
      required: ['task'],
    },
    planSafe: true,
    requiresTeam: true,
  },
  {
    name: 'ssh_run',
    label: 'Run on SSH host',
    description: 'Run a shell command on a saved SSH host and return stdout, stderr and the exit code. Use for remote builds, servers and deployments. The user must add the host in MCP → SSH first. Requires approval by default.',
    parameters: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Saved host id, name, or user@host.' },
        command: { type: 'string', description: 'Remote shell command to run.' },
        cwd: { type: 'string', description: 'Optional remote working directory.' },
        timeout_ms: { type: 'integer', description: 'Timeout in ms (default 120000, max 600000).' },
      },
      required: ['host', 'command'],
    },
    mutating: true,
  },
  {
    name: 'list_media',
    label: 'Browse media',
    description: 'List images, video, music and 3D assets in the Blank media library. Returns asset ids you can reference with edit_media.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['image', 'video', 'audio', 'model3d'], description: 'Optional media kind filter.' },
        query: { type: 'string', description: 'Optional text filter on title and prompt.' },
        limit: { type: 'integer', description: 'Maximum assets (default 12, max 50).' },
      },
    },
    planSafe: true,
  },
  {
    name: 'generate_media',
    label: 'Generate media',
    description: 'Generate an image, video, music track or 3D model. Uses the offline Blank engine by default. Cloud engines (openai-images, google-imagen, google-veo, stability, elevenlabs, replicate, fal) require a saved API key and may cost money. The job is saved to the media library and can optionally be copied into the workspace.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['image', 'video', 'audio', 'model3d'], description: 'Media kind.' },
        prompt: { type: 'string', description: 'Detailed creative brief.' },
        engine: { type: 'string', description: 'blank (default), or a cloud provider id such as openai-images or fal.' },
        model: { type: 'string', description: 'Optional cloud model id.' },
        aspect: { type: 'string', description: 'Aspect ratio: 1:1, 16:9, 9:16, 4:3 or 3:4.' },
        duration: { type: 'number', description: 'Video seconds (2-12) or audio seconds (2-180).' },
        fps: { type: 'integer', description: 'Video frame rate (8-30, default 24).' },
        count: { type: 'integer', description: 'Number of image variations (1-4).' },
        style: { type: 'string', description: 'Visual style or music style. Blank visual styles: aurora, cosmic, landscape, portrait, botanical, product, architecture, mark, grid, waves. Music: ambient, lofi, cinematic, synthwave, electronic, jazz, organic.' },
        palette: { type: 'string', description: 'Visual palette: cobalt, ice, sunset, dawn, violet, mint, forest, sand, mono, noir.' },
        quality: { type: 'string', enum: ['low', 'medium', 'high'], description: '3D mesh quality.' },
        seed: { type: 'integer', description: 'Optional deterministic seed.' },
        soundtrack: { type: 'boolean', description: 'Add a generated soundtrack to local video (default true).' },
        save_to_workspace: { type: 'boolean', description: 'Copy the result into the workspace when finished.' },
        folder: { type: 'string', description: 'Optional workspace subfolder for saved files, e.g. "assets".' },
      },
      required: ['kind', 'prompt'],
    },
    mutating: true,
  },
  {
    name: 'edit_media',
    label: 'Edit media',
    description: 'Create an edited copy of a media asset. Images support crop, resize, rotate, brightness, contrast, saturation, hue, blur, sharpen, grayscale, duotone and format. Audio supports trim, fade, volume and speed. Video supports trim, resize, mute, speed and GIF. 3D supports a regenerated remix or STL export. Check the operations schema in the tool description.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Media asset id from list_media.' },
        prompt: { type: 'string', description: 'Optional restyle brief or remix prompt.' },
        engine: { type: 'string', description: 'blank (local) or openai-images for cloud image edits.' },
        operations: {
          type: 'object',
          description: 'Edit operations. Image: {crop:{left,top,width,height}, width, height, rotate, flip, flop, grayscale, duotone, brightness, contrast, saturation, hue, gamma, blur, sharpen, normalize, format}. Audio: {start, duration, fadeIn, fadeOut, volumeDb, speed, reverse, normalize, format}. Video: {start, duration, width, speed, mute, format:"mp4"|"gif"}. 3D: {kind, quality, seed, format:"obj"|"stl"}.',
        },
        save_to_workspace: { type: 'boolean' },
        folder: { type: 'string' },
      },
      required: ['id'],
    },
    mutating: true,
  },
  {
    name: 'create_paper',
    label: 'Create paper',
    description: 'Create a Paper — a live document kept in the Blank Paper library and shown to the user as a paper card. Use html for a self-contained interactive page, markdown for a document, svg for a graphic, or code for a snippet. Keep HTML self-contained: inline CSS and JS, no network requests, no external scripts. Returns the paper id; revise it later with update_paper.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short paper title. If omitted it is inferred from the content.' },
        kind: { type: 'string', enum: ['html', 'markdown', 'svg', 'code'], description: 'Paper kind (default html).' },
        content: { type: 'string', description: 'Complete content. HTML pages should include their own styles inside the document.' },
        language: { type: 'string', description: 'For code papers, the language (js, python, css, sql, …).' },
        description: { type: 'string', description: 'Optional one-sentence note shown in the library.' },
      },
      required: ['content'],
    },
    mutating: true,
  },
  {
    name: 'update_paper',
    label: 'Update paper',
    description: 'Revise an existing Paper. Pass content to replace the page and bump its version, or pass only title/description/language to relabel it. Read the paper first when the user refers to its current contents.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Paper id from create_paper or list_papers.' },
        content: { type: 'string', description: 'New complete content.' },
        title: { type: 'string' },
        description: { type: 'string' },
        language: { type: 'string', description: 'For code papers only.' },
      },
      required: ['id'],
    },
    mutating: true,
  },
  {
    name: 'read_paper',
    label: 'Read paper',
    description: 'Read the full content of a Paper in the library.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Paper id.' },
      },
      required: ['id'],
    },
    planSafe: true,
  },
  {
    name: 'list_papers',
    label: 'Browse papers',
    description: 'List Papers in the Blank Paper library, newest first. Returns ids, titles, kinds and versions.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional text filter on title, description and excerpt.' },
        kind: { type: 'string', enum: ['html', 'markdown', 'svg', 'code'], description: 'Optional paper kind filter.' },
        favorite: { type: 'boolean', description: 'Only starred papers.' },
        limit: { type: 'integer', description: 'Maximum papers (default 20, max 50).' },
      },
    },
    planSafe: true,
  },
];

function globSource(pattern) {
  let p = String(pattern || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p.includes('/')) p = `**/${p}`;
  let i = 0;
  function parse(untilBrace = false) {
    let out = '';
    while (i < p.length) {
      const c = p[i];
      if (untilBrace && c === '}') { i += 1; return out; }
      if (c === '*') {
        if (p[i + 1] === '*') {
          i += 2;
          if (p[i] === '/') { i += 1; out += '(?:.*/)?'; }
          else out += '.*';
        } else { i += 1; out += '[^/]*'; }
      } else if (c === '?') {
        i += 1; out += '[^/]';
      } else if (c === '{') {
        i += 1;
        let buf = '';
        let depth = 1;
        while (i < p.length && depth > 0) {
          if (p[i] === '{') { depth += 1; buf += '{'; }
          else if (p[i] === '}') { depth -= 1; if (depth > 0) buf += '}'; }
          else buf += p[i];
          i += 1;
        }
        const alts = buf.split(',');
        out += `(?:${alts.map(globFragment).join('|')})`;
      } else {
        out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        i += 1;
      }
    }
    return out;
  }
  function globFragment(fragment) {
    let j = 0;
    let out = '';
    while (j < fragment.length) {
      const c = fragment[j];
      if (c === '*') {
        if (fragment[j + 1] === '*') { j += 2; out += '.*'; }
        else { j += 1; out += '[^/]*'; }
      } else if (c === '?') { j += 1; out += '[^/]'; }
      else { out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&'); j += 1; }
    }
    return out;
  }
  return `^${parse()}$`;
}

function compileGlob(pattern) {
  return new RegExp(globSource(pattern), 'i');
}

const IGNORE = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', '.cache', '__pycache__', '.venv', 'venv', 'target', '.blank']);

function* walk(root, current = root, depth = 0) {
  if (depth > 14) return;
  let entries = [];
  try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    if (IGNORE.has(entry.name)) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      yield* walk(root, full, depth + 1);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function rel(workspace, full) {
  return path.relative(workspace, full).split(path.sep).join('/');
}

function clip(text, max = MAX_RESULT) {
  const value = String(text == null ? '' : text);
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n… [truncated ${value.length - max} characters]`;
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function lineStats(before, after) {
  const oldLines = before ? before.split(/\r?\n/) : [];
  const newLines = after ? after.split(/\r?\n/) : [];
  return {
    added: Math.max(0, newLines.length - oldLines.length),
    removed: Math.max(0, oldLines.length - newLines.length),
    beforeLines: oldLines.length,
    afterLines: newLines.length,
  };
}

function noteFile(ctx, entry, tool) {
  if (!ctx.session) return;
  if (!Array.isArray(ctx.session.files)) ctx.session.files = [];
  const existing = ctx.session.files.find((file) => file.path === entry.path);
  const payload = { ...entry, action: tool, at: new Date().toISOString() };
  if (existing) Object.assign(existing, payload);
  else ctx.session.files.unshift(payload);
  ctx.session.files = ctx.session.files.slice(0, 30);
}

async function toolReadFile(args, ctx) {
  const full = safePath(ctx.workspace, args.path);
  if (!fs.existsSync(full)) return { content: `File not found: ${args.path}`, isError: true };
  const stat = fs.statSync(full);
  if (stat.isDirectory()) return { content: `That is a directory: ${args.path}. Use list_dir.`, isError: true };
  const text = readFileText(full);
  const lines = text.split(/\r?\n/);
  const offset = Math.max(1, Number(args.offset) || 1);
  const limit = Math.min(4000, Math.max(1, Number(args.limit) || 2000));
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  const numbered = slice.map((line, index) => `${String(offset + index).padStart(5)}\t${line}`).join('\n');
  const tail = offset - 1 + limit < lines.length ? `\n\n[${lines.length} lines total — use offset to read more]` : '';
  return {
    content: `${rel(ctx.workspace, full)} (${lines.length} lines)\n${numbered}${tail}`,
    meta: { path: rel(ctx.workspace, full) },
  };
}

async function toolWriteFile(args, ctx) {
  if (typeof args.content !== 'string') return { content: 'content must be a string.', isError: true };
  const full = safePath(ctx.workspace, args.path);
  let before = null;
  if (fs.existsSync(full)) {
    const stat = fs.statSync(full);
    if (stat.isDirectory()) return { content: 'Target is a directory.', isError: true };
    try { before = readFileText(full); } catch { before = null; }
  }
  const checkpointId = createCheckpoint({ sessionId: ctx.session?.id || '', filePath: full, before });
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, args.content, 'utf8');
  const stats = lineStats(before || '', args.content);
  const entry = { path: rel(ctx.workspace, full), bytes: Buffer.byteLength(args.content), ...stats };
  noteFile(ctx, entry, 'write');
  return {
    content: `Wrote ${args.content.length} characters to ${entry.path} (${entry.afterLines} lines).${before === null ? ' Created a new file.' : ''}`,
    meta: { ...entry, checkpointId },
  };
}

async function toolEditFile(args, ctx) {
  const full = safePath(ctx.workspace, args.path);
  if (!fs.existsSync(full)) return { content: `File not found: ${args.path}`, isError: true };
  const before = readFileText(full);
  const oldString = String(args.old_string ?? '');
  const newString = String(args.new_string ?? '');
  if (!oldString) return { content: 'old_string cannot be empty.', isError: true };
  const count = before.split(oldString).length - 1;
  if (count === 0) {
    return {
      content: `Could not find old_string in ${args.path}. Read the file and copy the exact text, including indentation.`,
      isError: true,
    };
  }
  let after;
  if (args.replace_all) after = before.split(oldString).join(newString);
  else after = before.replace(oldString, newString);
  const checkpointId = createCheckpoint({ sessionId: ctx.session?.id || '', filePath: full, before });
  fs.writeFileSync(full, after, 'utf8');
  const stats = lineStats(before, after);
  const entry = { path: rel(ctx.workspace, full), bytes: Buffer.byteLength(after), ...stats };
  noteFile(ctx, entry, 'edit');
  return {
    content: `Edited ${entry.path}. Replaced ${args.replace_all ? count : 1} occurrence${!args.replace_all || count === 1 ? '' : 's'}.${stats.added || stats.removed ? ` +${stats.added} / -${stats.removed} lines.` : ''}`,
    meta: { ...entry, checkpointId },
  };
}

async function toolListDir(args, ctx) {
  const full = safePath(ctx.workspace, args.path || '.');
  if (!fs.existsSync(full)) return { content: `Directory not found: ${args.path || '.'}`, isError: true };
  if (!fs.statSync(full).isDirectory()) return { content: 'That path is a file. Use read_file.', isError: true };
  let entries = [];
  try { entries = fs.readdirSync(full, { withFileTypes: true }); } catch (err) { return { content: err.message, isError: true }; }
  entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
  const rows = entries.slice(0, 400).map((entry) => {
    if (entry.isDirectory()) return `${entry.name}/`;
    let size = '';
    try { size = `\t${humanSize(fs.statSync(path.join(full, entry.name)).size)}`; } catch {}
    return `${entry.name}${size}`;
  });
  const dirName = rel(ctx.workspace, full) || '.';
  return {
    content: `${dirName === '.' ? './' : `${dirName}/`}\n${rows.join('\n') || '(empty)'}${entries.length > 400 ? '\n… (more entries omitted)' : ''}`,
    meta: { path: dirName, count: entries.length },
  };
}

async function toolGlob(args, ctx) {
  const base = safePath(ctx.workspace, args.path || '.');
  const regex = compileGlob(args.pattern);
  const results = [];
  for (const file of walk(base)) {
    if (results.length >= 300) break;
    const relative = path.relative(base, file).split(path.sep).join('/');
    if (regex.test(relative) || regex.test(rel(ctx.workspace, file))) results.push(rel(ctx.workspace, file));
  }
  results.sort();
  return {
    content: results.length ? results.join('\n') : `No files matched ${args.pattern}.`,
    meta: { count: results.length },
  };
}

async function toolGrep(args, ctx) {
  const base = safePath(ctx.workspace, args.path || '.');
  let regex;
  try {
    regex = new RegExp(String(args.pattern), args.ignore_case ? 'gi' : 'g');
  } catch {
    regex = new RegExp(String(args.pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), args.ignore_case ? 'gi' : 'g');
  }
  const fileFilter = args.glob ? compileGlob(args.glob) : null;
  const results = [];
  const targets = fs.statSync(base).isDirectory() ? walk(base) : [base];
  for (const file of targets) {
    if (results.length >= 200) break;
    const ext = path.extname(file).toLowerCase();
    if (BINARY_EXT.has(ext)) continue;
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    if (stat.size > 1024 * 1024) continue;
    if (fileFilter && !fileFilter.test(path.basename(file)) && !fileFilter.test(rel(ctx.workspace, file))) continue;
    let text;
    try { text = readFileText(file, { maxBytes: 1024 * 1024 }); } catch { continue; }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && results.length < 200; i += 1) {
      if (!lines[i]) continue;
      regex.lastIndex = 0;
      if (regex.test(lines[i])) {
        const line = lines[i].length > 240 ? `${lines[i].slice(0, 240)}…` : lines[i];
        results.push(`${rel(ctx.workspace, file)}:${i + 1}: ${line.trim()}`);
      }
    }
  }
  return {
    content: results.length ? results.join('\n') : `No matches for ${args.pattern}.`,
    meta: { count: results.length },
  };
}

const DANGEROUS = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(\/|~|\$HOME)(\s|$)/i,
  /\bmkfs(\.\w+)?\s/i,
  /\bformat\s+[a-z]:/i,
  /\bdiskpart\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bdel\s+\/[fsq]\b.*[a-z]:\\/i,
  /\brmdir\s+\/s\s+\/q\s+[a-z]:\\/i,
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}/,
  /\bdd\s+if=.*of=\/dev\//i,
];

async function toolRunCommand(args, ctx) {
  const command = String(args.command || '').trim();
  if (!command) return { content: 'command is required.', isError: true };
  if (DANGEROUS.some((rx) => rx.test(command))) {
    return { content: 'Blocked by Blank’s safety policy: this command could destroy the machine. Ask the user to run it manually if it is truly intended.', isError: true };
  }
  const timeout = Math.min(600000, Math.max(1000, Number(args.timeout_ms) || 120000));
  return await new Promise((resolve) => {
    exec(command, {
      cwd: ctx.workspace,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      env: process.env,
    }, (error, stdout, stderr) => {
      const out = clip([stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)', 30000);
      const exitCode = error?.code ?? 0;
      const killed = error?.killed ? '\n[process timed out]' : '';
      resolve({
        content: `$ ${command}\n${out}${killed}\n\nExit code: ${exitCode}`,
        isError: Boolean(error && exitCode !== 0),
        meta: { command, exitCode, cwd: path.basename(ctx.workspace) },
      });
    });
  });
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)));
}

function htmlToText(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '';
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  return { title: decodeEntities(title), text };
}

async function toolWebFetch(args, ctx) {
  let url;
  try { url = new URL(String(args.url)); } catch { return { content: 'Invalid URL.', isError: true }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { content: 'Only http(s) URLs are supported.', isError: true };
  if (url.hostname === '169.254.169.254') return { content: 'Blocked metadata address.', isError: true };
  const maxChars = Math.min(60000, Math.max(1000, Number(args.max_chars) || 20000));
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'Blank/1.0 (+https://blank.dev)', accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 4 * 1024 * 1024) return { content: 'Response is too large (over 4 MB).', isError: true };
    const type = response.headers.get('content-type') || '';
    const raw = await response.text();
    let result;
    if (type.includes('html')) {
      const { title, text } = htmlToText(raw);
      result = `${title ? `# ${title}\n\n` : ''}${text}`;
    } else {
      result = raw;
    }
    return {
      content: `URL: ${url.href}\nStatus: ${response.status} ${response.statusText}\nContent-Type: ${type || 'unknown'}\n\n${clip(result, maxChars)}`,
      isError: !response.ok,
      meta: { url: url.href, status: response.status },
    };
  } catch (err) {
    return { content: `Fetch failed: ${err.message}`, isError: true };
  }
}

async function toolWebSearch(args, ctx) {
  try {
    const payload = await search().searchWeb(args.query, {
      config: ctx.config || {},
      signal: ctx.signal,
      count: args.count,
    });
    return {
      content: search().formatResults(payload),
      meta: { query: payload.query, backend: payload.backend, results: payload.results },
    };
  } catch (err) {
    return { content: `Web search failed: ${err.message}`, isError: true };
  }
}

async function toolComputerScreenshot(args, ctx) {
  try {
    const shot = await computer().screenshot();
    const kb = (shot.bytes / 1024).toFixed(0);
    return {
      content: `Screenshot saved: ${shot.path}\nDisplay: ${shot.display || 'unknown'} · ${kb} KB\n\nThe file is outside the workspace in Blank's data folder. Coordinates used by computer_use refer to absolute screen pixels.`,
      meta: { path: shot.path, width: shot.width, height: shot.height, bytes: shot.bytes },
    };
  } catch (err) {
    return { content: `Screen capture failed: ${err.message}`, isError: true };
  }
}

async function toolComputerUse(args, ctx) {
  try {
    const result = await computer().perform(args.action, args);
    if (args.action === 'windows') {
      const items = (result.windows || []).slice(0, 60).map((win) => {
        const title = win.MainWindowTitle || win.title || '';
        const app = win.ProcessName || win.app || '';
        return `- ${app ? `${app}` : 'window'}${title ? `: ${title}` : ''}`;
      });
      return { content: items.length ? `Visible windows:\n${items.join('\n')}` : 'No visible windows with titles.', meta: { windows: result.windows || [] } };
    }
    return { content: `Computer ${args.action} complete${result.detail ? ` — ${result.detail}` : '.'}`, meta: { action: args.action } };
  } catch (err) {
    return { content: `Computer action failed: ${err.message}`, isError: true };
  }
}

async function toolTodoWrite(args, ctx) {
  if (!Array.isArray(args.todos)) return { content: 'todos must be an array.', isError: true };
  const todos = args.todos
    .filter((todo) => todo && typeof todo.content === 'string' && todo.content.trim())
    .slice(0, 30)
    .map((todo) => ({
      content: todo.content.trim().slice(0, 240),
      status: ['pending', 'in_progress', 'completed'].includes(todo.status) ? todo.status : 'pending',
    }));
  if (ctx.session) ctx.session.tasks = todos;
  ctx.emit?.({ type: 'tasks', tasks: todos });
  const done = todos.filter((t) => t.status === 'completed').length;
  return {
    content: `Plan updated: ${done}/${todos.length} complete.\n${todos.map((t) => `- [${t.status === 'completed' ? 'x' : t.status === 'in_progress' ? '~' : ' '}] ${t.content}`).join('\n')}`,
    meta: { tasks: todos },
  };
}

async function toolRemember(args, ctx) {
  const text = String(args.text || '').trim();
  if (!text) return { content: 'text is required.', isError: true };
  const entry = addMemory({
    text,
    tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
    source: ctx.session ? 'agent' : 'tool',
    sessionId: ctx.session?.id || '',
  });
  ctx.emit?.({ type: 'memory', action: 'added', entry });
  return { content: `Saved to memory: “${entry.text}”`, meta: { id: entry.id } };
}

async function toolMemorySearch(args, ctx) {
  const results = searchMemory(String(args.query || ''), 8);
  if (!results.length) return { content: 'No matching memories.' };
  return {
    content: results.map((entry) => `- ${entry.text}${entry.pinned ? ' (pinned)' : ''}${entry.tags?.length ? ` [${entry.tags.join(', ')}]` : ''}`).join('\n'),
    meta: { count: results.length },
  };
}

async function toolReadSkill(args, ctx) {
  const skill = getSkill(String(args.name || ''), ctx.workspace);
  if (!skill) {
    const names = listSkills(ctx.workspace, {}).map((s) => `${s.name} (${s.id})`).join(', ');
    return { content: `Skill not found. Available: ${names || 'none'}`, isError: true };
  }
  return {
    content: `# Skill: ${skill.name}\n\n${skill.body.slice(0, 16000)}`,
    meta: { skill: skill.name, source: skill.source },
  };
}

function mediaLength(value) {
  const seconds = Number(value) || 0;
  if (!seconds) return '';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes ? `${minutes}m ${String(rest).padStart(2, '0')}s` : `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

function describeMediaAsset(asset, saved) {
  const details = [];
  if (asset.width && asset.height) details.push(`${asset.width}×${asset.height}`);
  if (asset.duration) details.push(mediaLength(asset.duration));
  details.push(asset.mime || asset.kindLabel);
  const line = `- ${asset.kindLabel} “${asset.title}” (${details.join(', ')}) · ${asset.engineLabel || asset.engine} · id ${asset.id}`;
  return saved ? `${line} · saved to ${saved}` : line;
}

async function collectMediaResults(job, args, ctx) {
  const assets = job.assetIds
    .map((id) => mediaLibrary().getAsset(id))
    .filter(Boolean);
  const saved = [];
  if (args.save_to_workspace && assets.length) {
    const folder = String(args.folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!ctx.workspace) throw new Error('No workspace is open, so the file cannot be saved.');
    for (const asset of assets) {
      const result = await mediaLibrary().saveToWorkspace(asset.id, ctx.workspace, folder);
      saved.push(result.relative);
    }
  }
  const lines = [job.mode === 'edit' ? 'Created an edited copy:' : 'Generated media:'];
  assets.forEach((asset, index) => lines.push(describeMediaAsset(asset, saved[index])));
  lines.push('Assets are in the Blank media library (Studio). Use list_media to find ids, or edit_media to make a copy.');
  return {
    content: lines.join('\n'),
    meta: { media: assets, jobId: job.id, saved },
  };
}

async function toolListMedia(args, ctx) {
  const limit = Math.min(50, Math.max(1, Number(args.limit) || 12));
  const list = mediaLibrary().listAssets({ kind: args.kind, query: args.query, limit });
  if (!list.items.length) {
    return { content: 'No matching media assets yet. Use generate_media to create one.' };
  }
  const lines = [`Media library — ${list.total} asset${list.total === 1 ? '' : 's'} (showing ${list.items.length}):`];
  for (const item of list.items) lines.push(describeMediaAsset(item));
  return {
    content: lines.join('\n'),
    meta: { media: list.items, count: list.total },
  };
}

async function toolGenerateMedia(args, ctx) {
  if (!['image', 'video', 'audio', 'model3d'].includes(args.kind)) {
    return { content: 'kind must be image, video, audio or model3d.', isError: true };
  }
  if (!String(args.prompt || '').trim()) return { content: 'prompt is required.', isError: true };
  const job = mediaLibrary().generate({
    kind: args.kind,
    prompt: String(args.prompt),
    engine: args.engine || 'blank',
    model: args.model || '',
    aspect: args.aspect,
    duration: args.duration,
    fps: args.fps,
    count: args.count,
    style: args.style,
    palette: args.palette,
    quality: args.quality,
    seed: args.seed,
    soundtrack: args.soundtrack,
    save_to_workspace: args.save_to_workspace,
    folder: args.folder,
  });
  const finished = await mediaLibrary().waitForJob(job.id, { signal: ctx.signal });
  return collectMediaResults(finished, args, ctx);
}

async function toolEditMedia(args, ctx) {
  const id = String(args.id || '').trim();
  if (!id) return { content: 'id is required. Use list_media to find an asset id.', isError: true };
  const job = mediaLibrary().edit({
    id,
    prompt: args.prompt || '',
    engine: args.engine || 'blank',
    operations: args.operations && typeof args.operations === 'object' ? args.operations : {},
    save_to_workspace: args.save_to_workspace,
    folder: args.folder,
  });
  const finished = await mediaLibrary().waitForJob(job.id, { signal: ctx.signal });
  return collectMediaResults(finished, args, ctx);
}

function describePaper(paper) {
  const details = [paper.kindLabel, `v${paper.version}`];
  if (paper.language) details.push(paper.language);
  if (paper.favorite) details.push('starred');
  return `- “${paper.title}” (${details.join(', ')}) · id ${paper.id}`;
}

async function toolCreatePaper(args, ctx) {
  const paper = papers().createPaper({
    title: args.title || '',
    kind: args.kind || 'html',
    content: args.content || '',
    language: args.language || '',
    description: args.description || '',
    source: 'agent',
    sessionId: ctx.session?.id || '',
  });
  const lines = [
    `Created paper “${paper.title}” (${paper.kindLabel}, v${paper.version}) · id ${paper.id}`,
    `Open it in Paper. Revise it with update_paper using id ${paper.id}.`,
  ];
  return { content: lines.join('\n'), meta: { paper } };
}

async function toolUpdatePaper(args, ctx) {
  const id = String(args.id || '').trim();
  if (!id) return { content: 'id is required. Use list_papers to find a paper id.', isError: true };
  const paper = papers().updatePaper(id, {
    title: args.title,
    content: args.content,
    description: args.description,
    language: args.language,
  });
  const lines = [
    `Updated paper “${paper.title}” (${paper.kindLabel}, v${paper.version}) · id ${paper.id}`,
    `Open it in Paper to review the result.`,
  ];
  return { content: lines.join('\n'), meta: { paper } };
}

async function toolReadPaper(args) {
  const id = String(args.id || '').trim();
  if (!id) return { content: 'id is required. Use list_papers to find a paper id.', isError: true };
  const result = papers().getPaperContent(id);
  const lines = [
    `Paper “${result.paper.title}” (${result.paper.kindLabel}, v${result.paper.version}) · id ${result.paper.id}`,
    result.paper.description ? result.paper.description : '',
    '',
    result.content || '(empty)',
  ].filter((line, index) => line || index === 2);
  return { content: lines.join('\n'), meta: { paper: result.paper } };
}

async function toolListPapers(args) {
  const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
  const list = papers().listPapers({
    query: args.query,
    kind: args.kind,
    favorite: args.favorite === true,
    limit,
  });
  if (!list.items.length) {
    return { content: 'No matching papers yet. Use create_paper to make one.' };
  }
  const lines = [`Paper library — ${list.total} paper${list.total === 1 ? '' : 's'} (showing ${list.items.length}):`];
  for (const paper of list.items) lines.push(describePaper(paper));
  return { content: lines.join('\n'), meta: { papers: list.items, count: list.total } };
}

async function toolSshRun(args, ctx) {
  let host;
  try {
    host = ssh().findHost(ctx.config, args.host);
  } catch (err) {
    return { content: err.message, isError: true };
  }
  const command = String(args.command || '');
  if (!command.trim()) return { content: 'command is required.', isError: true };
  try {
    const result = await ssh().runCommand(host, command, {
      timeoutMs: Math.max(5000, Math.min(600000, Number(args.timeout_ms) || 120000)),
      cwd: String(args.cwd || '').trim(),
    });
    const parts = [
      `Host: ${result.host} (${host.user}@${host.host}:${host.port || 22})`,
      `Exit code: ${result.code}`,
      result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : '',
      result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : '',
      result.truncated ? '(output was truncated)' : '',
    ].filter(Boolean);
    return {
      content: parts.join('\n\n'),
      isError: result.code !== 0,
      meta: { host: host.id, code: result.code },
    };
  } catch (err) {
    return { content: `SSH error: ${err.message}`, isError: true };
  }
}

const HANDLERS = {
  read_file: toolReadFile,
  write_file: toolWriteFile,
  edit_file: toolEditFile,
  list_dir: toolListDir,
  glob: toolGlob,
  grep: toolGrep,
  run_command: toolRunCommand,
  web_fetch: toolWebFetch,
  web_search: toolWebSearch,
  computer_screenshot: toolComputerScreenshot,
  computer_use: toolComputerUse,
  todo_write: toolTodoWrite,
  remember: toolRemember,
  memory_search: toolMemorySearch,
  read_skill: toolReadSkill,
  ssh_run: toolSshRun,
  list_media: toolListMedia,
  generate_media: toolGenerateMedia,
  edit_media: toolEditMedia,
  create_paper: toolCreatePaper,
  update_paper: toolUpdatePaper,
  read_paper: toolReadPaper,
  list_papers: toolListPapers,
};

function getToolDefinition(name) {
  return TOOL_SPECS.find((tool) => tool.name === name) || null;
}

function getToolDefinitions({ mode = 'agent', mcpTools = [], config = null } = {}) {
  if (mode === 'ask') return [];
  const local = TOOL_SPECS
    .filter((tool) => (mode === 'plan' ? tool.planSafe : true))
    .filter((tool) => !tool.requiresTeam || Boolean(config?.team?.enabled))
    .map(({ name, description, parameters, label }) => ({ name, description, parameters, label, source: 'local' }));
  if (mode === 'plan') return local;
  const remote = mcpTools.map((tool) => ({
    name: tool.name,
    description: `[MCP · ${tool.serverName}] ${tool.description || tool.originalName}`,
    parameters: tool.inputSchema || { type: 'object', properties: {} },
    label: tool.originalName,
    source: 'mcp',
  }));
  return [...local, ...remote];
}

function resolvePermission(name, ctx) {
  if (ctx.session?.allowTools?.includes(name)) return 'allow';
  if (name.startsWith('mcp__')) {
    const server = name.split('__')[1];
    if (ctx.session?.allowTools?.includes(`mcp:${server}`)) return 'allow';
    if (ctx.session?.allowTools?.includes('mcp:*')) return 'allow';
  }
  if (name.startsWith('mcp__')) return ctx.config?.permissions?.mcp || 'ask';
  return ctx.config?.permissions?.[name] || 'ask';
}

async function executeTool(call, ctx) {
  const name = call.name;
  const args = call.args && typeof call.args === 'object' ? call.args : {};
  const spec = getToolDefinition(name);
  const mode = ctx.mode || 'agent';

  if (mode === 'ask') return { content: 'Tools are disabled in Ask mode.', isError: true };
  if (mode === 'plan' && spec?.mutating) {
    return { content: 'Plan mode is read-only. Describe the change in your plan; the user can switch to Agent mode to apply it.', isError: true };
  }

  const permission = resolvePermission(name, ctx);
  if (permission === 'deny') {
    return { content: `Tool "${name}" is blocked in Settings.`, isError: true };
  }
  if (permission === 'ask' && name !== 'delegate') {
    if (!ctx.requestApproval) return { content: 'Approval is required but unavailable.', isError: true };
    const decision = await ctx.requestApproval({ tool: name, args, label: spec?.label || name });
    if (decision === 'deny') {
      return { content: 'The user denied this tool call. Stop and ask how they would like to proceed.', isError: true };
    }
  }

  try {
    if (name === 'team_delegate') {
      if (!ctx.teamDelegate) return { content: 'The agent team is not available in this runner.', isError: true };
      const output = await ctx.teamDelegate(String(args.task || ''), Array.isArray(args.members) ? args.members : []);
      return { content: output, meta: { delegated: true, team: true } };
    }
    if (name === 'delegate') {
      if (!ctx.delegate) return { content: 'Sub-agents are unavailable in this runner.', isError: true };
      const output = await ctx.delegate(String(args.task || ''), ctx);
      return { content: output, meta: { delegated: true } };
    }
    if (name.startsWith('mcp__')) {
      if (!ctx.mcp) return { content: 'MCP is unavailable in this runner.', isError: true };
      const [, serverName, ...rest] = name.split('__');
      const toolName = rest.join('__');
      const result = await ctx.mcp.callTool(serverName, toolName, args);
      return result;
    }
    const handler = HANDLERS[name];
    if (!handler) return { content: `Unknown tool: ${name}`, isError: true };
    const result = await handler(args, ctx);
    return { ...result, content: clip(result.content) };
  } catch (err) {
    return { content: `Tool error: ${err.message}`, isError: true };
  }
}

function summarizeArgs(name, args = {}) {
  if (name === 'run_command') return args.command || '';
  if (name === 'web_fetch') return args.url || '';
  if (name === 'web_search') return args.query || '';
  if (name === 'computer_screenshot') return 'screen capture';
  if (name === 'computer_use') {
    const target = args.action === 'type' ? `“${String(args.text || '').slice(0, 60)}”`
      : args.action === 'key' ? [...(args.modifiers || []), args.key].filter(Boolean).join('+')
      : args.action === 'focus' ? args.title
      : args.action === 'windows' ? 'list visible windows'
      : [args.x, args.y].filter((value) => value !== undefined).join(', ');
    return `${args.action || 'action'}${target ? ` · ${target}` : ''}`;
  }
  if (name === 'glob' || name === 'grep') return args.pattern || args.glob || '';
  if (name === 'read_skill' || name === 'memory_search') return args.name || args.query || '';
  if (name === 'todo_write') return `${(args.todos || []).length} items`;
  if (name === 'remember') return args.text || '';
  if (name === 'delegate') return args.task || '';
  if (name === 'team_delegate') return `${(args.members || []).length || 'all'} agents · ${args.task || ''}`;
  if (name === 'ssh_run') return `${args.host || ''} · ${args.command || ''}`;
  if (name === 'generate_media') return `${args.kind || 'image'} · ${args.prompt || ''}`;
  if (name === 'edit_media') return `${args.id || ''}${args.prompt ? ` · ${args.prompt}` : ''}`;
  if (name === 'list_media') return [args.kind, args.query].filter(Boolean).join(' · ');
  if (name === 'create_paper') return `${args.kind || 'html'} · ${args.title || args.description || String(args.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70)}`;
  if (name === 'update_paper') return args.title || args.id || '';
  if (name === 'read_paper') return args.id || '';
  if (name === 'list_papers') return [args.kind, args.query].filter(Boolean).join(' · ');
  return args.path || '';
}

module.exports = {
  TOOL_SPECS, getToolDefinitions, getToolDefinition, executeTool, resolvePermission,
  summarizeArgs, compileGlob, htmlToText,
};
