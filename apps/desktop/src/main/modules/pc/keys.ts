// Kısayol metnini ("ctrl+t", "enter", "alt+tab") sanal tuşlara çevirir ve kısayolun türünü sınıflar (saf işlevler).
// Tuş adları tablosu Fuber AI 1'in girdi yardımcısından alındı ve Türkçe adlarla genişletildi.
import { foldForSearch } from '@fuber/shared';

export const VK = {
  LBUTTON: 0x01,
  RBUTTON: 0x02,
  MBUTTON: 0x04,
  XBUTTON1: 0x05,
  XBUTTON2: 0x06,
  BACK: 0x08,
  TAB: 0x09,
  RETURN: 0x0d,
  SHIFT: 0x10,
  CONTROL: 0x11,
  MENU: 0x12,
  CAPITAL: 0x14,
  ESCAPE: 0x1b,
  SPACE: 0x20,
  PRIOR: 0x21,
  NEXT: 0x22,
  END: 0x23,
  HOME: 0x24,
  LEFT: 0x25,
  UP: 0x26,
  RIGHT: 0x27,
  DOWN: 0x28,
  SNAPSHOT: 0x2c,
  INSERT: 0x2d,
  DELETE: 0x2e,
  LWIN: 0x5b,
  RWIN: 0x5c,
  APPS: 0x5d,
  F1: 0x70,
  F4: 0x73,
  LSHIFT: 0xa0,
  RSHIFT: 0xa1,
  LCONTROL: 0xa2,
  RCONTROL: 0xa3,
  LMENU: 0xa4,
  RMENU: 0xa5,
  VOLUME_MUTE: 0xad,
  VOLUME_DOWN: 0xae,
  VOLUME_UP: 0xaf,
  MEDIA_NEXT: 0xb0,
  MEDIA_PREV: 0xb1,
  MEDIA_STOP: 0xb2,
  MEDIA_PLAY_PAUSE: 0xb3,
  OEM_PLUS: 0xbb,
  /** Unicode girdinin taşıyıcı tuşu: kendi yazdığımız metin bu kodla görünür. */
  PACKET: 0xe7,
} as const;

const MODIFIERS: Record<string, number> = {
  ctrl: VK.CONTROL,
  control: VK.CONTROL,
  kontrol: VK.CONTROL,
  shift: VK.SHIFT,
  alt: VK.MENU,
  win: VK.LWIN,
  windows: VK.LWIN,
  super: VK.LWIN,
  cmd: VK.LWIN,
  meta: VK.LWIN,
};

const NAMED: Record<string, number> = {
  enter: VK.RETURN,
  return: VK.RETURN,
  giris: VK.RETURN,
  tab: VK.TAB,
  sekme: VK.TAB,
  esc: VK.ESCAPE,
  escape: VK.ESCAPE,
  kacis: VK.ESCAPE,
  space: VK.SPACE,
  spacebar: VK.SPACE,
  bosluk: VK.SPACE,
  backspace: VK.BACK,
  gerisil: VK.BACK,
  delete: VK.DELETE,
  del: VK.DELETE,
  sil: VK.DELETE,
  insert: VK.INSERT,
  ins: VK.INSERT,
  home: VK.HOME,
  end: VK.END,
  pageup: VK.PRIOR,
  pgup: VK.PRIOR,
  sayfayukari: VK.PRIOR,
  pagedown: VK.NEXT,
  pgdn: VK.NEXT,
  sayfaasagi: VK.NEXT,
  left: VK.LEFT,
  sol: VK.LEFT,
  up: VK.UP,
  yukari: VK.UP,
  right: VK.RIGHT,
  sag: VK.RIGHT,
  down: VK.DOWN,
  asagi: VK.DOWN,
  printscreen: VK.SNAPSHOT,
  prtsc: VK.SNAPSHOT,
  capslock: VK.CAPITAL,
  menu: VK.APPS,
  plus: VK.OEM_PLUS,
  arti: VK.OEM_PLUS,
};

