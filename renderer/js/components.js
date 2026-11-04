/* Shared interface primitives: modals, toasts, popovers, small controls. */
(function () {
  'use strict';

  const modalRoot = () => document.getElementById('modal-root');
  const toastRoot = () => document.getElementById('toast-root');
  const overlayRoot = () => document.getElementById('overlay-root');
  const stack = [];

  function lockScroll() {
    document.body.classList.add('modal-open');
  }
  function unlockScroll() {
    if (!stack.length) document.body.classList.remove('modal-open');
  }

  function modal({ title, description, body, footer, size, className, dismissible = true, onClose, onMount, headerExtra }) {
    const layer = document.createElement('div');
    layer.className = 'modal-layer';
    const bodyNode = body instanceof Node ? body : null;
    const footerNode = footer instanceof Node ? footer : null;
    layer.innerHTML = `
      <div class="modal-backdrop" data-modal-backdrop></div>
      <div class="modal ${size === 'wide' ? 'modal-wide' : ''} ${size === 'large' ? 'modal-large' : ''} ${className || ''}" role="dialog" aria-modal="true">
        <header class="modal-head">
          <div class="modal-head-copy">
            <h2>${U.esc(title || '')}</h2>
            ${description ? `<p>${U.esc(description)}</p>` : ''}
          </div>
          <div class="modal-head-extra">${headerExtra || ''}</div>
          ${dismissible ? `<button class="modal-close" type="button" data-modal-close aria-label="Close">${icon('x', 16)}</button>` : ''}
        </header>
        <div class="modal-body"></div>
        ${footer ? '<footer class="modal-foot"></footer>' : ''}
      </div>`;
    const modalNode = layer.querySelector('.modal');
    const bodyHost = layer.querySelector('.modal-body');
    if (bodyNode) bodyHost.append(bodyNode);
    else bodyHost.innerHTML = body || '';
    if (footer) {
      const footHost = layer.querySelector('.modal-foot');
      if (footerNode) footHost.append(footerNode);
      else footHost.innerHTML = footer;
    }
    modalRoot().appendChild(layer);
    Icons.hydrate(layer);
    lockScroll();
    requestAnimationFrame(() => layer.classList.add('in'));

    const entry = { layer, modalNode, close, dismissible };
    stack.push(entry);

    function close(result) {
      if (!entry.open) return;
      entry.open = false;
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      layer.classList.remove('in');
      layer.classList.add('out');
      setTimeout(() => {
        layer.remove();
        unlockScroll();
        if (onClose) onClose(result);
      }, 150);
    }
    entry.open = true;

    const onClick = (event) => {
      if (event.target.closest('[data-modal-close]')) { close(); return; }
      if (event.target.matches('[data-modal-backdrop]') && dismissible) close();
    };
    layer.addEventListener('click', onClick);

    onMount?.(modalNode, close);
    setTimeout(() => {
      const focusable = modalNode.querySelector('input:not([type=hidden]), textarea, select, button:not([data-modal-close])');
      (focusable || modalNode).focus({ preventScroll: true });
    }, 80);

    return { element: modalNode, close };
  }

  function closeTopModal() {
    const entry = stack[stack.length - 1];
    if (!entry) return false;
    if (!entry.dismissible) return true;
    entry.close();
    return true;
  }

  function toast(message, type = 'info', options = {}) {
    const node = document.createElement('div');
    node.className = `toast toast-${type}`;
    const iconName = { success: 'check-circle', error: 'alert-circle', warn: 'alert-triangle', info: 'sparkles' }[type] || 'sparkles';
    node.innerHTML = `<span class="toast-icon">${icon(iconName, 16)}</span><div class="toast-copy">${options.title ? `<strong>${U.esc(options.title)}</strong>` : ''}<span>${U.esc(message)}</span></div>${options.actionLabel ? `<button class="toast-action" type="button">${U.esc(options.actionLabel)}</button>` : ''}<button class="toast-close" type="button" aria-label="Dismiss">${icon('x', 13)}</button>`;
    const remove = () => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 180);
    };
    node.querySelector('.toast-close').addEventListener('click', remove);
    if (options.actionLabel && options.onAction) {
      node.querySelector('.toast-action').addEventListener('click', () => {
        options.onAction();
        remove();
      });
    }
    toastRoot().appendChild(node);
    requestAnimationFrame(() => node.classList.add('in'));
    if (options.timeout !== 0) setTimeout(remove, options.timeout || 4200);
    return { close: remove };
  }

  let activePopover = null;
  function closePopover() {
    if (!activePopover) return;
    activePopover.layer.remove();
    activePopover = null;
    document.removeEventListener('mousedown', activePopoverOutside, true);
    window.removeEventListener('resize', activePopoverReposition);
    window.removeEventListener('scroll', activePopoverReposition, true);
    if (!stack.length) document.body.classList.remove('popover-open');
  }
  let activePopoverOutside = () => {};
  let activePopoverReposition = () => {};

  function popover(anchor, content, options = {}) {
    closePopover();
    const layer = document.createElement('div');
    layer.className = 'popover-layer';
    layer.innerHTML = `<div class="popover ${options.className || ''}" role="dialog">${typeof content === 'string' ? content : ''}</div>`;
    const pop = layer.querySelector('.popover');
    if (content instanceof Node) pop.appendChild(content);
    overlayRoot().appendChild(layer);
    Icons.hydrate(layer);
    document.body.classList.add('popover-open');

    function position() {
      if (!anchor || !anchor.isConnected) { closePopover(); return; }
      const rect = anchor.getBoundingClientRect();
      const width = pop.offsetWidth;
      const height = pop.offsetHeight;
      const gap = options.gap ?? 6;
      const align = options.align || 'start';
      let left;
      if (options.side === 'right') left = rect.right + gap;
      else if (align === 'end') left = rect.right - width;
      else if (align === 'center') left = rect.left + rect.width / 2 - width / 2;
      else left = rect.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      let top;
      if (options.side === 'right') top = rect.top;
      else if (options.placement === 'top') top = rect.top - height - gap;
      else top = rect.bottom + gap;
      if (top + height > window.innerHeight - 8) {
        const above = rect.top - height - gap;
        top = above >= 8 ? above : Math.max(8, window.innerHeight - height - 8);
      }
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
      pop.dataset.placement = top < rect.top ? 'top' : 'bottom';
    }

    activePopover = { layer, close: closePopover, anchor };
    activePopoverOutside = (event) => {
      if (!layer.contains(event.target) && !anchor.contains(event.target)) closePopover();
    };
    activePopoverReposition = () => position();
    setTimeout(() => {
      position();
      pop.classList.add('in');
    }, 0);
    document.addEventListener('mousedown', activePopoverOutside, true);
    window.addEventListener('resize', activePopoverReposition);
    window.addEventListener('scroll', activePopoverReposition, true);

    layer.addEventListener('click', (event) => {
      if (event.target === layer) closePopover();
    });
    return { element: pop, close: closePopover, reposition: position };
  }

  function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, detail }) {
    return new Promise((resolve) => {
      let decided = false;
      const body = `
        <p class="confirm-copy">${U.esc(message)}</p>
        ${detail ? `<div class="confirm-detail">${U.esc(detail)}</div>` : ''}`;
      const footer = `
        <button class="btn btn-ghost" type="button" data-cancel>${U.esc(cancelLabel)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-confirm>${U.esc(confirmLabel)}</button>`;
      const handle = modal({
        title, body, footer, size: 'small', className: 'modal-confirm',
        onClose: () => { if (!decided) resolve(false); },
        onMount(node, close) {
          node.querySelector('[data-cancel]').addEventListener('click', () => { decided = true; close(); resolve(false); });
          node.querySelector('[data-confirm]').addEventListener('click', () => { decided = true; close(); resolve(true); });
        },
      });
      return handle;
    });
  }

  function promptDialog({ title, description, label, value = '', placeholder = '', multiline = false, confirmLabel = 'Save', validate }) {
    return new Promise((resolve) => {
      let decided = false;
      const field = multiline
        ? `<textarea class="field-textarea" data-field rows="5" placeholder="${U.attr(placeholder)}">${U.esc(value)}</textarea>`
        : `<input class="field-input" data-field type="text" value="${U.attr(value)}" placeholder="${U.attr(placeholder)}" />`;
      const body = `<label class="field"><span>${U.esc(label || 'Value')}</span>${field}<small class="field-error" data-error hidden></small></label>`;
      const footer = `<button class="btn btn-ghost" type="button" data-cancel>Cancel</button><button class="btn btn-primary" type="button" data-confirm>${U.esc(confirmLabel)}</button>`;
      modal({
        title, description, body, footer, size: 'small', className: 'modal-prompt',
        onClose: () => { if (!decided) resolve(null); },
        onMount(node, close) {
          const input = node.querySelector('[data-field]');
          const error = node.querySelector('[data-error]');
          setTimeout(() => { input.focus(); input.select(); }, 60);
          const submit = () => {
            const next = input.value.trim();
            if (validate) {
              const problem = validate(next);
              if (problem) { error.textContent = problem; error.hidden = false; return; }
            }
            decided = true;
            close();
            resolve(next);
          };
          node.querySelector('[data-confirm]').addEventListener('click', submit);
          node.querySelector('[data-cancel]').addEventListener('click', () => { decided = true; close(); resolve(null); });
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); }
          });
        },
      });
    });
  }

  function menu(anchor, items, options = {}) {
    const list = document.createElement('div');
    list.className = 'menu';
    let html = '';
    const rows = [];
    for (const item of items) {
      if (item.separator) { html += '<div class="menu-sep"></div>'; continue; }
      if (item.heading) { html += `<div class="menu-heading">${U.esc(item.heading)}</div>`; continue; }
      const index = rows.length;
      rows.push(item);
      html += `<button class="menu-item ${item.danger ? 'danger' : ''} ${item.active ? 'active' : ''}" type="button" data-menu-index="${index}" data-key="${U.attr(item.key || '')}" ${item.disabled ? 'disabled' : ''}>
        <span class="menu-icon">${item.icon ? icon(item.icon, 15) : ''}</span>
        <span class="menu-label">${U.esc(item.label)}</span>
        ${item.shortcut ? `<kbd class="menu-kbd">${U.esc(item.shortcut)}</kbd>` : ''}
        ${item.active ? icon('check', 14, 'menu-check') : ''}
      </button>`;
    }
    list.innerHTML = html;
    const handle = popover(anchor, list, { align: options.align || 'start', width: options.width });
    list.addEventListener('click', (event) => {
      const button = event.target.closest('.menu-item');
      if (!button || button.disabled) return;
      const item = rows[Number(button.dataset.menuIndex)];
      handle.close();
      item?.onClick?.();
    });
    return handle;
  }

  function providerMono(provider, extra) {
    if (!provider) return '<span class="pmono">?</span>';
    const logo = window.ProviderLogos?.for(provider);
    return `<span class="pmono pmono-${U.attr(provider.id)} ${logo ? 'has-logo' : ''} ${extra || ''}">${logo || U.esc(provider.monogram || provider.name?.slice(0, 1) || '•')}</span>`;
  }

  function switchHtml(checked, attrs = '') {
    return `<button class="switch ${checked ? 'on' : ''}" type="button" role="switch" aria-checked="${Boolean(checked)}" ${attrs}><span class="switch-thumb"></span></button>`;
  }

  function segmented(options, current, name) {
    return `<div class="segmented" ${name ? `data-segmented="${U.attr(name)}"` : ''}>${options.map((option) => `<button class="segment ${option.value === current ? 'active' : ''}" type="button" data-value="${U.attr(option.value)}" ${option.disabled ? 'disabled' : ''}>${option.icon ? icon(option.icon, 14) : ''}<span>${U.esc(option.label)}</span></button>`).join('')}</div>`;
  }

  function emptyState({ iconName = 'sparkles', title, description, actionHtml }) {
    return `<div class="empty-state"><div class="empty-icon">${icon(iconName, 22)}</div><h3>${U.esc(title)}</h3><p>${U.esc(description || '')}</p>${actionHtml ? `<div class="empty-actions">${actionHtml}</div>` : ''}</div>`;
  }

  function pageHeader({ title, actions, meta }) {
    return `<header class="page-head">
      <div class="page-head-copy">
        <div class="page-title-row"><h1>${U.esc(title)}</h1>${meta || ''}</div>
      </div>
      ${actions ? `<div class="page-actions">${actions}</div>` : ''}
    </header>`;
  }

  function field({ label, hint, control, id, error }) {
    return `<label class="field" ${id ? `for="${U.attr(id)}"` : ''}><span class="field-label">${U.esc(label)}${hint ? `<small>${U.esc(hint)}</small>` : ''}</span>${control}${error ? `<small class="field-error">${U.esc(error)}</small>` : ''}</label>`;
  }

  function bindSegmented(container, callback) {
    container.addEventListener('click', (event) => {
      const button = event.target.closest('.segment');
      if (!button || button.disabled) return;
      const parent = button.parentElement;
      for (const item of parent.querySelectorAll('.segment')) item.classList.toggle('active', item === button);
      callback?.(button.dataset.value);
    });
  }

  function timeAgoNode(iso) {
    return `<span class="time-ago" title="${U.attr(iso ? new Date(iso).toLocaleString() : '')}">${U.relativeTime(iso)}</span>`;
  }

  function bindCopyCode(root) {
    root.addEventListener('click', async (event) => {
      const button = event.target.closest('.js-copy-code');
      if (!button) return;
      const block = button.closest('.code-block');
      const code = block?.querySelector('code');
      if (!code) return;
      const ok = await U.copyText(code.textContent);
      button.classList.add('copied');
      const label = button.querySelector('span');
      if (label) label.textContent = ok ? 'Copied' : 'Failed';
      setTimeout(() => { button.classList.remove('copied'); if (label) label.textContent = 'Copy'; }, 1600);
    });
  }

  function openExternal(event) {
    const link = event.target.closest('a.md-link, a[data-external]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) return;
    event.preventDefault();
    window.API?.app.openExternal(href);
  }

  function iconBadge(name, tone = 'blue') {
    return `<span class="icon-badge ${tone}">${icon(name, 16)}</span>`;
  }

  function skeletonRows(count = 3) {
    return `<div class="skeleton-list">${Array.from({ length: count }).map(() => '<div class="skeleton-row"><span class="sk sk-avatar"></span><span class="sk sk-line"></span></div>').join('')}</div>`;
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (activePopover) { closePopover(); return; }
    if (stack.length) {
      event.preventDefault();
      closeTopModal();
    }
  });
  document.addEventListener('click', openExternal);
  document.addEventListener('DOMContentLoaded', () => bindCopyCode(document));

  window.UI = {
    modal, closeTopModal, toast, popover, closePopover, confirm: confirmDialog, prompt: promptDialog,
    menu, providerMono, switchHtml, segmented, emptyState, pageHeader, field, bindSegmented,
    timeAgoNode, bindCopyCode, iconBadge, skeletonRows,
  };
})();
