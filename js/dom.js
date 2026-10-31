import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch]);
}

export function vibrate() { if (navigator.vibrate) navigator.vibrate(8); }

let toastTimer = 0;
export function toast(message) {
  const host = $('#toastHost');
  host.textContent = message;
  host.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { host.hidden = true; }, 3200);
}

export async function copyText(text, label = 'Copied.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast('Copying is not available in this browser.');
  }
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet controller following the shared Sheet contract:
 * labelled, focus trapped while open, Escape closes, focus returns to the
 * element that opened it, and page scrolling is contained.
 */
export const Sheet = {
  returnFocus: null,
  stack: [],

  open({ title, body, back = null, onClose = null }) {
    const backdrop = $('#sheet');
    if (backdrop.hidden) this.returnFocus = document.activeElement;
    this.stack = back ? [...this.stack, back] : [];
    this.onClose = onClose;
    $('#sheetTitle').textContent = title;
    const backButton = $('#sheetBack');
    backButton.hidden = !back;
    backButton.onclick = back ? () => { this.stack.pop(); back(); } : null;
    const container = $('#sheetBody');
    container.onclick = null;
    container.onchange = null;
    if (typeof body === 'string') container.innerHTML = body; else container.replaceChildren(body);
    container.scrollTop = 0;
    backdrop.hidden = false;
    document.body.classList.add('sheet-open');
    requestAnimationFrame(() => {
      const first = $(`#sheetBody [autofocus], #sheetBody ${FOCUSABLE}`) || $('#sheetClose');
      first?.focus({ preventScroll: true });
    });
    return container;
  },

  close() {
    const backdrop = $('#sheet');
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    document.body.classList.remove('sheet-open');
    $('#sheetBody').replaceChildren();
    this.stack = [];
    const callback = this.onClose;
    this.onClose = null;
    callback?.();
    this.returnFocus?.focus?.({ preventScroll: true });
    this.returnFocus = null;
  },

  isOpen() { return !$('#sheet').hidden; },

  bind() {
    $('#sheetClose').addEventListener('click', () => this.close());
    $('#sheet').addEventListener('click', event => { if (event.target === event.currentTarget) this.close(); });
    // Escape closes the sheet wherever focus is (it may sit on <body> after a re-render).
    document.addEventListener('keydown', event => {
      if (!this.isOpen()) return;
      if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
      if (event.key !== 'Tab') return;
      const items = $$(FOCUSABLE, $('#sheetPanel')).filter(node => node.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!$('#sheetPanel').contains(document.activeElement)) { event.preventDefault(); first.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }
};

/** Settings-style list row (button) with icon, title, optional support text and trailing chevron. */
export function menuRow({ action, iconName, title, support = '', danger = false, value = '' }) {
  return `
    <button class="meiku-row${danger ? ' is-danger' : ''}" type="button" data-action="${esc(action)}">
      <span class="meiku-row__icon">${icon(iconName)}</span>
      <span class="meiku-row__text"><b>${esc(title)}</b>${support ? `<small>${esc(support)}</small>` : ''}</span>
      ${value ? `<span class="meiku-row__value">${esc(value)}</span>` : ''}
      <span class="meiku-row__chevron">${icon('chevron')}</span>
    </button>`;
}

/** Shared StateView: icon, short title, helpful message, one primary action. */
export function stateView({ iconName, title, message, actionLabel = '', action = '' }) {
  return `
    <div class="meiku-state" role="status">
      <span class="meiku-state__icon">${icon(iconName)}</span>
      <h3>${esc(title)}</h3>
      <p>${esc(message)}</p>
      ${actionLabel ? `<button class="psu-button psu-button--tonal" type="button" data-action="${esc(action)}">${esc(actionLabel)}</button>` : ''}
    </div>`;
}
