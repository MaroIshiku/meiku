import { $, $$, copyText, esc, stateView, toast } from './dom.js?v=0.4.2';
import { icon, iconPath } from './icons.js?v=0.4.2';
import { firstName, hasBank, hasBusiness, hasPayPal, initials, slug } from './profile.js?v=0.4.2';
import { formatIban, isValidIban, normalizeAmount, QrPayload, renderQr } from './qr.js?v=0.4.2';

const AMOUNTS = ['5', '10', '20', '50', '100'];
const AMOUNT_KEY = 'meiku.amount';
const PURPOSE_KEY = 'meiku.purpose';
const CARD_KEY = 'meiku.card';

export const CARDS = [
  { id: 'private', nav: 'Private', title: 'Private contact', iconName: 'user', step: 0 },
  { id: 'business', nav: 'Business', title: 'Business contact', iconName: 'briefcase', step: 1 },
  { id: 'paypal', nav: 'PayPal', title: 'PayPal', iconName: 'wallet', step: 2 },
  { id: 'bank', nav: 'Bank', title: 'Bank transfer', iconName: 'bank', step: 3 }
];

function qrOptions(size, card) {
  return {
    size,
    style: 'fluid',
    theme: document.documentElement.dataset.theme,
    logoPath: iconPath(card.iconName),
    label: `${card.title} QR code`,
    className: 'meiku-qr__canvas',
    border: 4
  };
}

/**
 * Card deck: one panel per card, swipeable with native scroll snapping and
 * synchronised with the bottom navigation. ctx provides state and actions.
 */
