// Sayfa içi betikler. HEPSİ sayfanın ana dünyasında DEĞİL, ayrı bir YALITILMIŞ dünyada (`executeJavaScriptInIsolatedWorld`)
// koşar: DOM ortaktır ama JavaScript nesneleri değildir. Böylece sayfa yoklamayı kandıramaz (`getAttribute`,
// `getBoundingClientRect`, `elementFromPoint` gibi işlevleri değiştirip "Satın al" düğmesini "Devam" gösteremez) ve
// numaralı öğe listesi sayfanın göremediği bir değişkende durur (v1 numarayı `data-fuber-no` özniteliğiyle DOM'a yazıyordu:
// sayfa özniteliği başka öğeye taşıyabilirdi).
//
// Kaynak: v1 `src/main/tarayici.ts` (`ISARETLE`, `OGE_YOKLAMA`, `ODAK_BUL`). v2 eklemeleri: açık gölge köklerinin içi de
// okunur; tıklanacak noktada öğenin üstünde başka bir şey (görünmez katman) varsa tıklanmaz; non-sensitive alanların
// değeri onay kartında gösterilir, parola/kart alanının değeri HİÇ okunmaz.
import { CARD_FIELD_PATTERN, PASSWORD_FIELD_PATTERN, formMethod, isPaymentFrame, type ElementInfo, type FormSummary, type SensitiveKind } from './classify';

/** Yalıtılmış dünyanın kimliği (sayfanın ana dünyası 0; Electron'un kendi dünyaları 999 ve üstü değil). */
export const ISOLATED_WORLD = 7307;
/** Bir okumada en çok bu kadar etkileşimli öğe numaralanır. */
export const MAX_ITEMS = 160;

/** Yoklama sonucu: öğenin ne olduğu ve nerede olduğu. */
export interface Probe {
  x: number;
  y: number;
  element: ElementInfo;
  /** Öğenin KENDİSİ parola/kart alanı mı (yazma yasağı). */
  fieldKind: SensitiveKind | null;
  form: FormSummary | null;
  href: string;
  /** Yazılabilir alan (input/textarea/contenteditable). */
  editable: boolean;
  disabled: boolean;
  /** Öğenin merkezinde başka bir öğe var (görünmez katman, açılır pencere): tıklama oraya giderdi. */
  covered: boolean;
  /** Odak başka kökenli bir çerçevede (ödeme formu olabilir): içi okunamaz. */
  crossFrame?: boolean;
}

export interface PageSnapshot {
  title: string;
  url: string;
  text: string;
  items: string[];
  more: number;
}

