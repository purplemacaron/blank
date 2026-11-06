'use strict';

(function () {
  const body = document.body;
  const pet = document.getElementById('pet');
  const menu = document.getElementById('menu');
  const bubbleText = document.getElementById('bubble-text');
  const compose = document.getElementById('compose');
  const composeInput = document.getElementById('compose-input');
  const composeSend = document.getElementById('compose-send');
  const petIdMain = document.getElementById('pet-id-main');
  const petIdSub = document.getElementById('pet-id-sub');

  const COPY = {
    ko: {
      name: 'blank memo',
      working: '작업 중이에요',
      reading: '파일을 살펴보는 중',
      editing: '파일을 고치는 중',
      command: '명령을 실행하는 중',
      checking: '검사하는 중',
      search: '찾아보는 중',
      media: '만드는 중',
      computer: '화면을 조작하는 중',
      team: '함께 일하는 중',
      waiting: '확인해 주세요',
      done: '다 됐어요',
      error: '문제가 생겼어요',
      open: 'blank 열기',
      reset: '위치 초기화',
      hide: 'blank memo 숨기기',
      label: '클릭해서 지시를 입력하세요.',
      compose: '지시를 입력…',
      composeLabel: 'blank memo에게 보낼 지시',
      send: '보내기',
      sent: '맡겨 두세요',
      failed: '보내지 못했어요',
      noModel: '모델을 먼저 연결해 주세요',
    },
    en: {
      name: 'blank memo',
      working: 'Working',
      reading: 'Reading files',
      editing: 'Editing a file',
      command: 'Running a command',
      checking: 'Running checks',
      search: 'Looking things up',
      media: 'Creating media',
      computer: 'Using the computer',
      team: 'Working with the team',
      waiting: 'Needs your review',
      done: 'All done',
      error: 'Something went wrong',
      open: 'Open blank',
      reset: 'Reset position',
      hide: 'Hide blank memo',
      label: 'Click to type an instruction.',
      compose: 'Type an instruction…',
      composeLabel: 'Instruction for blank memo',
      send: 'Send',
      sent: 'On it',
      failed: 'Could not send that',
      noModel: 'Connect a model first',
    },
  };

  const TOOL_COPY = {
    read_file: 'reading',
    list_dir: 'reading',
    glob: 'reading',
    grep: 'reading',
    project_map: 'reading',
    git_diff: 'reading',
    read_paper: 'reading',
    list_papers: 'reading',
    read_skill: 'reading',
    write_file: 'editing',
    edit_file: 'editing',
    deliver_file: 'editing',
    run_command: 'command',
    ssh_run: 'command',
    run_checks: 'checking',
    web_search: 'search',
    web_fetch: 'search',
    memory_search: 'search',
    generate_media: 'media',
    edit_media: 'media',
    list_media: 'media',
    list_media_engines: 'media',
    computer_use: 'computer',
    computer_screenshot: 'computer',
    delegate: 'team',
    delegate_many: 'team',
    team_delegate: 'team',
    agent: 'team',
  };

  let lang = 'ko';
  let theme = 'light';
  let state = 'idle';
  let idleTimer = 0;
  let activeRuns = new Set();
  let approvalPending = false;
  let interactive = false;
  let menuOpen = false;
  let composeOpen = false;
  let menuTimer = 0;
  let drag = null;
  let defaultModel = '';
  let currentModel = '';
  let identity = { model: '', modelName: '', providerName: '' };

  const copy = () => COPY[lang];

  function applyPalette(palette) {
    if (!palette) return;
    const root = document.body.style;
    root.setProperty('--paper-bg', palette.paper);
    root.setProperty('--paper-fold', palette.fold);
    root.setProperty('--paper-edge', palette.edge);
    root.setProperty('--paper-ink', palette.ink);
    root.setProperty('--paper-glow', palette.glow);
  }

  async function colorFor(model) {
    if (!window.Pet.palette) return;
    try {
      const palette = await window.Pet.palette(model, theme);
      if (palette) applyPalette(palette);
    } catch {}
  }

  function resetToDefaultModel() {
    currentModel = defaultModel;
    colorFor(currentModel);
  }

  function setState(next, text) {
    state = next;
    body.dataset.state = next;
    bubbleText.textContent = text || '';
    clearTimeout(idleTimer);
    if (next === 'done') {
      idleTimer = setTimeout(() => {
        setState('idle');
        resetToDefaultModel();
      }, 3200);
    } else if (next === 'error') {
      idleTimer = setTimeout(() => {
        setState('idle');
        resetToDefaultModel();
      }, 4400);
    }
  }

  function toolCopy(name) {
    const key = TOOL_COPY[name] || 'working';
    return copy()[key] || copy().working;
  }

  function identityText() {
    const modelName = identity.modelName || identity.model;
    const sub = [identity.providerName, modelName].filter(Boolean).join(' · ');
    return { main: copy().name, sub: sub || copy().noModel };
  }

  function renderIdentity() {
    const who = identityText();
    petIdMain.textContent = who.main;
    petIdSub.textContent = who.sub;
    petIdSub.hidden = !who.sub;
    const parts = [who.main, who.sub, copy().label].filter(Boolean);
    pet.setAttribute('aria-label', parts.join(' · '));
    document.title = copy().name;
  }

  function applyCopy() {
    document.documentElement.lang = lang;
    pet.setAttribute('aria-label', copy().label);
    renderIdentity();
    composeInput.placeholder = copy().compose;
    composeInput.setAttribute('aria-label', copy().composeLabel);
    composeSend.setAttribute('aria-label', copy().send);
    for (const key of ['open', 'reset', 'hide']) {
      const node = menu.querySelector(`[data-menu-label="${key}"]`);
      if (node) node.textContent = copy()[key];
    }
    if (state === 'working') bubbleText.textContent = copy().working;
    else if (state === 'waiting') bubbleText.textContent = copy().waiting;
    else if (state === 'done') bubbleText.textContent = copy().done;
    else if (state === 'error') bubbleText.textContent = copy().error;
  }

  async function refreshConfig() {
    try {
      const info = await window.Pet.init();
      if (!info) return;
      lang = info.language === 'en' ? 'en' : 'ko';
      theme = info.theme === 'dark' ? 'dark' : 'light';
      defaultModel = info.model || '';
      identity = {
        model: String(info.model || ''),
        modelName: String(info.modelName || info.model || ''),
        providerName: String(info.providerName || ''),
      };
      if (!activeRuns.size) currentModel = defaultModel;
      body.dataset.theme = theme;
      applyCopy();
      colorFor(currentModel);
    } catch {}
  }

  function handleEvent(event) {
    if (!event || !event.type) return;
    switch (event.type) {
      case 'run:start':
        activeRuns.add(event.runId || event.sessionId || 'run');
        approvalPending = false;
        if (event.model) {
          currentModel = event.model;
          colorFor(currentModel);
          if (event.model !== identity.model) refreshConfig();
        }
        setState('working', copy().working);
        break;
      case 'tool:start':
        if (approvalPending) break;
        setState('working', toolCopy(event.name));
        break;
      case 'tool:end':
        if (approvalPending) break;
        if (activeRuns.size) setState('working', copy().working);
        break;
      case 'agent:start':
        if (approvalPending) break;
        if (event.model) {
          currentModel = event.model;
          colorFor(currentModel);
        }
        setState('working', event.name ? `${event.name} · ${copy().working}` : copy().team);
        break;
      case 'approval':
        approvalPending = true;
        setState('waiting', copy().waiting);
        break;
      case 'approval:resolved':
      case 'approval:expired':
        approvalPending = false;
        if (activeRuns.size) setState('working', copy().working);
        else {
          setState('idle');
          resetToDefaultModel();
        }
        break;
      case 'error':
        setState('error', copy().error);
        break;
      case 'run:done': {
        activeRuns.delete(event.runId || event.sessionId || 'run');
        const outcome = event.outcome || {};
        if (approvalPending) break;
        if (activeRuns.size) {
          setState('working', copy().working);
          break;
        }
        if (outcome.ok && !outcome.stopped) setState('done', copy().done);
        else if (outcome.stopped || (!outcome.ok && !outcome.error)) {
          setState('idle');
          resetToDefaultModel();
        } else setState('error', copy().error);
        break;
      }
      case 'config:updated':
        refreshConfig();
        break;
      default:
        break;
    }
  }

  /* --------------------------------------------------------------- pointer */

  function setInteractive(next) {
    const value = Boolean(next);
    if (value === interactive) return;
    interactive = value;
    window.Pet.interactive(value).catch(() => {});
  }

  function overPet(target) {
    return Boolean(target && target.closest && target.closest('.pet, .pet-menu, .pet-compose'));
  }

  document.addEventListener('mousemove', (event) => {
    setInteractive(overPet(event.target) || menuOpen || composeOpen);
  });

  document.documentElement.addEventListener('mouseleave', () => {
    if (drag) return;
    setInteractive(false);
    if (menuOpen) hideMenu();
  });

  /* ------------------------------------------------------------------ menu */

  function hideMenu() {
    menuOpen = false;
    menu.hidden = true;
    clearTimeout(menuTimer);
  }

  function openMenu() {
    closeCompose();
    menuOpen = true;
    menu.hidden = false;
    setInteractive(true);
    clearTimeout(menuTimer);
    menuTimer = setTimeout(hideMenu, 6000);
  }

  pet.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openMenu();
  });

  document.addEventListener('pointerdown', (event) => {
    if (menuOpen && !event.target.closest('.pet-menu')) hideMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (composeOpen) {
      event.preventDefault();
      closeCompose();
      return;
    }
    hideMenu();
  });

  menu.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-menu]');
    if (!button) return;
    const action = button.dataset.menu;
    hideMenu();
    if (action === 'open') await window.Pet.open().catch(() => {});
    else if (action === 'reset') await window.Pet.reset().catch(() => {});
    else if (action === 'hide') {
      closeCompose();
      await window.Pet.hide().catch(() => {});
    }
  });

  /* --------------------------------------------------------------- composer */

  async function openCompose() {
    if (composeOpen) return;
    hideMenu();
    composeOpen = true;
    body.classList.add('composing');
    compose.hidden = false;
    composeInput.placeholder = copy().compose;
    composeInput.value = '';
    setInteractive(true);
    try { await window.Pet.focus(true); } catch {}
    composeInput.focus();
    composeInput.select();
  }

  function closeCompose() {
    if (!composeOpen) return;
    composeOpen = false;
    body.classList.remove('composing');
    compose.hidden = true;
    composeInput.blur();
    window.Pet.focus(false).catch(() => {});
    setInteractive(overPet(document.body));
  }

  compose.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = composeInput.value.trim();
    if (!text) {
      composeInput.focus();
      return;
    }
    composeSend.disabled = true;
    try {
      const result = await window.Pet.prompt(text);
      if (!result || result.ok === false) {
        closeCompose();
        setState('error', copy()[result?.code === 'no-model' ? 'noModel' : 'failed']);
        return;
      }
      composeInput.value = '';
      closeCompose();
      setState('working', copy().sent);
    } catch {
      closeCompose();
      setState('error', copy().failed);
    } finally {
      composeSend.disabled = false;
    }
  });

  /* ------------------------------------------------------------------- drag */

  function flushDrag() {
    if (!drag || drag.busy || !drag.hasDelta) return;
    drag.busy = true;
    const dx = drag.dx;
    const dy = drag.dy;
    drag.dx = 0;
    drag.dy = 0;
    drag.hasDelta = false;
    const target = { x: drag.actual.x + dx, y: drag.actual.y + dy };
    window.Pet.move(target).then((actual) => {
      if (!drag) return;
      if (actual) drag.actual = actual;
      drag.busy = false;
      if (drag.hasDelta) flushDrag();
    }).catch(() => {
      if (drag) drag.busy = false;
    });
  }

  pet.addEventListener('pointerdown', async (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    hideMenu();
    setInteractive(true);
    try { pet.setPointerCapture(event.pointerId); } catch {}
    pet.classList.add('dragging');
    let position = { x: 0, y: 0 };
    try { position = await window.Pet.position(); } catch {}
    if (!position) position = { x: 0, y: 0 };
    drag = {
      id: event.pointerId,
      lastX: event.screenX,
      lastY: event.screenY,
      startX: event.screenX,
      startY: event.screenY,
      actual: { x: Number(position.x) || 0, y: Number(position.y) || 0 },
      dx: 0,
      dy: 0,
      hasDelta: false,
      busy: false,
      moved: false,
    };
  });

  pet.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.screenX - drag.lastX;
    const dy = event.screenY - drag.lastY;
    if (!dx && !dy) return;
    drag.lastX = event.screenX;
    drag.lastY = event.screenY;
    drag.dx += dx;
    drag.dy += dy;
    drag.hasDelta = true;
    if (!drag.moved && Math.abs(event.screenX - drag.startX) + Math.abs(event.screenY - drag.startY) > 4) {
      drag.moved = true;
    }
    if (drag.moved) flushDrag();
  });

  pet.addEventListener('pointerup', async (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const current = drag;
    pet.classList.remove('dragging');
    try { pet.releasePointerCapture(event.pointerId); } catch {}
    if (!current.moved) {
      drag = null;
      if (composeOpen) closeCompose();
      else await openCompose();
      return;
    }
    const started = Date.now();
    while (current.busy || current.hasDelta) {
      if (!current.busy && current.hasDelta) flushDrag();
      if (Date.now() - started > 600) break;
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    const final = { ...current.actual };
    drag = null;
    await window.Pet.save(final).catch(() => {});
  });

  pet.addEventListener('pointercancel', () => {
    if (!drag) return;
    drag = null;
    pet.classList.remove('dragging');
  });

  /* ------------------------------------------------------------------ boot */

  window.Pet.onEvent(handleEvent);
  refreshConfig();
  setState('idle');
})();
