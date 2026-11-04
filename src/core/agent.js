'use strict';

const { streamChat, completeText } = require('./providers');
const { getToolDefinitions, executeTool, summarizeArgs, getToolDefinition } = require('./tools');
const { buildSystemPrompt, providerMessages, estimateConversationTokens } = require('./prompt');
const { listSkills, searchMemory, saveSession, titleFrom } = require('./store');
const { findModel } = require('./catalog');
const { generateSessionTitle } = require('./title');
const { grantSessionApproval } = require('./approvals');
const { uid } = require('./paths');

function lastUserText(session) {
  const messages = session.messages || [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return String(messages[i].content || '');
  }
  return '';
}

function isAbort(err) {
  return err?.name === 'AbortError' || err?.code === 'ABORT_ERR';
}

function cleanAssistantMessage(message) {
  if (!message) return null;
  return {
    id: message.id,
    role: 'assistant',
    content: message.content || '',
    reasoning: message.reasoning || '',
    toolCalls: Array.isArray(message.toolCalls) ? message.toolCalls : [],
    model: message.model || '',
    usage: message.usage || null,
    at: message.at,
  };
}

async function compactSession({ session, config, signal, modelId }) {
  const activeModel = modelId || session.model || config.defaultModel;
  if (!activeModel) return { ok: false, error: 'No model is configured. Connect a provider in Models and choose a model.' };
  const resolved = findModel(activeModel, config);
  if (!resolved) return { ok: false, error: 'Unknown model.' };
  const messages = session.messages || [];
  if (messages.length < 6) return { ok: false, error: 'Nothing to compact yet.' };
  let cutoff = messages.length - 8;
  while (cutoff > 0 && messages[cutoff]?.role !== 'user') cutoff -= 1;
  if (cutoff <= 0) return { ok: false, error: 'Nothing to compact yet.' };
  const older = messages.slice(0, cutoff);
  const transcript = older.map((message) => {
    const who = message.role === 'user' ? 'USER' : message.role === 'assistant' ? 'ASSISTANT' : `TOOL(${message.name || ''})`;
    const body = String(message.content || '').slice(0, 4000);
    const calls = (message.toolCalls || []).map((call) => `[called ${call.name} ${JSON.stringify(call.args || {}).slice(0, 400)}]`).join(' ');
    return `${who}: ${body}${calls ? `\n${calls}` : ''}`;
  }).join('\n\n').slice(0, 60000);
  const system = `You compact agent conversations. Produce a dense, factual summary that preserves: the user's goals, decisions, constraints, files touched, tool outcomes, unresolved issues, and exact names/paths. No pleasantries. Write in the language of the conversation. Keep it under 550 words.`;
  try {
    const summary = await completeText({
      modelId: activeModel,
      config,
      system,
      messages: [{ role: 'user', content: transcript }],
      signal,
      maxTokens: 1600,
    });
    if (!summary) return { ok: false, error: 'The model returned an empty summary.' };
    session.summary = summary;
    session.compactedCount = cutoff;
    session.compactedAt = new Date().toISOString();
    saveSession(session);
    return { ok: true, summary, compacted: cutoff };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function runSubagent({ task, parentSession, config, modelId, workspace, signal, usageOut, system, name, allowWrite = false, requestApproval = null, maxSteps = 0 }) {
  const write = Boolean(allowWrite);
  const role = name || (write ? 'a work sub-agent' : 'a read-only research sub-agent');
  const guidance = write
    ? `You are ${role} inside Blank. You can read and edit files and run commands in the workspace. Work independently, make the smallest correct changes, and verify them with a focused test or build when practical. Every write or command follows the user's approval policy, so do not ask questions. Finish with a compact report: what changed, file paths, and what you verified. Do not delegate further.`
    : `You are ${role} inside Blank. You have file and web tools, but cannot write or run commands. Investigate the task efficiently, using at most a few targeted tool calls. Return a compact report with concrete findings and file:line references. Do not restate the task. Do not ask questions.`;
  const prompt = system ? `${system}\n\n${guidance}` : guidance;
  const messages = [{ role: 'user', content: task }];
  const wanted = write
    ? ['read_file', 'write_file', 'edit_file', 'list_dir', 'glob', 'grep', 'run_command', 'web_search', 'web_fetch', 'read_skill', 'memory_search']
    : ['read_file', 'list_dir', 'glob', 'grep', 'web_search', 'web_fetch'];
  const tools = getToolDefinitions({ mode: write ? 'agent' : 'plan', config }).filter((tool) => wanted.includes(tool.name));
  const limit = Math.max(4, Math.min(24, Number(maxSteps) || (write ? 14 : 8)));
  let final = '';
  for (let step = 0; step < limit; step += 1) {
    if (signal?.aborted) break;
    let text = '';
    let calls = [];
    let stepUsage = { input: 0, output: 0 };
    try {
      for await (const event of streamChat({
        modelId,
        config,
        system: prompt,
        messages,
        tools,
        signal,
        options: { temperature: write ? 0.2 : 0.3, maxTokens: 4096 },
      })) {
        if (event.type === 'text') text += event.text;
        if (event.type === 'usage') {
          stepUsage.input = Math.max(stepUsage.input, event.usage.input || 0);
          stepUsage.output = Math.max(stepUsage.output, event.usage.output || 0);
        }
        if (event.type === 'tool_calls') calls = event.calls;
      }
    } catch (err) {
      if (isAbort(err)) break;
      return `Sub-agent failed: ${err.message}`;
    }
    usageOut.input += stepUsage.input;
    usageOut.output += stepUsage.output;
    final += text;
    if (!calls.length) break;
    messages.push({ role: 'assistant', content: text, toolCalls: calls });
    for (const call of calls) {
      const result = await executeTool(call, {
        workspace,
        session: { id: parentSession?.id || '', allowTools: [] },
        config,
        mode: 'agent',
        requestApproval,
        emit: () => {},
      });
      messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: result.content, isError: Boolean(result.isError) });
    }
  }
  return final.trim() || 'The sub-agent returned no findings.';
}