// Sayfaya giden ortak yardımcılar. `formMethod` ve `isPaymentFrame` `classify.ts`'ten metin olarak gelir (tek kaynak).
const HELPERS = String.raw`
  const PW = ${PASSWORD_FIELD_PATTERN.toString()};
  const CARD = ${CARD_FIELD_PATTERN.toString()};
  const formMethod = ${formMethod.toString()};
  const isPaymentFrame = ${isPaymentFrame.toString()};
  const low = (s) => String(s == null ? '' : s).toLowerCase();
  const clip = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const isField = (a) => /^(input|textarea|select)$/.test(a.tagName.toLowerCase());
  const fieldKind = (a) => {
    if (!isField(a)) return null;
    const ac = low(a.getAttribute('autocomplete'));
    const name = [a.name, a.id, a.getAttribute('placeholder'), a.getAttribute('aria-label'), (a.labels && a.labels[0] && a.labels[0].innerText) || ''].join(' ');
    if (low(a.type) === 'password' || /password|one-time-code/.test(ac)) return 'password';
    if (/^cc-|card/.test(ac) || CARD.test(name)) return 'card';
    if (PW.test(name)) return 'password';
    return null;
  };
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 && r.bottom > -200 && r.top < innerHeight + 1600;
  };
  /** Belge ve açık gölge kökleri boyunca seçiciye uyan öğeler (belge sırasıyla). */
  const deepAll = (root, selector, out) => {
    for (const e of root.querySelectorAll(selector)) out.push(e);
    for (const host of root.querySelectorAll('*')) if (host.shadowRoot) deepAll(host.shadowRoot, selector, out);
    return out;
  };
  const deepFromPoint = (x, y) => {
    let h = document.elementFromPoint(x, y);
    for (let i = 0; i < 8 && h && h.shadowRoot; i++) { const inner = h.shadowRoot.elementFromPoint(x, y); if (!inner || inner === h) break; h = inner; }
    return h;
  };
  const containsDeep = (outer, inner) => {
    for (let n = inner, i = 0; n && i < 40; i++) {
      if (n === outer) return true;
      n = n.parentNode || (n.host ? n.host : null);
    }
    return false;
  };
  const describe = (e) => {
    const tag = e.tagName.toLowerCase();
    const role = low(e.getAttribute('role'));
    const sub = tag === 'button' ? (e.hasAttribute('type') ? low(e.getAttribute('type')) : '') : (isField(e) ? low(e.type) : '');
    const clickable = role === 'button' || role === 'menuitem' || e.hasAttribute('onclick');
    let type = tag + (sub ? ':' + sub : '');
    if (tag === 'a' || tag === 'area') type = (clickable || /^(#|javascript:)/i.test(String(e.getAttribute('href') || '').trim())) ? 'button:role' : 'a';
    else if (clickable && tag !== 'button' && tag !== 'input') type = 'button:role';
    else if (e.isContentEditable && !isField(e)) type = 'contenteditable';
    const form = e.form || (e.closest && e.closest('form')) || null;
    const fieldsOf = (k) => Array.from(k.querySelectorAll('input, select, textarea'));
    const payment = (k) => Array.from(k.querySelectorAll('iframe')).some((f) => isPaymentFrame(f.getAttribute('src'), f.getAttribute('name'), f.getAttribute('title')));
    let box = form;
    if (!box) {
      let p = e.parentElement;
      for (let i = 0; p && p !== document.body && p !== document.documentElement && i < 6; i++, p = p.parentElement) {
        if (fieldsOf(p).filter((a) => low(a.type) !== 'hidden').some(fieldKind) || payment(p)) { box = p; break; }
      }
    }
    const fields = box ? fieldsOf(box) : [];
    let passwordForm = false, cardForm = false;
    for (const a of fields) { const k = fieldKind(a); if (k === 'password') passwordForm = true; else if (k === 'card') cardForm = true; }
    if (box && payment(box)) cardForm = true;
    const method = form ? formMethod(form.getAttribute('method'), e.getAttribute('formmethod'), form.getAttribute('role')) : null;
    const button = tag === 'button' || type === 'button:role' || (tag === 'input' && /^(submit|button|image|reset)$/.test(sub));
    const text = clip(tag === 'input' ? (button ? (e.value || e.getAttribute('alt')) : '') : (isField(e) ? '' : (e.innerText || e.getAttribute('value'))), 80);
    const label = clip(e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].innerText) || e.getAttribute('placeholder') || e.name || e.id || e.getAttribute('title') || e.getAttribute('alt') || '', 80);
    let summary = null;
    if (box) {
      let action = '';
      if (form) { try { action = new URL(e.getAttribute('formaction') || form.getAttribute('action') || location.href, location.href).href.slice(0, 300); } catch (x) { action = ''; } }
      const shown = fields.filter((a) => !/^(submit|button|image|reset|hidden)$/.test(low(a.type)));
      summary = {
        action, method,
        hidden: fields.filter((a) => low(a.type) === 'hidden').length,
        fields: shown.slice(0, 40).map((a) => {
          const k = fieldKind(a);
          const name = clip(a.getAttribute('aria-label') || (a.labels && a.labels[0] && a.labels[0].innerText) || a.name || a.id || a.getAttribute('placeholder') || a.type, 40);
          const checkable = low(a.type) === 'checkbox' || low(a.type) === 'radio';
          const filled = checkable ? Boolean(a.checked) : Boolean(a.value);
          const out = { name, filled };
          if (k) out.kind = k;
          else if (!checkable && a.value) out.value = clip(a.tagName.toLowerCase() === 'select' ? (a.selectedOptions && a.selectedOptions[0] ? a.selectedOptions[0].text : a.value) : a.value, 60);
          else if (checkable) out.value = a.checked ? 'işaretli' : 'işaretsiz';
          return out;
        }),
      };
    }
    const link = e.closest && e.closest('a[href]');
    return {
      element: { label, type, inForm: Boolean(form), formMethod: method, text, passwordForm, cardForm },
      fieldKind: fieldKind(e),
      form: summary,
      href: String(link ? link.href : ''),
      editable: (isField(e) && tag !== 'select' && !/^(submit|button|image|reset|checkbox|radio|file|range|color)$/.test(sub)) || e.isContentEditable,
      disabled: Boolean(e.disabled) || low(e.getAttribute('aria-disabled')) === 'true',
    };
  };
`;

