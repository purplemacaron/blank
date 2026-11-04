'use strict';

/**
 * Curated, one-click capabilities.
 *
 * Every plugin is installed through an explicit user action. MCP plugins start
 * local processes or connect to remote endpoints and their tools still pass
 * through the normal approval policy. Built-ins are always available and are
 * listed here so the catalog explains the full surface in one place.
 */

const { slugify } = require('./paths');

const WORKSPACE_TOKEN = '{{workspace}}';

const CATALOG = [
  {
    id: 'builtin-web-search',
    name: 'Web search',
    category: 'Built in',
    icon: 'globe',
    tagline: 'Search the live web, then read and cite the best pages.',
    description: 'Blank ships web_search and web_fetch. DuckDuckGo works with no key; Brave, Tavily, Exa, Serper and SearXNG can be connected in Settings.',
    kind: 'builtin',
    action: 'settings-web',
    tags: ['No setup', 'Citations'],
  },
  {
    id: 'builtin-computer',
    name: 'Computer use',
    category: 'Built in',
    icon: 'monitor',
    tagline: 'See the screen and control the desktop with approval.',
    description: 'computer_screenshot and computer_use work on Windows, macOS and Linux. A blue cursor marker shows every action, and each action asks first by default.',
    kind: 'builtin',
    action: 'settings-computer',
    tags: ['Approval gated', 'Cursor overlay'],
  },
  {
    id: 'builtin-media',
    name: 'Studio',
    category: 'Built in',
    icon: 'wand',
    tagline: 'Create and edit images, video, music and 3D.',
    description: 'A media workspace for images, video, music, speech and 3D, connected to real providers.',
    kind: 'builtin',
    action: 'studio',
    tags: ['Local first'],
  },
  {
    id: 'builtin-remote',
    name: 'Remote control',
    category: 'Built in',
    icon: 'smartphone',
    tagline: 'Pair a phone over your network with a one-time token.',
    description: 'An authenticated web client for sending messages, watching runs and answering approvals. Off by default and loopback-only until you allow LAN access.',
    kind: 'builtin',
    action: 'settings-remote',
    tags: ['Token auth', 'Off by default'],
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    category: 'MCP',
    icon: 'folder',
    tagline: 'Give the agent a scoped view of your workspace files.',
    description: 'Starts the official Filesystem MCP server rooted at your current workspace. Useful for structured directory operations; the built-in read/write tools remain available.',
    kind: 'mcp',
    transport: 'stdio',
    command: `npx -y @modelcontextprotocol/server-filesystem "${WORKSPACE_TOKEN}"`,
    requires: ['workspace', 'node'],
    risk: 'Starts a local process with npx. Every MCP tool call still follows your approval policy.',
    tags: ['Local', 'npx'],
  },
  {
    id: 'playwright',
    name: 'Playwright Browser',
    category: 'MCP',
    icon: 'globe',
    tagline: 'Drive a real browser, inspect pages and take screenshots.',
    description: 'Microsoft’s Playwright MCP server gives the agent a browser with accessibility snapshots, navigation and form interaction.',
    kind: 'mcp',
    transport: 'stdio',
    command: 'npx -y @playwright/mcp@latest',
    requires: ['node'],
    risk: 'Starts a local browser automation process. It can navigate to any site you approve.',
    tags: ['Browser', 'npx'],
  },
  {
    id: 'context7',
    name: 'Context7 Docs',
    category: 'MCP',
    icon: 'book',
    tagline: 'Pull current, version-specific documentation into context.',
    description: 'Upstash Context7 resolves library names and returns up-to-date docs and code examples.',
    kind: 'mcp',
    transport: 'stdio',
    command: 'npx -y @upstash/context7-mcp@latest',
    requires: ['node'],
    risk: 'Starts a local npx process that queries the Context7 service.',
    tags: ['Docs', 'npx'],
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    category: 'MCP',
    icon: 'brain',
    tagline: 'Structure hard problems into explicit, revisable steps.',
    description: 'The official Sequential Thinking server exposes a scratchpad for multi-step reasoning and branching.',
    kind: 'mcp',
    transport: 'stdio',
    command: 'npx -y @modelcontextprotocol/server-sequential-thinking',
    requires: ['node'],
    risk: 'Starts a local npx process. No network access is required by the server.',
    tags: ['Reasoning', 'Local'],
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'MCP',
    icon: 'github',
    tagline: 'Read repositories, issues and pull requests.',
    description: 'Connects to GitHub’s hosted MCP endpoint with a personal access token. Start read-only by creating a fine-grained token.',
    kind: 'mcp',
    transport: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    requires: ['token'],
    tokenLabel: 'Fine-grained GitHub token',
    tokenHeader: 'authorization',
    tokenPrefix: 'Bearer ',
    risk: 'Your token is stored locally and sent only to api.githubcopilot.com. Grant the smallest scopes you need.',
    docs: 'https://github.com/github/github-mcp-server',
    tags: ['Remote', 'Token'],
  },
  {
    id: 'a11y-audit',
    name: 'Accessibility audit',
    category: 'Skill',
    icon: 'eye',
    tagline: 'A rigorous WCAG-minded review pass for any UI.',
    description: 'Installs a skill that walks keyboard, focus, contrast, semantics and motion checks, then reports concrete fixes.',
    kind: 'skill',
    skill: {
      name: 'Accessibility audit',
      description: 'Audit a UI for keyboard access, focus order, semantics, contrast and motion safety.',
      body: `# Accessibility audit\n\nWhen asked to audit accessibility:\n\n1. Map every interactive element and its keyboard path. Test Tab, Shift+Tab, Enter, Space and Escape.\n2. Check focus: visible focus rings, focus trapping in dialogs, return focus on close, skip links.\n3. Check semantics: landmarks, headings, labels, button vs link, alt text and live regions.\n4. Check contrast and state: text/background pairs, disabled controls, errors, dark mode.\n5. Check motion: respect prefers-reduced-motion; avoid gratuitous autoplay.\n6. Report findings as P0 (blocks use), P1 (serious), P2 (polish) with file/line evidence and a concrete fix.\n\nNever claim a check passed unless you actually ran it.`,
    },
    tags: ['Skill', 'WCAG'],
  },
  {
    id: 'perf-audit',
    name: 'Performance budget',
    category: 'Skill',
    icon: 'zap',
    tagline: 'Find the slow path and prove the win.',
    description: 'Installs a skill for measuring, locating and fixing performance bottlenecks instead of guessing.',
    kind: 'skill',
    skill: {
      name: 'Performance budget',
      description: 'Measure first, find the bottleneck, then prove the improvement.',
      body: `# Performance budget\n\nWhen asked to improve performance:\n\n1. Establish a baseline with a repeatable command or benchmark. Record numbers.\n2. Identify the dominant cost before changing code: CPU profile, network waterfall, query plan, render trace.\n3. Change one thing at a time; keep the diff reviewable.\n4. Re-run the same measurement and report before/after numbers.\n5. Guard the win with a test, budget or assertion when practical.\n\nReport the command, environment and variance. Do not present estimates as measurements.`,
    },
    tags: ['Skill', 'Benchmarks'],
  },
];

function catalogItems() {
  return CATALOG.map((item) => ({ ...item, builtin: item.kind === 'builtin' }));
}

function getPlugin(id) {
  return CATALOG.find((item) => item.id === id) || null;
}

function pluginServer(item, { workspace }) {
  if (!item || item.kind !== 'mcp') throw new Error('Not an MCP plugin.');
  if (item.requires?.includes('workspace') && !workspace) throw new Error('Open a workspace before installing this plugin.');
  const command = String(item.command || '').replace(WORKSPACE_TOKEN, String(workspace || '').replace(/"/g, ''));
  return {
    transport: item.transport || 'stdio',
    command,
    url: item.url || '',
    pluginId: item.id,
    pluginName: item.name,
  };
}

function slugForSkill(item) {
  return slugify(item?.skill?.name || item?.name || 'skill');
}

module.exports = { CATALOG, catalogItems, getPlugin, pluginServer, slugForSkill };