async function runAgent({
  session,
  config,
  emit = () => {},
  signal,
  requestApproval,
  mcp = null,
}) {
  if (!session) throw new Error('No session.');
  const workspace = session.workspace || config.workspace || process.cwd();
  const runId = uid('run_');
  const sessionId = session.id;
  let activeModel = session.model || config.defaultModel;
  if (activeModel === 'blank-1' || activeModel === 'sandbox' || activeModel.startsWith('sandbox/')) {
    activeModel = config.defaultModel && !config.defaultModel.startsWith('sandbox/') ? config.defaultModel : '';
    session.model = activeModel;
  }
  if (!activeModel) throw new Error('No model is configured. Connect a provider in Models and choose a model.');
  let mcpTools = [];
  let mcpError = '';
  const outcome = { ok: true, runId, usage: { input: 0, output: 0 }, steps: 0 };

  session.usage = session.usage || { input: 0, output: 0 };
  session.files = session.files || [];
  if (!session.mode) session.mode = 'agent';
  if (!session.title || session.title === 'New session') {
    session.title = titleFrom(lastUserText(session));
    emit({ type: 'title', title: session.title });
  }

  emit({ type: 'run:start', runId, sessionId, model: activeModel, mode: session.mode, title: session.title });

  if (mcp) {
    try {
      mcpTools = await mcp.ensure(config);
      if (mcpTools.length) emit({ type: 'notice', level: 'info', text: `${mcpTools.length} MCP tool${mcpTools.length === 1 ? '' : 's'} connected.` });
    } catch (err) {
      mcpError = err.message;
      emit({ type: 'notice', level: 'warn', text: `MCP unavailable: ${err.message}` });
    }
  }

  const approvals = new Map();
  async function approve(request) {
    if (!requestApproval) return 'deny';
    const approvalId = uid('a_');
    approvals.set(approvalId, request);
    const decision = await requestApproval({ ...request, approvalId });
    approvals.delete(approvalId);
    if (decision === 'always') {
      const scope = grantSessionApproval(session, request);
      const text = scope === 'command'
        ? 'This exact command is allowed for the rest of the session.'
        : scope === 'file'
          ? 'This exact file is allowed for the rest of the session.'
          : `“${request.label || request.tool}” allowed for this session.`;
      emit({ type: 'notice', level: 'info', text });
    }
    return decision === 'deny' ? 'deny' : 'allow';
  }

  const toolCtx = {
    workspace,
    session,
    config,
    mode: session.mode,
    emit,
    signal,
    requestApproval: approve,
    mcp: mcp ? { callTool: (server, tool, args) => mcp.callTool(server, tool, args) } : null,
    delegate: async (task, options = {}) => {
      const write = Boolean(options.write);
      const label = String(options.name || '').trim() || (write ? 'work worker' : 'research sub-agent');
      const text = String(task || '').trim();
      if (!text) return 'A task is required for the sub-agent.';
      emit({ type: 'notice', level: 'info', text: `${label} working${write ? ' · can edit and run' : ' · read-only'}.` });
      const usageOut = { input: 0, output: 0 };
      let report;
      try {
        report = await runSubagent({
          task: text,
          parentSession: session,
          config,
          modelId: activeModel,
          workspace,
          signal,
          usageOut,
          name: label,
          allowWrite: write,
          requestApproval: approve,
          maxSteps: options.steps,
        });
      } catch (err) {
        report = `Sub-agent failed: ${err.message}`;
      }
      session.usage.input += usageOut.input;
      session.usage.output += usageOut.output;
      emit({ type: 'usage', usage: { ...session.usage } });
      emit({ type: 'notice', level: 'info', text: `${label} finished.` });
      return report;
    },
    teamDelegate: async (task, wanted = []) => {
      const team = config.team || {};
      if (!team.enabled) return 'The agent team is disabled. Enable it in Settings → Team.';
      const text = String(task || '').trim();
      if (!text) return 'A task is required for the agent team.';
      const all = (team.members || []).filter((member) => member && member.enabled !== false && member.name);
      const picks = (Array.isArray(wanted) ? wanted : []).map(String);
      const members = picks.length
        ? all.filter((member) => picks.includes(member.id) || picks.includes(member.name))
        : all;
      if (!members.length) return 'No enabled team members matched. Check Settings → Team.';
      if (members.length > 6) return 'Run at most six specialists at once.';
      emit({ type: 'notice', level: 'info', text: `Agent team · ${members.map((member) => member.name).join(', ')} working in parallel.` });
      const reports = await Promise.all(members.map(async (member) => {
        const usageOut = { input: 0, output: 0 };
        let report;
        try {
          report = await runSubagent({
            task: text,
            parentSession: session,
            config,
            modelId: member.model || activeModel,
            workspace,
            signal,
            usageOut,
            name: member.name,
            system: `You are ${member.name}, a specialist on Blank's agent team. Work independently and do not ask the user questions.\n\nRole: ${member.role || 'Investigate the task and report concrete findings.'}`,
          });
        } catch (err) {
          report = `Member failed: ${err.message}`;
        }
        session.usage.input += usageOut.input;
        session.usage.output += usageOut.output;
        return { member, report };
      }));
      emit({ type: 'usage', usage: { ...session.usage } });
      emit({ type: 'notice', level: 'info', text: `Agent team finished · ${reports.length} report${reports.length === 1 ? '' : 's'}.` });
      return reports.map(({ member, report }) => `## ${member.name}\n${String(report || '').trim() || 'No findings.'}`).join('\n\n').slice(0, 40000);
    },
  };

  let didAutoCompact = false;
  const maxSteps = Math.max(1, Math.min(64, Number(config.agent?.maxSteps) || 32));

  try {
    for (let step = 0; step < maxSteps; step += 1) {
      if (signal?.aborted) break;
      outcome.steps = step + 1;

      let skills = [];
      try { skills = listSkills(workspace, config); } catch {}
      const memories = config.agent?.autoMemory === false ? [] : searchMemory(lastUserText(session), 6);
      let system = buildSystemPrompt({
        workspace,
        mode: session.mode,
        config,
        model: activeModel,
        skills,
        memories,
        session,
      });

      if (!didAutoCompact && config.agent?.autoCompact && session.messages.length > 12 && session.mode !== 'ask') {
        const resolved = findModel(activeModel, config);
        const limit = Number(resolved?.context) || 128000;
        const estimate = estimateConversationTokens(system, providerMessages(session));
        if (estimate > limit * (Number(config.agent?.compactAt) || 0.82)) {
          emit({ type: 'notice', level: 'info', text: 'Context is getting full — compacting earlier turns.' });
          const result = await compactSession({ session, config, signal, modelId: activeModel });
          didAutoCompact = true;
          if (result.ok) {
            emit({ type: 'compacted', compacted: result.compacted, summary: result.summary });
            system = buildSystemPrompt({ workspace, mode: session.mode, config, model: activeModel, skills, memories, session });
          } else {
            emit({ type: 'notice', level: 'warn', text: `Could not compact context: ${result.error}` });
          }
        }
      }

      const tools = getToolDefinitions({ mode: session.mode, mcpTools, config });
      const providerMsgs = providerMessages(session);
      const messageId = uid('msg_');
      let text = '';
      let reasoning = '';
      let calls = [];
      let providerItems = [];
      let stepUsage = { input: 0, output: 0 };
      let providerFailed = false;
      let fallbackTried = false;

      emit({ type: 'assistant:start', messageId, model: activeModel, step });

      while (true) {
        try {
          for await (const event of streamChat({
            modelId: activeModel,
            config,
            system,
            messages: providerMsgs,
            tools,
            signal,
            options: {
              temperature: config.agent?.temperature,
              maxTokens: config.agent?.maxTokens,
              reasoningEffort: session.reasoningEffort || config.agent?.reasoningEffort || 'auto',
            },
          })) {
            if (event.type === 'text') {
              text += event.text;
              emit({ type: 'text', messageId, delta: event.text });
            } else if (event.type === 'reasoning') {
              reasoning += event.text;
              emit({ type: 'reasoning', messageId, delta: event.text });
            } else if (event.type === 'tool_calls') {
              calls = event.calls;
            } else if (event.type === 'provider_items') {
              providerItems = event.items;
            } else if (event.type === 'usage') {
              stepUsage.input = Math.max(stepUsage.input, event.usage.input || 0);
              stepUsage.output = Math.max(stepUsage.output, event.usage.output || 0);
            } else if (event.type === 'error') {
              throw new Error(event.error);
            }
          }
          break;
        } catch (err) {
          if (isAbort(err) || signal?.aborted) break;
          const canFallback = !fallbackTried && !text && !calls.length && config.fallbackModel && config.fallbackModel !== activeModel;
          if (canFallback) {
            fallbackTried = true;
            emit({ type: 'notice', level: 'warn', text: `${activeModel} failed (${err.message}). Retrying with ${config.fallbackModel}.` });
            activeModel = config.fallbackModel;
            continue;
          }
          providerFailed = true;
          outcome.ok = false;
          outcome.error = err.message;
          emit({ type: 'error', message: err.message, hint: providerHint(err) });
          break;
        }
      }

      session.usage.input += stepUsage.input;
      session.usage.output += stepUsage.output;
      if (stepUsage.input || stepUsage.output) emit({ type: 'usage', usage: { ...session.usage } });
      if (providerFailed) break;

      const normalizedCalls = (calls || [])
        .filter((call) => call && call.name)
        .map((call, index) => ({
          id: call.id || `call_${step}_${index}_${Date.now().toString(36)}`,
          name: call.name,
          args: call.args && typeof call.args === 'object' ? call.args : {},
          rawArgs: call.rawArgs,
        }));

      if (!text && !normalizedCalls.length) {
        emit({ type: 'assistant:empty', messageId });
        break;
      }

      const assistantMessage = {
        id: messageId,
        role: 'assistant',
        content: text,
        reasoning,
        toolCalls: normalizedCalls,
        model: activeModel,
        usage: { ...stepUsage },
        at: new Date().toISOString(),
      };
      if (providerItems.length) assistantMessage.providerItems = providerItems;
      session.messages.push(assistantMessage);
      saveSession(session);
      emit({ type: 'assistant:end', messageId, message: cleanAssistantMessage(assistantMessage) });

      if (!normalizedCalls.length || session.mode === 'ask') break;

      for (let i = 0; i < normalizedCalls.length; i += 1) {
        const call = normalizedCalls[i];
        if (signal?.aborted) {
          for (let j = i; j < normalizedCalls.length; j += 1) {
            const skipped = normalizedCalls[j];
            const result = { content: 'Stopped by the user before this tool ran.', isError: true };
            const toolMessage = {
              id: uid('tool_'),
              role: 'tool',
              toolCallId: skipped.id,
              name: skipped.name,
              content: result.content,
              isError: true,
              at: new Date().toISOString(),
            };
            session.messages.push(toolMessage);
            emit({ type: 'tool:start', callId: skipped.id, name: skipped.name, label: getToolDefinition(skipped.name)?.label || skipped.name, args: skipped.args });
            emit({ type: 'tool:end', callId: skipped.id, name: skipped.name, content: result.content, isError: true, meta: {} });
          }
          break;
        }
        const label = getToolDefinition(call.name)?.label || call.name;
        emit({
          type: 'tool:start',
          callId: call.id,
          name: call.name,
          label,
          args: call.args,
          summary: summarizeArgs(call.name, call.args),
        });
        let result;
        try {
          result = await executeTool(call, toolCtx);
        } catch (err) {
          result = { content: `Tool crashed: ${err.message}`, isError: true };
        }
        if (signal?.aborted && !result) result = { content: 'Stopped by the user.', isError: true };
        const toolMessage = {
          id: uid('tool_'),
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: String(result.content || ''),
          isError: Boolean(result.isError),
          meta: result.meta || {},
          at: new Date().toISOString(),
        };
        session.messages.push(toolMessage);
        saveSession(session);
        emit({
          type: 'tool:end',
          callId: call.id,
          name: call.name,
          content: toolMessage.content,
          isError: toolMessage.isError,
          meta: toolMessage.meta,
        });
      }
      if (signal?.aborted) break;
    }

    if (outcome.steps >= maxSteps && !signal?.aborted) {
      emit({ type: 'notice', level: 'warn', text: `Reached the ${maxSteps}-step limit. Send another message to continue, or raise the limit in Settings.` });
    }
    if (signal?.aborted) {
      outcome.ok = false;
      outcome.stopped = true;
    }
  } catch (err) {
    if (isAbort(err)) {
      outcome.ok = false;
      outcome.stopped = true;
    } else {
      outcome.ok = false;
      outcome.error = err.message;
      emit({ type: 'error', message: err.message });
    }
  }

  if (!session.title || session.title === 'New session') session.title = titleFrom(lastUserText(session));
  if (outcome.ok && !signal?.aborted) {
    try {
      const named = await generateSessionTitle({ session, config, modelId: activeModel, signal });
      if (named.changed) emit({ type: 'title', title: named.title });
    } catch {}
  }
  saveSession(session);
  return outcome;
}

function providerHint(err) {
  const message = String(err?.message || '');
  if (/401|403|invalid.*key|api key/i.test(message)) return 'Check the API key in Models.';
  if (/404|model/i.test(message) && /not found|unknown/i.test(message)) return 'The model id may be wrong — edit it in Models.';
  if (/429|rate limit/i.test(message)) return 'Rate limited. Wait a moment, or switch models.';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(message)) return 'The provider is unreachable. Check your connection or local server.';
  if (/context|token/i.test(message)) return 'The conversation is too long. Try /compact.';
  return '';
}

module.exports = { runAgent, compactSession, runSubagent, providerHint };
