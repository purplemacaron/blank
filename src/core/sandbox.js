'use strict';

/**
 * Blank Sandbox — a deterministic, offline preview model.
 * It does not pretend to be a frontier model: it tours the harness, explains
 * how things work, and can exercise a few real tools without a network.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hasHangul(text) {
  return /[\uac00-\ud7af]/.test(text);
}

function textOf(message) {
  let content = String(message.content || '');
  if (Array.isArray(message.attachments) && message.attachments.length) {
    content += '\n' + message.attachments.map((a) => `${a.name}\n${a.content}`).join('\n');
  }
  return content;
}

async function* streamText(text, signal, delay = 12) {
  const chunks = text.match(/\S+\s*/g) || [text];
  let group = '';
  for (let i = 0; i < chunks.length; i += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    group += chunks[i];
    if (group.length > 14 || i === chunks.length - 1) {
      yield { type: 'text', text: group };
      group = '';
      await sleep(delay);
    }
  }
}

function toolCall(id, name, args) {
  return { id, name, args };
}

function greeting(ko) {
  if (ko) {
    return `안녕하세요. **Blank**입니다.

지금은 오프라인 **Sandbox** 모델로 실행 중이라, 실제 추론 모델은 아니에요. 하지만 앱의 구조는 전부 살아 있습니다.

- **하네스 둘러보기**를 요청하면 실제 도구 호출(계획, 파일 탐색, 메모리 검색)이 작동하는 모습을 보여드릴게요.
- 우측 상단의 모델 칩에서 **실제 모델**을 연결하면 파일을 읽고 쓰고, 명령을 실행하고, MCP 도구까지 사용할 수 있습니다.
- 왼쪽 사이드바에서 Skills, Memory, MCP, Learning을 확인해 보세요.

무엇을 먼저 해볼까요?`;
  }
  return `Hi — this is **Blank**, running on the offline **Sandbox** model.

I'm a deterministic preview, not a hosted language model. The harness around me is real, though:

- Ask for a **tour** and I'll exercise actual tools — planning, workspace inspection, memory recall.
- Connect a hosted model from the **model chip** to reason over your code, edit files, run commands, and use MCP tools.
- Explore **Skills**, **Memory**, **MCP**, and **Learning** in the sidebar.

What would you like to try first?`;
}

function demoIntro(ko) {
  return ko
    ? `좋아요. 실제 하네스 루프를 한 번 돌려보겠습니다.

먼저 작업 계획을 세션에 기록하겠습니다.`
    : `Good — let's run the real harness loop, not a mock-up.

First I'll record a plan for this session.`;
}

function demoWorkspace(ko) {
  return ko
    ? `계획을 세웠습니다. 이제 **워크스페이스**를 실제로 읽어볼게요. 파일 도구는 워크스페이스 밖으로 나갈 수 없도록 제한되어 있습니다.`
    : `Plan recorded. Now I'll inspect the **workspace** with the read-only file tool. Reads are scoped to the workspace root.`;
}

function demoMemory(ko) {
  return ko
    ? `파일 목록을 확인했습니다. 다음은 **메모리**입니다. 세션과 무관하게 유지되는 내용을 검색합니다.`
    : `Workspace checked. Next, **memory** — durable notes that survive across sessions.`;
}

function demoFinal(ko) {
  return ko
    ? `둘러보기는 여기까지입니다. 방금 실제로 일어난 일은 다음과 같습니다.

1. \`todo_write\`가 세션 계획을 저장했습니다.
2. \`list_dir\`이 워크스페이스를 읽었습니다.
3. \`memory_search\`가 장기 메모리를 조회했습니다.

우측 레일의 **Plan**이 갱신된 것도 확인해 보세요. 도구 호출은 승인 정책을 따르며, 파일 쓰기나 명령 실행은 기본적으로 승인을 요청합니다.

이제 실제 모델을 연결하면 같은 루프가 코드베이스 전체로 확장됩니다. **Models**에서 키를 추가하거나 로컬 Ollama를 연결해 보세요.`
    : `That's the tour. Three real things just happened:

1. \`todo_write\` saved a plan to this session.
2. \`list_dir\` read your workspace, scoped to its root.
3. \`memory_search\` queried durable memory.

Notice the **Plan** update in the right rail. Tool calls respect the approval policy — writes and commands ask first by default.

Connect a hosted model and this same loop extends across your codebase. Add a key in **Models**, or point Blank at a local runtime like Ollama.`;
}

