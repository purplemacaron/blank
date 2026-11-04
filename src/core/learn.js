'use strict';

const { completeText } = require('./providers');
const {
  listSessions, getSession, listMemory, addMemory, listSkills, createSkill,
  readInsights, writeInsights, addInsight, getInsight, dismissInsight, markInsightApplied, getStats,
} = require('./store');
const { loadConfig, saveConfig, resolveKey } = require('./config');
const { allModels, getProvider } = require('./catalog');

function modelConnected(config, model) {
  const provider = getProvider(model.providerId, config);
  if (!provider) return false;
  if (provider.kind === 'local' && !provider.keyEnv) return true;
  return Boolean(resolveKey(config, provider.id, provider));
}

function pickReflectionModel(config) {
  if (config.defaultModel) {
    const model = allModels(config).find((entry) => entry.fullId === config.defaultModel);
    if (model && modelConnected(config, model)) return model.fullId;
  }
  if (config.fallbackModel) {
    const model = allModels(config).find((entry) => entry.fullId === config.fallbackModel);
    if (model && modelConnected(config, model)) return model.fullId;
  }
  const candidates = allModels(config)
    .filter((model) => modelConnected(config, model))
    .sort((a, b) => {
      const weight = (m) => (m.providerId === 'anthropic' ? 0 : m.providerId === 'openai' ? 1 : m.providerId === 'google' ? 2 : m.local ? 4 : 3);
      return weight(a) - weight(b);
    });
  return candidates[0]?.fullId || '';
}

function transcriptFor(sessions, maxChars = 28000) {
  let out = '';
  for (const session of sessions) {
    if (!session || !(session.messages || []).length) continue;
    out += `\n\n## SESSION: ${session.title} (${session.updatedAt?.slice(0, 10) || ''})\n`;
    const messages = session.messages.slice(-18);
    for (const message of messages) {
      if (message.role === 'tool') {
        out += `TOOL ${message.name}${message.isError ? ' (error)' : ''}: ${String(message.content || '').slice(0, 260)}\n`;
      } else if (message.role === 'assistant') {
        const calls = (message.toolCalls || []).map((call) => call.name).join(', ');
        out += `ASSISTANT: ${String(message.content || '').slice(0, 700)}${calls ? ` [tools: ${calls}]` : ''}\n`;
      } else if (message.role === 'user') {
        out += `USER: ${String(message.content || '').slice(0, 700)}\n`;
      }
    }
    if (out.length > maxChars) break;
  }
  return out.slice(0, maxChars);
}

function extractJSON(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(raw); } catch {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
  }
  return null;
}

function validateInsights(payload) {
  const list = Array.isArray(payload?.insights) ? payload.insights : [];
  return list.slice(0, 4).map((insight) => {
    const type = ['memory', 'instruction', 'skill'].includes(insight.type) ? insight.type : 'memory';
    const content = String(insight.content || '').trim().slice(0, type === 'skill' ? 8000 : 800);
    if (type !== 'skill' && content.length < 8) return null;
    if (type === 'skill' && content.length < 40) return null;
    return {
      type,
      title: String(insight.title || (type === 'memory' ? 'Memory' : type === 'skill' ? 'New skill' : 'Preference')).slice(0, 100),
      content,
      reason: String(insight.reason || '').slice(0, 400),
      confidence: Math.min(0.98, Math.max(0.3, Number(insight.confidence) || 0.6)),
      tags: Array.isArray(insight.tags) ? insight.tags.map(String).slice(0, 6) : [],
      skillName: String(insight.skillName || insight.title || '').slice(0, 60),
      description: String(insight.description || insight.reason || '').slice(0, 240),
    };
  }).filter(Boolean);
}