const INTERACTIVE =
  'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=radio], [role=switch], [role=option], [role=combobox], [contenteditable=""], [contenteditable=true], summary, [onclick]';

/** Sayfayı numaralar ve okur. Numaralı liste yalıtılmış dünyada `__jb` değişkeninde kalır (sayfa göremez). */
export function markScript(maxText: number): string {
  return String.raw`(() => {
    ${HELPERS}
    const all = deepAll(document, ${JSON.stringify(INTERACTIVE)}, []);
    const els = [];
    const items = [];
    let more = 0;
    for (const e of all) {
      if (!visible(e)) continue;
      if (els.length >= ${MAX_ITEMS}) { more++; continue; }
      els.push(e);
      const n = els.length;
      const d = describe(e);
      const tag = e.tagName.toLowerCase();
      const name = clip(e.getAttribute('aria-label') || (isField(e) ? '' : e.innerText) || (e.labels && e.labels[0] && e.labels[0].innerText) || e.getAttribute('placeholder') || e.getAttribute('title') || e.getAttribute('alt') || (tag === 'input' && /^(submit|button)$/.test(low(e.type)) ? e.value : '') || e.name || '', 80);
      let line = '[' + n + '] ' + d.element.type + (name ? ' "' + name + '"' : '');
      if (d.fieldKind) line += ' (' + (d.fieldKind === 'password' ? 'parola alanı' : 'kart alanı') + ': Jarvis yazamaz, kullanıcı girer' + (e.value ? '; dolu' : '') + ')';
      else if (tag === 'select') {
        const opts = Array.from(e.options).slice(0, 12).map((o) => clip(o.text, 30));
        line += ' seçili: "' + clip(e.selectedOptions && e.selectedOptions[0] ? e.selectedOptions[0].text : '', 40) + '" seçenekler: ' + opts.join(' | ') + (e.options.length > 12 ? ' …' : '');
      } else if (tag === 'input' && /^(checkbox|radio)$/.test(low(e.type))) line += e.checked ? ' [işaretli]' : ' [işaretsiz]';
      else if (d.editable && e.value) line += ' değer: "' + clip(e.value, 40) + '"';
      if (d.disabled) line += ' (devre dışı)';
      if (d.element.type === 'a' && e.href) { try { const u = new URL(e.href); line += ' → ' + clip(u.host + u.pathname, 90); } catch (x) {} }
      items.push(line);
    }
    globalThis.__jb = { els, url: location.href };
    const main = document.querySelector('main, article, [role=main]') || document.body;
    const text = ((main && main.innerText) || '').replace(/\n{3,}/g, '\n\n').slice(0, ${Math.max(500, Math.floor(maxText))});
    return { title: document.title, url: location.href, text, items, more };
  })()`;
}

/** Numaralı öğeyi yoklar: ekrana kaydırır, merkezini ve kimliğini okur, üstünde katman var mı bakar. Yoksa `null`. */
export function probeScript(no: number): string {
  return String.raw`(() => {
    ${HELPERS}
    const state = globalThis.__jb;
    if (!state || state.url !== location.href) return { stale: true };
    const e = state.els[${Math.trunc(no)} - 1];
    if (!e || !e.isConnected) return { missing: true };
    e.scrollIntoView({ block: 'center', inline: 'center' });
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { missing: true };
    const x = Math.round(r.left + Math.min(r.width / 2, Math.max(4, r.width - 4)));
    const y = Math.round(r.top + r.height / 2);
    const hit = deepFromPoint(x, y);
    const covered = !(hit && containsDeep(e, hit)) && !(hit && e.labels && Array.from(e.labels).some((l) => containsDeep(l, hit)));
    return Object.assign({ x, y, covered }, describe(e));
  })()`;
}

/** Klavye odağındaki öğe (çerçeveler ve açık gölge kökleri dolaşılır). Odak gövdedeyse `null`. */
export function focusScript(): string {
  return String.raw`(() => {
    ${HELPERS}
    let a = document.activeElement;
    for (let i = 0; i < 12 && a; i++) {
      if (a.shadowRoot && a.shadowRoot.activeElement) { a = a.shadowRoot.activeElement; continue; }
      if (/^i?frame$/i.test(a.tagName)) {
        let d = null;
        try { d = a.contentDocument; } catch (x) { d = null; }
        if (!d) return { crossFrame: true, x: 0, y: 0, covered: false, fieldKind: 'card', form: null, href: '', editable: true, disabled: false,
          element: { label: 'başka kökenli çerçeve', type: 'input:text', inForm: true, formMethod: null, text: '', passwordForm: false, cardForm: true } };
        if (d.activeElement && d.activeElement !== d.body && d.activeElement !== d.documentElement) { a = d.activeElement; continue; }
      }
      break;
    }
    if (!a || a === document.body || a === document.documentElement) return null;
    const r = a.getBoundingClientRect();
    return Object.assign({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), covered: false }, describe(a));
  })()`;
}