function features(ko) {
  return ko
    ? `**Blank**는 조용한 에이전트 하네스입니다. 앞단의 채팅 UI보다, 아래의 루프가 핵심입니다.

- **모델 독립적**: OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral, Groq, Together, OpenRouter, Cerebras, Ollama, LM Studio — 그리고 OpenAI 호환 커스텀 엔드포인트.
- **실제 도구**: 파일 읽기/쓰기/편집, glob, grep, 셸 실행, 웹 페치, 계획, 메모리, 스킬, MCP, 서브에이전트.
- **승인 게이트**: 쓰기와 명령 실행은 기본적으로 확인을 요청합니다. 한 번 허용, 세션 허용, 거부.
- **스킬**: 폴더 기반 \`SKILL.md\`. 필요할 때만 본문을 로드합니다.
- **메모리**: 대화와 무관하게 유지되는 사실과 선호. 관련 있을 때 자동으로 컨텍스트에 주입됩니다.
- **자기개선**: 세션을 돌아보고 메모리·스킬·지침 개선안을 제안합니다. 적용은 당신이 결정합니다.
- **되돌리기**: 파일 변경 전 체크포인트를 저장해 한 번에 복원할 수 있습니다.
- **IDE & CLI**: 동일한 코어를 공유하는 터미널 REPL과 에디터 연동.

투어를 원하시면 **"show me a tour"**라고 입력하세요. 실제 도구 호출이 실행됩니다.`
    : `**Blank** is a quiet agent harness. The chat is the surface; the loop underneath is the product.

- **Model-agnostic** — OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral, Groq, Together, OpenRouter, Cerebras, Ollama, LM Studio, plus any OpenAI-compatible endpoint.
- **Real tools** — read, write, edit, glob, grep, shell, web fetch, plans, memory, skills, MCP, and sub-agents.
- **Approval gates** — writes and commands ask first. Allow once, allow for the session, or deny.
- **Skills** — folders with a \`SKILL.md\`; only loaded into context when relevant.
- **Memory** — durable facts and preferences, automatically recalled when they matter.
- **Self-improvement** — reflections propose memory, skill, and instruction updates. You approve every change.
- **Checkpoints** — every file mutation can be restored, even after a reload.
- **IDE & CLI** — the same core in a terminal REPL and editor workflows.

Type **"show me a tour"** to exercise the real tool loop.`;
}

function connect(ko) {
  return ko
    ? `모델 연결은 두 가지 방식입니다.

**클라우드 모델**
1. 왼쪽 사이드바에서 **Models**를 엽니다.
2. 제공자 카드에 API 키를 붙여넣고 Enter. 키는 이 기기의 \`~/.blank/config.json\`에만 저장됩니다.
3. 기본 모델을 선택하면 다음 메시지부터 적용됩니다.

**로컬 모델**
- Ollama: \`ollama serve\` 실행 후 Blank에서 Ollama 카드의 **Detect**를 누릅니다.
- LM Studio: 로컬 서버를 켜고 \`http://localhost:1234/v1\`로 연결합니다.
- 커스텀: **Add provider**에서 OpenAI 호환 base URL을 입력합니다.

키가 전혀 없어도 Sandbox로 앱의 모든 화면과 하네스 도구를 둘러볼 수 있습니다.`
    : `There are two ways to bring a model.

**Hosted**
1. Open **Models** in the sidebar.
2. Paste a key into a provider card and press Enter. Keys stay on this machine in \`~/.blank/config.json\`.
3. Pick a default model — it applies to your next message.

**Local**
- Ollama: run \`ollama serve\`, then hit **Detect** on the Ollama card.
- LM Studio: start its local server and point Blank at \`http://localhost:1234/v1\`.
- Anything else OpenAI-compatible: use **Add provider**.

No key at all is fine — Sandbox can walk you through every screen and exercise the harness tools.`;
}