async function reflectNow({ config, workspace, signal, modelId }) {
  const model = modelId || pickReflectionModel(config);
  if (!model) {
    return { ok: false, error: 'Connect a hosted or local model first.' };
  }
  const summaries = listSessions(workspace).slice(0, 8);
  const sessions = summaries.map((summary) => getSession(summary.id)).filter((session) => session && (session.messages || []).length);
  if (!sessions.length) return { ok: false, error: 'No conversations to learn from yet.' };
  const memory = listMemory();
  const skills = listSkills(workspace, config);
  const stats = getStats(workspace);

  const system = `You are Blank's reflection engine. You read past agent sessions and propose durable improvements. You are conservative and high-signal: it is normal to return zero insights.

Return JSON only, matching:
{"insights":[
  {"type":"memory","title":"Short label","content":"One self-contained durable fact or preference.","reason":"Why this will matter later.","confidence":0.8,"tags":["preference"]},
  {"type":"instruction","title":"Behavioral rule","content":"A short standing instruction for future sessions.","reason":"Evidence from the sessions.","confidence":0.7},
  {"type":"skill","title":"Skill name","skillName":"Skill name","description":"One-line description for the skills catalog.","content":"Full markdown body of a reusable SKILL.md, 150-500 words.","reason":"Repeated workflow observed.","confidence":0.7}
]}

Rules:
- Maximum 3 insights. Prefer memory. Use instruction only for a clear, repeated correction or explicit user preference. Use skill only when the same multi-step workflow was actually performed and will recur.
- Never include secrets, API keys, credentials, transient task details, or obvious facts.
- Memories must be standalone sentences, useful weeks later.
- Skills must include concrete steps and guardrails, and must not assume tools that don't exist.
- Match the dominant language of the sessions.
- If nothing is worth keeping, return {"insights":[]}.`;

  const user = `CURRENT DURABLE MEMORY:
${memory.map((entry) => `- ${entry.text}`).join('\n') || '(none)'}

CURRENT SKILLS:
${skills.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n') || '(none)'}

TOOL USAGE: ${stats.topTools.map((tool) => `${tool.name}×${tool.count}`).join(', ') || 'none'} · ${stats.sessions} sessions

RECENT SESSIONS:${transcriptFor(sessions)}`;

  let raw;
  try {
    raw = await completeText({
      modelId: model,
      config,
      system,
      messages: [{ role: 'user', content: user }],
      signal,
      maxTokens: 3000,
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const parsed = extractJSON(raw);
  if (!parsed) {
    return { ok: false, error: 'The reflection model returned something that was not valid JSON.', raw: raw.slice(0, 800) };
  }
  const insights = validateInsights(parsed);
  const added = [];
  for (const insight of insights) {
    const entry = addInsight(insight);
    if (entry) added.push(entry);
  }
  const data = readInsights();
  data.lastReflectionAt = new Date().toISOString();
  data.reflections = (data.reflections || 0) + 1;
  writeInsights(data);
  return {
    ok: true,
    model,
    added,
    considered: insights.length,
    proposals: added.length,
    message: added.length ? `${added.length} insight${added.length === 1 ? '' : 's'} ready for review.` : 'No new durable insights this time.',
  };
}

async function applyInsight({ id, config, workspace }) {
  const insight = getInsight(id);
  if (!insight) return { ok: false, error: 'Insight not found.' };
  try {
    if (insight.type === 'memory') {
      addMemory({
        text: insight.content,
        tags: [...(insight.tags || []), 'learned'],
        source: 'reflection',
      });
    } else if (insight.type === 'instruction') {
      const next = loadConfig();
      const existing = String(next.customInstructions || '').trim();
      const line = `- ${insight.content}`;
      if (!existing.includes(insight.content)) {
        next.customInstructions = existing ? `${existing}\n${line}` : `Learned preferences:\n${line}`;
        saveConfig(next);
      }
    } else if (insight.type === 'skill') {
      const existing = listSkills(workspace, config).find((skill) => skill.name.toLowerCase() === String(insight.skillName || insight.title).toLowerCase());
      if (existing) return { ok: false, error: `A skill named “${existing.name}” already exists.` };
      createSkill({
        name: insight.skillName || insight.title,
        description: insight.description || insight.reason || 'A workflow learned from past sessions.',
        body: insight.content,
        scope: 'global',
      });
    } else {
      return { ok: false, error: 'Unknown insight type.' };
    }
    markInsightApplied(id);
    return { ok: true, insight };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function getLearnState({ config, workspace }) {
  const data = readInsights();
  const skills = listSkills(workspace, config);
  const memory = listMemory();
  return {
    ...data,
    stats: getStats(workspace),
    reflectionModel: pickReflectionModel(config),
    counts: {
      memory: memory.length,
      skills: skills.length,
      enabledSkills: skills.filter((skill) => skill.enabled).length,
    },
  };
}

module.exports = { reflectNow, applyInsight, getLearnState, pickReflectionModel, dismissInsight, validateInsights, extractJSON };