/** Numaralı alanı odaklar; `selectAll` ise içeriğini seçer (üzerine yazmak için). */
export function focusFieldScript(no: number, selectAll: boolean): string {
  return String.raw`(() => {
    const state = globalThis.__jb;
    if (!state || state.url !== location.href) return { ok: false, why: 'stale' };
    const e = state.els[${Math.trunc(no)} - 1];
    if (!e || !e.isConnected) return { ok: false, why: 'missing' };
    e.scrollIntoView({ block: 'center' });
    e.focus();
    let a = document.activeElement;
    for (let i = 0; i < 8 && a && a.shadowRoot && a.shadowRoot.activeElement; i++) a = a.shadowRoot.activeElement;
    const focused = a === e || (e.contains && e.contains(a));
    if (${selectAll ? 'true' : 'false'}) {
      if (typeof e.select === 'function') e.select();
      else if (e.isContentEditable) { const range = document.createRange(); range.selectNodeContents(e); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); }
    }
    return { ok: focused, why: focused ? null : 'focus' };
  })()`;
}

/** Numaralı alanın şimdiki değeri (yazmanın doğrulaması; yalnız hassas olmayan alan için çağrılır). */
export function valueScript(no: number): string {
  return String.raw`(() => {
    const state = globalThis.__jb;
    const e = state && state.els[${Math.trunc(no)} - 1];
    if (!e || !e.isConnected) return null;
    return 'value' in e && e.tagName !== 'BUTTON' ? String(e.value) : String(e.innerText || '');
  })()`;
}

/** Açılır listede seçim: değer ya da görünen ada göre (büyük/küçük harf duyarsız, önce tam eşleşme). */
export function selectScript(no: number, choice: string): string {
  return String.raw`(() => {
    const state = globalThis.__jb;
    if (!state || state.url !== location.href) return { ok: false, why: 'stale' };
    const e = state.els[${Math.trunc(no)} - 1];
    if (!e || !e.isConnected) return { ok: false, why: 'missing' };
    if (e.tagName.toLowerCase() !== 'select') return { ok: false, why: 'not_select' };
    if (e.disabled) return { ok: false, why: 'disabled' };
    const want = ${JSON.stringify(choice)}.toLocaleLowerCase('tr').trim();
    const opts = Array.from(e.options);
    const norm = (s) => String(s).toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
    const pick = opts.find((o) => norm(o.value) === want || norm(o.text) === want) || opts.find((o) => norm(o.text).includes(want));
    if (!pick) return { ok: false, why: 'no_option', options: opts.slice(0, 20).map((o) => o.text.trim()) };
    e.focus();
    e.value = pick.value;
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, chosen: pick.text.trim() };
  })()`;
}

/** Sayfayı ya da numaralı öğeyi kaydırır. */
export function scrollScript(direction: 'down' | 'up' | 'top' | 'bottom', no?: number): string {
  return String.raw`(() => {
    const state = globalThis.__jb;
    const no = ${no ? Math.trunc(no) : 0};
    if (no) {
      const e = state && state.url === location.href ? state.els[no - 1] : null;
      if (!e || !e.isConnected) return { ok: false };
      e.scrollIntoView({ block: 'center' });
    } else {
      const d = ${JSON.stringify(direction)};
      const h = innerHeight * 0.85;
      if (d === 'top') scrollTo(0, 0); else if (d === 'bottom') scrollTo(0, document.documentElement.scrollHeight); else scrollBy(0, d === 'up' ? -h : h);
    }
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    return { ok: true, y: Math.round(scrollY), max: Math.round(max) };
  })()`;
}

/** Sayfada metin görünüyor mu (bekleme). */
export function hasTextScript(text: string): string {
  return String.raw`(() => ((document.body && document.body.innerText) || '').toLocaleLowerCase('tr').includes(${JSON.stringify(text.toLocaleLowerCase('tr'))}))()`;
}