function rememberReply(ko, text) {
  return ko
    ? `기억해 두겠습니다.\n\n> ${text}\n\n장기 메모리에 저장했어요. 다음 세션에서도 관련 있을 때 자동으로 참고합니다. Memory 화면에서 수정하거나 고정할 수 있습니다.`
    : `Noted.\n\n> ${text}\n\nSaved to durable memory. I'll recall it in future sessions when it's relevant. You can edit or pin it from the Memory screen.`;
}

function fileReply(ko, listing) {
  return ko
    ? `워크스페이스를 읽었습니다.\n\n\`\`\`\n${listing}\n\`\`\`\n\n파일 도구는 워크스페이스 루트 안으로 제한됩니다. 실제 모델을 연결하면 필요한 파일만 골라 읽고 수정할 수 있어요.`
    : `Read the workspace.\n\n\`\`\`\n${listing}\n\`\`\`\n\nFile tools are scoped to the workspace root. With a hosted model connected, I can inspect only the files that matter and make targeted edits.`;
}

function fallback(ko) {
  return ko
    ? `지금은 **Sandbox** 미리보기 모드입니다. 실제 추론 없이 고정된 응답을 제공해요.

할 수 있는 것:
- **"투어 보여줘"** — 실제 도구 호출로 하네스 루프 시연
- **"파일 목록 보여줘"** — 워크스페이스 읽기
- **"X 기억해"** — 장기 메모리 저장
- **Models**에서 실제 모델 연결

실제 모델을 연결하면 이 대화가 코드 작성, 디버깅, 리팩터링, MCP 도구 실행으로 이어집니다.`
    : `I'm in **Sandbox** preview mode right now — fixed, offline responses, no real reasoning.

Try:
- **"show me a tour"** — exercise the real tool loop
- **"list the files"** — read this workspace
- **"remember that ..."** — save a durable memory
- **Models** — connect a hosted or local model

With a real model connected, this same thread becomes code changes, debugging, refactors, and MCP tool calls.`;
}

function extractRemember(text) {
  const match = text.match(/(?:remember(?: that)?|기억해[줘]?[:,]?)\s+(.+)/i);
  return match ? match[1].trim().replace(/[.!?]$/, '') : '';
}