export function createCards(ctx) {
  const { state } = ctx;
  state.amount = sessionStorage.getItem(AMOUNT_KEY) || '';
  state.purpose = sessionStorage.getItem(PURPOSE_KEY) || '';
  state.card = CARDS.some(card => card.id === sessionStorage.getItem(CARD_KEY)) ? sessionStorage.getItem(CARD_KEY) : 'private';
  let wakeLock = null;
  let fullscreenId = '';
  let scrollTimer = 0;

  function payloadFor(id) {
    const d = state.data;
    if (id === 'private') return QrPayload.vcard(d);
    if (id === 'business') return hasBusiness(d) ? QrPayload.vcardCompany(d) : '';
    if (id === 'paypal') return QrPayload.paypal(d, state.amount);
    if (id === 'bank') return QrPayload.girocode(d, state.amount, state.purpose);
    return '';
  }

  function hasCardData(id) {
    const d = state.data;
    return id === 'private' || (id === 'business' && hasBusiness(d)) || (id === 'paypal' && hasPayPal(d)) || (id === 'bank' && hasBank(d));
  }

  function subtitleFor(id) {
    const d = state.data;
    if (id === 'business') return [d.j, d.c].filter(Boolean).join(' · ');
    if (id === 'paypal') return d.pp ? `paypal.me/${d.pp}` : '';
    if (id === 'bank') return d.ib ? formatIban(d.ib) : '';
    return d.e1 || d.m || '';
  }

  function avatarMarkup(className) {
    const d = state.data;
    return d.av
      ? `<span class="${className}"><img src="${esc(d.av)}" alt=""></span>`
      : `<span class="${className}" aria-hidden="true">${esc(initials(d.n))}</span>`;
  }

  function detailRows(id) {
    const d = state.data;
    const join = (...parts) => parts.filter(Boolean).join(', ');
    const maps = (...parts) => `https://maps.google.com/?q=${encodeURIComponent(parts.filter(Boolean).join(' '))}`;
    const rows = {
      private: [
        { iconName: 'mobile', label: 'Mobile', value: d.m, href: d.m && `tel:${d.m.replace(/[^+0-9]/g, '')}` },
        { iconName: 'email', label: 'Email', value: d.e1, href: d.e1 && `mailto:${d.e1}` },
        { iconName: 'location', label: 'Address', value: join(d.s, d.z), href: (d.s || d.z) && maps(d.s, d.z) }
      ],
      business: [
        { iconName: 'company', label: 'Company', value: d.c },
        { iconName: 'work', label: 'Job title', value: d.j },
        { iconName: 'phone', label: 'Office', value: d.cp, href: d.cp && `tel:${d.cp.replace(/[^+0-9]/g, '')}` },
        { iconName: 'mobile', label: 'Work mobile', value: d.cm, href: d.cm && `tel:${d.cm.replace(/[^+0-9]/g, '')}` },
        { iconName: 'email', label: 'Work email', value: d.ce, href: d.ce && `mailto:${d.ce}` },
        { iconName: 'website', label: 'Website', value: d.w, href: d.w && (/^https?:\/\//i.test(d.w) ? d.w : `https://${d.w}`) },
        { iconName: 'location', label: 'Address', value: join(d.cs, d.cz), href: (d.cs || d.cz) && maps(d.cs, d.cz) }
      ],
      paypal: [
        { iconName: 'website', label: 'Payment link', value: QrPayload.paypal(d, state.amount) }
      ],
      bank: [
        { iconName: 'user', label: 'Recipient', value: d.n },
        { iconName: 'bank', label: 'IBAN', value: formatIban(d.ib), copy: d.ib },
        { iconName: 'key', label: 'BIC', value: d.bic }
      ]
    };
    return (rows[id] || []).filter(row => row.value);
  }

  function detailsMarkup(id) {
    const rows = detailRows(id);
    if (!rows.length) return '';
    return `
      <section class="psu-card meiku-details" aria-label="${esc(CARDS.find(c => c.id === id).nav)} details">
        ${rows.map(row => {
          const main = `<span class="meiku-detail__icon">${icon(row.iconName)}</span><span class="meiku-detail__text"><small>${esc(row.label)}</small><b>${esc(row.value)}</b></span>`;
          return `
          <div class="meiku-detail">
            ${row.href ? `<a class="meiku-detail__main" href="${esc(row.href)}"${row.href.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : ''}>${main}</a>` : `<div class="meiku-detail__main">${main}</div>`}
            <button class="psu-icon-button meiku-detail__copy" type="button" data-copy="${esc(row.copy || row.value)}" aria-label="Copy ${esc(row.label.toLowerCase())}">${icon('copy')}</button>
          </div>`;
        }).join('')}
      </section>`;
  }

  function amountMarkup(id) {
    const clean = normalizeAmount(state.amount);
    return `
      <div class="meiku-amount">
        <label class="psu-field">
          <span class="psu-label">Amount (EUR)</span>
          <input class="psu-input" data-amount-input inputmode="decimal" autocomplete="off" maxlength="15" placeholder="Optional, e.g. 12.50" value="${esc(state.amount)}">
        </label>
        <div class="psu-chip-group" role="group" aria-label="Quick amounts">
          ${AMOUNTS.map(v => `<button class="psu-chip" type="button" data-chip="${v}" aria-pressed="${clean === Number(v).toFixed(2)}">${v} €</button>`).join('')}
        </div>
        ${id === 'bank' ? `
        <label class="psu-field">
          <span class="psu-label">Payment reference</span>
          <input class="psu-input" data-purpose-input autocomplete="off" maxlength="140" placeholder="Optional" value="${esc(state.purpose)}">
        </label>` : ''}
      </div>`;
  }

  function captionFor(id) {
    const clean = normalizeAmount(state.amount);
    const d = state.data;
    if (id === 'paypal' || id === 'bank') return clean ? `€ ${clean} to ${d.n}` : `Any amount to ${d.n}`;
    return '';
  }

  function emptyStateFor(id) {
    const d = state.data;
    if (id === 'business') return stateView({ iconName: 'briefcase', title: 'No business details yet', message: 'Add your company and work contact details to share a business vCard.', actionLabel: 'Add business details', action: 'edit:1' });
    if (id === 'paypal') return stateView({ iconName: 'wallet', title: 'No PayPal username yet', message: 'Add your paypal.me username to receive payments with a QR code.', actionLabel: 'Add PayPal', action: 'edit:2' });
    const invalid = d.ib && !isValidIban(d.ib);
    return stateView({ iconName: 'bank', title: invalid ? 'IBAN is not valid' : 'No bank details yet', message: invalid ? 'Check the IBAN in your bank details. The GiroCode appears once it is valid.' : 'Add your IBAN to show a SEPA GiroCode that banking apps can scan.', actionLabel: invalid ? 'Fix bank details' : 'Add bank details', action: 'edit:3' });
  }

  function panelMarkup(card) {
    const d = state.data;
    const active = hasCardData(card.id);
    const isPayment = card.id === 'paypal' || card.id === 'bank';
    const subtitle = subtitleFor(card.id);
    return `
      <section class="meiku-panel" id="card-${card.id}" data-card="${card.id}" aria-labelledby="card-${card.id}-title">
        <article class="meiku-share-card">
          <header class="meiku-share-card__head">
            ${avatarMarkup('meiku-avatar')}
            <div class="meiku-share-card__title">
              <p class="meiku-eyebrow">${icon(card.iconName)}<span>${esc(card.title)}</span></p>
              <h2 id="card-${card.id}-title">${esc(d.n)}</h2>
              ${subtitle ? `<p class="meiku-share-card__sub">${esc(subtitle)}</p>` : ''}
            </div>
          </header>
          ${active ? `
          <button class="meiku-qr" type="button" data-action="fullscreen" aria-label="Show ${esc(card.title)} QR code fullscreen">
            <span class="meiku-qr__target" data-qr></span>
          </button>
          ${isPayment ? `<p class="meiku-caption" data-caption>${esc(captionFor(card.id))}</p>` : ''}
          ${isPayment ? amountMarkup(card.id) : ''}
          <div class="meiku-share-actions">
            <button class="psu-button psu-button--filled" type="button" data-action="fullscreen">${icon('fullscreen')}Fullscreen</button>
            <button class="psu-button psu-button--tonal" type="button" data-action="share">${icon('share')}Share</button>
          </div>` : emptyStateFor(card.id)}
        </article>
        ${active ? detailsMarkup(card.id) : ''}
      </section>`;
  }

  function renderQrInto(panel, id) {
    const target = $('[data-qr]', panel);
    if (!target) return;
    const payload = payloadFor(id);
    if (payload) renderQr(target, payload, qrOptions(720, CARDS.find(c => c.id === id)));
  }

  function renderDeck() {
    const deck = $('#deck');
    deck.innerHTML = CARDS.map(panelMarkup).join('');
    for (const card of CARDS) renderQrInto($(`#card-${card.id}`), card.id);
    updateNav();
    requestAnimationFrame(() => scrollToCard(state.card, false));
  }

  function refreshPayment(id) {
    const panel = $(`#card-${id}`);
    if (!panel || !hasCardData(id)) return;
    renderQrInto(panel, id);
    const caption = $('[data-caption]', panel);
    if (caption) caption.textContent = captionFor(id);
    const clean = normalizeAmount(state.amount);
    $$('[data-chip]', panel).forEach(chip => chip.setAttribute('aria-pressed', String(clean === Number(chip.dataset.chip).toFixed(2))));
    const details = $('.meiku-details', panel);
    if (details) details.outerHTML = detailsMarkup(id);
  }

  function syncAmountInputs(source) {
    $$('[data-amount-input]').forEach(input => { if (input !== source) input.value = state.amount; });
  }

  function updateNav() {
    $$('#cardNav button').forEach(button => {
      if (button.dataset.card === state.card) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function scrollToCard(id, smooth = true) {
    const panel = $(`#card-${id}`);
    if (!panel) return;
    $('#deck').scrollTo({ left: panel.offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
  }

  function setCard(id) {
    state.card = id;
    sessionStorage.setItem(CARD_KEY, id);
    updateNav();
  }

  async function share(id) {
    const d = state.data;
    try {
      if (id === 'private' || id === 'business') {
        const vcard = payloadFor(id);
        const file = new File([vcard], `${slug(d.n)}${id === 'business' ? '-business' : ''}.vcf`, { type: 'text/vcard' });
        if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: d.n }); return; }
        const text = detailRows(id).map(row => `${row.label}: ${row.value}`).join('\n');
        if (navigator.share) { await navigator.share({ title: d.n, text: `${d.n}\n${text}` }); return; }
        await copyText(`${d.n}\n${text}`, 'Contact details copied.');
        return;
      }
      if (id === 'paypal') {
        const url = QrPayload.paypal(d, state.amount);
        if (navigator.share) { await navigator.share({ title: `Pay ${d.n}`, url }); return; }
        await copyText(url, 'Payment link copied.');
        return;
      }
      const clean = normalizeAmount(state.amount);
      const text = [`Recipient: ${d.n}`, `IBAN: ${formatIban(d.ib)}`, d.bic ? `BIC: ${d.bic}` : '', clean ? `Amount: ${clean} EUR` : '', state.purpose ? `Reference: ${state.purpose}` : ''].filter(Boolean).join('\n');
      if (navigator.share) { await navigator.share({ title: `Bank details of ${d.n}`, text }); return; }
      await copyText(text, 'Bank details copied.');
    } catch (error) {
      if (error?.name !== 'AbortError') toast('Sharing is not available. Use the copy buttons instead.');
    }
  }

  // ---- Fullscreen -------------------------------------------------------
  function shareableCards() { return CARDS.filter(card => hasCardData(card.id)); }

  function renderFullscreen() {
    const card = CARDS.find(c => c.id === fullscreenId);
    const cards = shareableCards();
    const index = cards.findIndex(c => c.id === fullscreenId);
    $('#fsEyebrow').innerHTML = `${icon(card.iconName)}<span>${esc(card.title)}</span>`;
    $('#fsTitle').textContent = state.data.n;
    const caption = captionFor(card.id);
    $('#fsCaption').textContent = caption;
    $('#fsCaption').hidden = !caption;
    renderQr($('#fsQr'), payloadFor(card.id), qrOptions(1080, card));
    $('#fsPrev').disabled = index <= 0;
    $('#fsNext').disabled = index >= cards.length - 1;
    $('#fsPosition').textContent = `${index + 1} of ${cards.length}`;
  }

  async function openFullscreen(id) {
    fullscreenId = id;
    renderFullscreen();
    const overlay = $('#fullscreen');
    overlay.dataset.returnFocus = '';
    ctx.fullscreenReturn = document.activeElement;
    overlay.hidden = false;
    document.body.classList.add('fullscreen-open');
    $('#fsClose').focus({ preventScroll: true });
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
  }

  async function closeFullscreen() {
    const overlay = $('#fullscreen');
    if (overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove('fullscreen-open');
    try { await wakeLock?.release(); } catch {}
    wakeLock = null;
    setCard(fullscreenId);
    scrollToCard(fullscreenId, false);
    ctx.fullscreenReturn?.focus?.({ preventScroll: true });
  }

  function stepFullscreen(delta) {
    const cards = shareableCards();
    const index = cards.findIndex(c => c.id === fullscreenId) + delta;
    if (index < 0 || index >= cards.length) return;
    fullscreenId = cards[index].id;
    renderFullscreen();
  }

  function bind() {
    const deck = $('#deck');
    $$('#cardNav button').forEach(button => button.addEventListener('click', () => { setCard(button.dataset.card); scrollToCard(button.dataset.card); }));
    deck.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const index = Math.round(deck.scrollLeft / Math.max(1, deck.clientWidth));
        const card = CARDS[Math.min(CARDS.length - 1, Math.max(0, index))];
        if (card && card.id !== state.card) setCard(card.id);
      }, 80);
    }, { passive: true });
    window.addEventListener('resize', () => scrollToCard(state.card, false));
    // QR colours follow the theme.
    window.addEventListener('psu:themechange', () => { if (state.data && !$('#vaultScreen').hidden) renderDeck(); });

    deck.addEventListener('click', event => {
      const panel = event.target.closest('[data-card]');
      const id = panel?.dataset.card;
      const copy = event.target.closest('[data-copy]');
      if (copy) { copyText(copy.dataset.copy); return; }
      const chip = event.target.closest('[data-chip]');
      if (chip) {
        state.amount = Number(chip.dataset.chip).toFixed(2);
        sessionStorage.setItem(AMOUNT_KEY, state.amount);
        syncAmountInputs(null);
        refreshPayment('paypal'); refreshPayment('bank');
        return;
      }
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (!action || !id) return;
      if (action === 'fullscreen') openFullscreen(id);
      if (action === 'share') share(id);
      if (action.startsWith('edit:')) ctx.openEditor(Number(action.slice(5)), false);
    });

    let inputTimer = 0;
    deck.addEventListener('input', event => {
      if (event.target.matches('[data-amount-input]')) {
        state.amount = event.target.value;
        sessionStorage.setItem(AMOUNT_KEY, state.amount);
        syncAmountInputs(event.target);
      } else if (event.target.matches('[data-purpose-input]')) {
        state.purpose = event.target.value;
        sessionStorage.setItem(PURPOSE_KEY, state.purpose);
      } else return;
      clearTimeout(inputTimer);
      inputTimer = setTimeout(() => { refreshPayment('paypal'); refreshPayment('bank'); }, 250);
    });

    $('#fsClose').addEventListener('click', closeFullscreen);
    $('#fsPrev').addEventListener('click', () => stepFullscreen(-1));
    $('#fsNext').addEventListener('click', () => stepFullscreen(1));
    const overlay = $('#fullscreen');
    let startX = 0;
    overlay.addEventListener('pointerdown', event => { startX = event.clientX; });
    overlay.addEventListener('pointerup', event => {
      const dx = event.clientX - startX;
      if (Math.abs(dx) > 60) stepFullscreen(dx < 0 ? 1 : -1);
    });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeFullscreen();
      else if (event.key === 'ArrowRight') stepFullscreen(1);
      else if (event.key === 'ArrowLeft') stepFullscreen(-1);
      else if (event.key === 'Tab') {
        const items = $$('button:not([disabled])', overlay);
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && !overlay.hidden && !wakeLock) {
        try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
      }
    });
  }

  return { bind, renderDeck, closeFullscreen, scrollToCard, firstNameOf: () => firstName(state.data?.n) };
}