const NAMES_BY_VK = new Map<number, string>([
  [VK.CONTROL, 'ctrl'],
  [VK.SHIFT, 'shift'],
  [VK.MENU, 'alt'],
  [VK.LWIN, 'win'],
  [VK.RETURN, 'enter'],
  [VK.TAB, 'tab'],
  [VK.ESCAPE, 'esc'],
  [VK.SPACE, 'space'],
  [VK.BACK, 'backspace'],
  [VK.DELETE, 'delete'],
  [VK.INSERT, 'insert'],
  [VK.HOME, 'home'],
  [VK.END, 'end'],
  [VK.PRIOR, 'pageup'],
  [VK.NEXT, 'pagedown'],
  [VK.LEFT, 'left'],
  [VK.UP, 'up'],
  [VK.RIGHT, 'right'],
  [VK.DOWN, 'down'],
  [VK.SNAPSHOT, 'printscreen'],
  [VK.CAPITAL, 'capslock'],
  [VK.APPS, 'menu'],
  [VK.OEM_PLUS, 'plus'],
]);

/** Sıra: önce bunlar basılır, sonra bırakılır. */
const MODIFIER_ORDER = [VK.CONTROL, VK.MENU, VK.SHIFT, VK.LWIN] as const;

export interface Chord {
  /** Değiştirici tuşlar (ctrl, alt, shift, win), basılış sırasıyla. */
  modifiers: number[];
  /** Asıl tuş; yalnız değiştiriciyse `null` ("win"). */
  key: number | null;
  /** Bir karakter üreten düz tuş ("a", "5", boşluk): parola alanı denetimi uygulanır. */
  printable: boolean;
  /** Kurallarla karşılaştırılan biçim: "ctrl+shift+t". */
  canonical: string;
}

export const MAX_CHORDS = 6;

export type KeyForChar = (char: string) => { vk: number; shift: boolean } | null;

/**
 * "ctrl+t", "enter", "ctrl+a ctrl+c", "alt + tab" → tuş dizisi. Bilinmeyen tuşta hata döner (hiçbir şey basılmaz).
 * Tek karakterli tuşlar önce düz harf/rakam olarak, değilse klavye düzeninden (`keyForChar`) çözülür.
 */
export function parseKeys(text: string, keyForChar: KeyForChar = () => null): { chords: Chord[] } | { error: string } {
  const normalized = foldForSearch(text).replace(/\s*\+\s*/g, '+').trim();
  if (!normalized) return { error: text };
  const parts = normalized.split(/[\s,;]+/).filter(Boolean);
  if (parts.length > MAX_CHORDS) return { error: text };
  const chords: Chord[] = [];
  for (const part of parts) {
    // "ctrl++" → ctrl ile artı tuşu.
    const tokens = part.replace(/\+\+$/, '+plus').split('+').filter(Boolean);
    const modifiers = new Set<number>();
    let key: number | null = null;
    let printable = false;
    for (const token of tokens) {
      const modifier = MODIFIERS[token];
      if (modifier !== undefined) {
        modifiers.add(modifier);
        continue;
      }
      if (key !== null) return { error: part };
      const named = NAMED[token];
      const fn = /^f(\d{1,2})$/.exec(token);
      if (named !== undefined) {
        key = named;
        printable = named === VK.SPACE;
      } else if (fn && Number(fn[1]) >= 1 && Number(fn[1]) <= 24) {
        key = VK.F1 + Number(fn[1]) - 1;
      } else if (/^[a-z0-9]$/.test(token)) {
        key = token.toUpperCase().charCodeAt(0);
        printable = true;
      } else if ([...token].length === 1) {
        const mapped = keyForChar(token);
        if (!mapped) return { error: token };
        key = mapped.vk;
        if (mapped.shift) modifiers.add(VK.SHIFT);
        printable = true;
      } else {
        return { error: token };
      }
    }
    if (key === null && modifiers.size === 0) return { error: part };
    const ordered = MODIFIER_ORDER.filter((vk) => modifiers.has(vk));
    const onlyShift = ordered.every((vk) => vk === VK.SHIFT);
    const names = [...ordered.map((vk) => NAMES_BY_VK.get(vk) ?? ''), ...(key === null ? [] : [keyName(key)])];
    chords.push({ modifiers: ordered, key, printable: printable && onlyShift, canonical: names.join('+') });
  }
  return { chords };
}