async function* sandboxStream({ messages, tools = [], signal, options = {} }) {
  const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user');
  const userMessage = lastUserIndex >= 0 ? messages[lastUserIndex] : { content: '' };
  const userText = textOf(userMessage);
  const after = messages.slice(lastUserIndex + 1);
  const toolResults = after.filter((m) => m.role === 'tool');
  const ko = hasHangul(userText);
  const toolNames = new Set(tools.map((t) => t.name));
  const lower = userText.toLowerCase();

  const wantsTour = /tour|show me around|what can (you|blank) do|capabilities|features|도구.*보여|투어|둘러보|기능.*알려/.test(lower);
  const wantsFiles = /(list|show|read).*(files|workspace|directory|folder)|파일.*(목록|보여)|워크스페이스.*(보여|읽)/.test(lower);
  const rememberText = extractRemember(userText);
  const wantsRemember = Boolean(rememberText) && toolNames.has('remember');

  if (wantsTour && toolResults.length > 0) {
    if (toolResults.length === 1) {
      yield* streamText(demoWorkspace(ko), signal);
      if (toolNames.has('list_dir')) {
        yield { type: 'tool_calls', calls: [toolCall(`call_sandbox_list_${Date.now()}`, 'list_dir', { path: '.' })] };
        yield { type: 'done', finished: true };
        return;
      }
    } else if (toolResults.length === 2) {
      yield* streamText(demoMemory(ko), signal);
      if (toolNames.has('memory_search')) {
        yield { type: 'tool_calls', calls: [toolCall(`call_sandbox_mem_${Date.now()}`, 'memory_search', { query: 'preferences and project context' })] };
        yield { type: 'done', finished: true };
        return;
      }
    }
    yield* streamText(demoFinal(ko), signal);
    yield { type: 'done', finished: true };
    return;
  }

  if (wantsTour) {
    yield* streamText(demoIntro(ko), signal);
    if (toolNames.has('todo_write')) {
      yield {
        type: 'tool_calls',
        calls: [toolCall(`call_sandbox_todo_${Date.now()}`, 'todo_write', {
          todos: [
            { content: 'Inspect the workspace', status: 'in_progress' },
            { content: 'Recall durable memory', status: 'pending' },
            { content: 'Connect a hosted model', status: 'pending' },
          ],
        })],
      };
    } else {
      yield { type: 'text', text: demoFinal(ko) };
    }
    yield { type: 'done', finished: true };
    return;
  }

  if (wantsRemember) {
    yield { type: 'tool_calls', calls: [toolCall(`call_sandbox_remember_${Date.now()}`, 'remember', { text: rememberText })] };
    const result = messages.slice(lastUserIndex).find((m) => m.role === 'tool' && m.name === 'remember');
    if (result) {
      yield* streamText(rememberReply(ko, rememberText), signal);
    }
    yield { type: 'done', finished: true };
    return;
  }

  if (wantsFiles && toolResults.length > 0) {
    const result = toolResults[toolResults.length - 1];
    const listing = String(result.content || '').split('\n').slice(0, 40).join('\n') || '(empty workspace)';
    yield* streamText(fileReply(ko, listing), signal);
    yield { type: 'done', finished: true };
    return;
  }

  if (wantsFiles) {
    yield* streamText(ko ? '워크스페이스를 읽어보겠습니다.' : 'Let me read the workspace.', signal);
    if (toolNames.has('list_dir')) {
      yield { type: 'tool_calls', calls: [toolCall(`call_sandbox_files_${Date.now()}`, 'list_dir', { path: '.' })] };
    } else {
      yield { type: 'text', text: fallback(ko) };
    }
    yield { type: 'done', finished: true };
    return;
  }

  if (/^(hi|hello|hey|yo|안녕|반가워|하이)[\s!.?]*$/i.test(userText.trim()) || /^(hi|hello|hey)[,!.\s]/i.test(userText.trim())) {
    yield* streamText(greeting(ko), signal);
    yield { type: 'done', finished: true };
    return;
  }

  if (/(connect|api key|model|provider|ollama|lm studio|모델|키|연결)/i.test(userText)) {
    yield* streamText(connect(ko), signal);
    yield { type: 'done', finished: true };
    return;
  }

  if (/(skill|스킬)/i.test(userText)) {
    yield* streamText(ko
      ? `스킬은 재사용 가능한 작업 절차입니다. \`SKILL.md\` 하나가 곧 하나의 스킬이에요.\n\n- 내장 스킬 4개가 기본 제공됩니다: **Code review**, **Debug**, **Research**, **Ship**.\n- \`~/.blank/skills/<name>/SKILL.md\`에 직접 추가하거나, **Skills → New skill**에서 만들 수 있습니다.\n- 모든 스킬의 이름과 설명은 시스템 프롬프트에 포함되지만, 본문은 필요할 때 \`read_skill\`로 불러옵니다. 컨텍스트를 낭비하지 않는 방식입니다.\n\nSkills 화면에서 지금 바로 만들어 볼 수 있습니다.`
      : `Skills are reusable procedures. One folder with a \`SKILL.md\` is a skill.\n\n- Four are bundled: **Code review**, **Debug**, **Research**, **Ship**.\n- Add your own at \`~/.blank/skills/<name>/SKILL.md\`, or use **Skills → New skill**.\n- Names and descriptions sit in the system prompt; the body is loaded on demand with \`read_skill\`, so it never wastes context.\n\nYou can draft one from the Skills screen right now.`, signal);
    yield { type: 'done', finished: true };
    return;
  }

  if (/(memory|메모리|기억)/i.test(userText)) {
    yield* streamText(ko
      ? `메모리는 세션 밖에서도 유지되는 작은 사실 저장소입니다.\n\n- 에이전트가 \`remember\`로 저장하고 \`memory_search\`로 조회합니다.\n- 새 메시지에서 관련 있는 메모리를 자동으로 골라 시스템 프롬프트에 넣습니다.\n- **Memory** 화면에서 직접 추가·수정·고정할 수 있습니다.\n- Learning에서 세션을 돌아본 뒤 메모리 후보를 제안할 수도 있습니다.\n\n"X를 기억해"라고 말해보세요. 실제로 저장됩니다.`
      : `Memory is a small store of durable facts that outlives a session.\n\n- The agent writes with \`remember\` and reads with \`memory_search\`.\n- Relevant memories are automatically injected into the system prompt for new messages.\n- Add, edit, or pin notes directly from the **Memory** screen.\n- Learning can reflect on recent sessions and propose new memories.\n\nTry “remember that ...”, and it will actually be saved.`, signal);
    yield { type: 'done', finished: true };
    return;
  }

  if (/(mcp|server)/i.test(userText)) {
    yield* streamText(ko
      ? `MCP 서버는 \`~/.blank/config.json\`에 저장되고, 세션 시작 시 연결됩니다.\n\n- **MCP → Add server**에서 stdio 명령 또는 HTTP URL을 등록합니다.\n- 서버의 도구는 \`mcp__server__tool\` 형식으로 모델에 노출됩니다.\n- MCP 도구는 기본적으로 승인을 요청합니다.\n- 예제 에코 서버를 내장해 두었으니 **Add example**로 연결을 바로 확인할 수 있습니다.`
      : `MCP servers live in \`~/.blank/config.json\` and connect per session.\n\n- Add a stdio command or HTTP endpoint from **MCP → Add server**.\n- Server tools surface to the model as \`mcp__server__tool\`.\n- MCP calls ask for approval by default.\n- A bundled echo server is included — use **Add example** to verify the loop.`, signal);
    yield { type: 'done', finished: true };
    return;
  }

  if (/(cli|terminal|ide|vscode|커맨드|터미널)/i.test(userText)) {
    yield* streamText(ko
      ? `Blank의 CLI는 앱과 같은 코어를 사용합니다.\n\n\`\`\`bash\nnpm install\nnode bin/blank.js              # 대화형 REPL\nnode bin/blank.js run "..."    # 원샷 실행\nnode bin/blank.js models       # 모델 확인\nnode bin/blank.js mcp list     # MCP 상태\n\`\`\`\n\nSettings → Connect에서 CLI 바로가기를 설치하고, 에디터 작업 지침 파일(AGENTS.md)을 생성할 수 있습니다. 세션은 앱과 CLI가 공유합니다.`
      : `Blank's CLI shares the exact same core as the desktop app.\n\n\`\`\`bash\nnpm install\nnode bin/blank.js              # interactive REPL\nnode bin/blank.js run "..."    # one-shot\nnode bin/blank.js models       # inspect catalog\nnode bin/blank.js mcp list     # MCP status\n\`\`\`\n\nInstall a shell command and generate an editor instruction file (AGENTS.md) from Settings → Connect. Sessions are shared between app and CLI.`, signal);
    yield { type: 'done', finished: true };
    return;
  }

  yield* streamText(fallback(ko), signal);
  yield { type: 'done', finished: true };
}

module.exports = { sandboxStream };