function keyName(vk: number): string {
  const named = NAMES_BY_VK.get(vk);
  if (named) return named;
  if (vk >= VK.F1 && vk < VK.F1 + 24) return `f${vk - VK.F1 + 1}`;
  if ((vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5a)) return String.fromCharCode(vk).toLowerCase();
  return `vk${vk}`;
}

/** Kısayolun basış sırası: değiştiriciler aşağı, tuş aşağı-yukarı, değiştiriciler ters sırayla yukarı. */
export function chordEvents(chord: Chord): Array<{ vk: number; down: boolean }> {
  const events: Array<{ vk: number; down: boolean }> = chord.modifiers.map((vk) => ({ vk, down: true }));
  if (chord.key !== null) events.push({ vk: chord.key, down: true }, { vk: chord.key, down: false });
  for (const vk of [...chord.modifiers].reverse()) events.push({ vk, down: false });
  return events;
}

export type ChordKind =
  /** Hiç basılmaz (oturumu kilitler ya da güvenlik ekranını açar). */
  | 'blocked'
  /** Pencere/sekme kapatır, siler ya da komut çalıştırma kutusu açar: onay ister. */
  | 'danger'
  /** Bulunulan pencerede "gönder/onayla" anlamına gelebilir (Enter): pencereye göre onay ister. */
  | 'commit'
  /** Odağı başka pencereye taşır: dizinin son kısayolu olmalıdır. */
  | 'focus'
  /** Metin yapıştırır ya da yazar: parola/kart alanında basılmaz. */
  | 'text'
  | 'plain';

// Son dördü Fuber AI'nin kendi genel kısayolları (konuş, mikrofon, acil dur) ve v1'in acil durdurmasıdır: asistan kendi düğmelerine basmaz.
const BLOCKED = new Set(['ctrl+alt+delete', 'win+l', 'ctrl+alt+j', 'ctrl+alt+m', 'ctrl+alt+q', 'alt+shift+q']);
const DANGER = new Set(['alt+f4', 'ctrl+w', 'ctrl+f4', 'ctrl+shift+w', 'ctrl+q', 'delete', 'shift+delete', 'ctrl+delete', 'ctrl+shift+delete', 'win+r', 'win+x']);
const COMMIT = new Set(['enter', 'ctrl+enter', 'shift+enter', 'alt+enter']);
const FOCUS = new Set(['alt+tab', 'alt+shift+tab', 'alt+esc', 'ctrl+alt+tab', 'ctrl+esc']);
const PASTE = new Set(['ctrl+v', 'shift+insert', 'ctrl+shift+v']);

export function classifyChord(chord: Chord): ChordKind {
  const id = chord.canonical;
  if (BLOCKED.has(id)) return 'blocked';
  if (DANGER.has(id)) return 'danger';
  if (COMMIT.has(id)) return 'commit';
  if (FOCUS.has(id) || chord.modifiers.includes(VK.LWIN)) return 'focus';
  if (PASTE.has(id) || chord.printable) return 'text';
  return 'plain';
}

/** Sistem geneli medya ve ses tuşları: hedef pencere gerektirmez, hiçbir pencereye yazı yazmaz. */
export const MEDIA_KEYS = {
  play_pause: VK.MEDIA_PLAY_PAUSE,
  next: VK.MEDIA_NEXT,
  previous: VK.MEDIA_PREV,
  stop: VK.MEDIA_STOP,
  volume_up: VK.VOLUME_UP,
  volume_down: VK.VOLUME_DOWN,
  mute: VK.VOLUME_MUTE,
} as const;

export type MediaAction = keyof typeof MEDIA_KEYS;
