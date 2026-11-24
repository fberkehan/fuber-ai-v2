/**
 * Yetenek kaynağının yüklenmeden önceki STATİK denetimi ve konağa gidecek gövdeye dönüştürülmesi.
 *
 * Denetim bir güvenlik sınırı değildir: metne bakarak her kaçamağı yakalamak mümkün değil
 * (`x['con' + 'structor']` gibi hesaplanan erişimler görünmez). Görevi iki şeydir: (1) niyeti belli yasak
 * kalıpları (içe aktarım, süreç, `eval`, doğrudan ağ) yükleme öncesinde ve satır numarasıyla reddetmek,
 * (2) yeteneği yazan modele neyin neden olmadığını söylemek. Asıl çit konaktadır (`skill-host/README.md`).
 */

export interface AuditIssue {
  /** Kuralın kısa kimliği: `import`, `process`, `eval`… */
  rule: string;
  /** Türkçe, modele ve kullanıcıya gösterilebilir açıklama. */
  message: string;
  line: number;
}

export interface PreparedSource {
  ok: boolean;
  issues: AuditIssue[];
  /** Konakta `async function (__exports) { … }` gövdesi olarak koşacak metin. `ok` değilse boş. */
  script: string;
  /** Dosyanın dışa aktardığı adlar (`default` dahil). */
  exports: string[];
}

export const MAX_SOURCE_BYTES = 200_000;

interface Scan {
  /** Kaynakla aynı uzunlukta; dize, yorum ve düzenli ifade içerikleri boşlukla örtülmüş kod. */
  code: string;
  /** Dize ve şablon metinleri (kaçışlar çözülmeden) ve başladıkları konum. */
  strings: Array<{ value: string; index: number }>;
}

const REGEX_PRECEDING_WORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

/** Satır sonlarını koruyarak örter (satır numaraları kaymasın). */
const blank = (text: string) => text.replace(/[^\n]/g, ' ');

/**
 * Kaynağı gezip kod olmayan bölgeleri örter. Tam bir ayrıştırıcı değildir; düzenli ifade / bölme ayrımı
 * önceki belirtece bakan bir sezgidir. Yanılırsa sonuç ya gereksiz bir ret ya da konakta sözdizimi hatasıdır;
 * ikisi de güvenli tarafta kalır.
 */
function scan(source: string): Scan {
  let code = '';
  const strings: Scan['strings'] = [];
  /** Açık `${` ifadelerinin süslü ayraç derinlikleri (şablon içinde kod). */
  const templates: number[] = [];
  let i = 0;
  const n = source.length;

  const lastSignificant = (): { char: string; word: string } => {
    let j = code.length - 1;
    while (j >= 0 && /\s/.test(code[j]!)) j--;
    if (j < 0) return { char: '', word: '' };
    let k = j;
    while (k >= 0 && /[\w$]/.test(code[k]!)) k--;
    return { char: code[j]!, word: code.slice(k + 1, j + 1) };
  };

  const readQuoted = (quote: string) => {
    const start = i;
    i++;
    while (i < n && source[i] !== quote && source[i] !== '\n') i += source[i] === '\\' ? 2 : 1;
    i = Math.min(n, i + 1);
    strings.push({ value: source.slice(start + 1, i - 1), index: start });
    code += blank(source.slice(start, i));
  };

  /** Şablon metnini bir sonraki `${` ya da kapanışa kadar okur. */
  const readTemplateText = () => {
    const start = i;
    while (i < n) {
      if (source[i] === '\\') {
        i += 2;
        continue;
      }
      if (source[i] === '`') {
        strings.push({ value: source.slice(start, i), index: start });
        code += blank(source.slice(start, i + 1));
        i++;
        return;
      }
      if (source[i] === '$' && source[i + 1] === '{') {
        strings.push({ value: source.slice(start, i), index: start });
        code += blank(source.slice(start, i)) + '${';
        i += 2;
        templates.push(0);
        return;
      }
      i++;
    }
    code += blank(source.slice(start, n));
  };

  while (i < n) {
    const char = source[i]!;
    const next = source[i + 1];
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      code += blank(source.slice(i, stop));
      i = stop;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      code += blank(source.slice(i, stop));
      i = stop;
    } else if (char === '"' || char === "'") {
      readQuoted(char);
    } else if (char === '`') {
      code += ' ';
      i++;
      readTemplateText();
    } else if (char === '/') {
      const previous = lastSignificant();
      const division =
        previous.char !== '' && /[\w$)\]}]/.test(previous.char) && !REGEX_PRECEDING_WORDS.has(previous.word);
      if (division) {
        code += char;
        i++;
        continue;
      }
      const start = i;
      i++;
      let inClass = false;
      while (i < n && source[i] !== '\n') {
        if (source[i] === '\\') i += 2;
        else if (source[i] === '[') (inClass = true), i++;
        else if (source[i] === ']') (inClass = false), i++;
        else if (source[i] === '/' && !inClass) break;
        else i++;
      }
      i = Math.min(n, i + 1);
      while (i < n && /[a-z]/i.test(source[i]!)) i++;
      // Düzenli ifade bir değer gibi durur ki ardından gelen `/` bölme sayılsın.
      code += `0${blank(source.slice(start + 1, i))}`;
    } else if (char === '{' && templates.length > 0) {
      templates[templates.length - 1]!++;
      code += char;
      i++;
    } else if (char === '}' && templates.length > 0) {
      if (templates[templates.length - 1] === 0) {
        templates.pop();
        code += '}';
        i++;
        readTemplateText();
      } else {
        templates[templates.length - 1]!--;
        code += char;
        i++;
      }
    } else {
      code += char;
      i++;
    }
  }
  return { code, strings };
}

const lineOf = (source: string, index: number) => {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
};

/** Bir tanımlayıcı olarak (başka bir adın parçası değil) geçen yerler. `property`: nokta ile erişim mi. */
function occurrences(code: string, name: string): Array<{ index: number; property: boolean }> {
  const out: Array<{ index: number; property: boolean }> = [];
  const pattern = new RegExp(`(?<![\\w$])${name.replace(/[$]/g, '\\$')}(?![\\w$])`, 'g');
  for (const match of code.matchAll(pattern)) {
    let j = match.index - 1;
    while (j >= 0 && /\s/.test(code[j]!)) j--;
    // `a.b` ve `a?.b` özellik erişimidir; `...b` (yayma) değildir.
    const property = code[j] === '.' && !(code[j - 1] === '.' && code[j - 2] === '.');
    out.push({ index: match.index, property });
  }
  return out;
}

/** Serbest tanımlayıcı olarak yasak adlar: bağlamda ya hiç yokturlar ya da çitin dışına açılan kapılardır. */
const BANNED_IDENTIFIERS: Record<string, string> = {
  process: 'Süreç nesnesine (process) erişim yasak.',
  require: 'require yasak: yetenekler modül yükleyemez, yalnız ctx kullanır.',
  module: 'module nesnesi yok; dışa aktarım için "export const tools = { ... }" kullan.',
  eval: 'eval yasak.',
  Function: 'Function kurucusu yasak (metinden kod üretimi).',
  AsyncFunction: 'Metinden kod üretimi yasak.',
  GeneratorFunction: 'Metinden kod üretimi yasak.',
  globalThis: 'Küresel nesneye (globalThis) erişim yasak.',
  global: 'Küresel nesneye (global) erişim yasak.',
  window: 'window yok; yetenek tarayıcıda koşmaz.',
  self: 'self yok; küresel nesneye erişim yasak.',
  fetch: 'Doğrudan fetch yasak: ağ yalnız ctx.fetch ile ve manifestteki net.hosts adreslerine yapılır.',
  XMLHttpRequest: 'Doğrudan ağ erişimi yasak; ctx.fetch kullan.',
  WebSocket: 'Doğrudan ağ erişimi yasak; ctx.fetch kullan.',
  EventSource: 'Doğrudan ağ erişimi yasak; ctx.fetch kullan.',
  WebAssembly: 'WebAssembly yasak.',
  SharedArrayBuffer: 'SharedArrayBuffer yasak.',
  Atomics: 'Atomics yasak.',
  Buffer: 'Buffer yok; metin ve JSON ile çalış.',
  Deno: 'Çalışma zamanı nesnelerine erişim yasak.',
  Bun: 'Çalışma zamanı nesnelerine erişim yasak.',
  setInterval: 'setInterval yok; gerekirse setTimeout ile yinele (en çok 60 sn).',
  setImmediate: 'setImmediate yok; setTimeout kullan.',
  __dirname: 'Dosya sistemi yolu yok; yetenekler dosyaya erişemez.',
  __filename: 'Dosya sistemi yolu yok; yetenekler dosyaya erişemez.',
};

/** Nokta ile erişimi yasak özellikler (kurucu zinciri, çağıran işlev, yığın kancası, Node iç kapıları). */
const BANNED_PROPERTIES: Record<string, string> = {
  constructor: '.constructor erişimi yasak (kurucu zinciriyle kod üretimi).',
  // Hesaplanan anahtar: düz `__proto__:` yazımı özellik değil, nesnenin prototipini kurar.
  ['__proto__']: '.__proto__ erişimi yasak.',
  caller: '.caller erişimi yasak.',
  callee: '.callee erişimi yasak.',
  prepareStackTrace: 'Error.prepareStackTrace yasak.',
  mainModule: 'Node iç kapılarına erişim yasak.',
  binding: 'Node iç kapılarına erişim yasak.',
  dlopen: 'Node iç kapılarına erişim yasak.',
  getBuiltinModule: 'Node iç kapılarına erişim yasak.',
};

const BANNED_STRINGS: Record<string, string> = {
  constructor: '"constructor" adıyla erişim yasak.',
  ['__proto__']: '"__proto__" adıyla erişim yasak.',
  child_process: 'Süreç başlatma yasak.',
  electron: 'Electron erişimi yasak.',
};

function auditScan(source: string, scanned: Scan): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const { code, strings } = scanned;
  const add = (rule: string, message: string, index: number) => issues.push({ rule, message, line: lineOf(source, index) });

  for (const match of code.matchAll(/(?<![\w$.])import(?![\w$])/g)) {
    const rest = code.slice(match.index + 6).trimStart();
    if (rest.startsWith('(')) {
      add('import', 'Dinamik import() yasak: yetenekler modül yükleyemez.', match.index);
    } else if (rest.startsWith('.')) {
      add('import', 'import.meta yasak.', match.index);
    } else {
      const target = strings.find((item) => item.index > match.index && lineOf(source, item.index) === lineOf(source, match.index));
      const what = target ? ` ("${target.value}")` : '';
      add('import', `İçe aktarım yasak${what}: yetenekler dosyaya, kabuğa, ağa ya da Node modüllerine doğrudan ulaşamaz; yalnız ctx kullanılır.`, match.index);
    }
  }

  for (const [name, message] of Object.entries(BANNED_IDENTIFIERS)) {
    for (const hit of occurrences(code, name)) {
      if (!hit.property) add(name, message, hit.index);
    }
  }
  for (const [name, message] of Object.entries(BANNED_PROPERTIES)) {
    for (const hit of occurrences(code, name)) {
      if (hit.property) add(name, message, hit.index);
    }
  }
  // `globalThis.process`, `x.process.env` gibi erişimler: özellik olarak da yasak.
  for (const hit of occurrences(code, 'process')) {
    if (hit.property) add('process', 'Süreç nesnesine (process) erişim yasak.', hit.index);
  }

  for (const item of strings) {
    const value = item.value.trim();
    if (value.startsWith('node:')) add('node-module', `Node modülü adı yasak ("${value}").`, item.index);
    const banned = BANNED_STRINGS[value];
    if (banned) add('string', banned, item.index);
  }

  for (const match of code.matchAll(/\\u/g)) add('escape', 'Tanımlayıcıda unicode kaçışı yasak.', match.index);
  for (const match of code.matchAll(/(?<![\w$.])with\s*\(/g)) add('with', 'with deyimi yasak.', match.index);
  for (const match of code.matchAll(/(?<![\w$.])debugger(?![\w$])/g)) add('debugger', 'debugger deyimi yasak.', match.index);

  return issues;
}

const DECLARATION = /^export\s+(async\s+function\s*\*?|function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/;

/**
 * Dosyayı denetler ve konak için gövdeye çevirir: `export` sözcükleri kaldırılır, dışa aktarılan adlar gövdenin
 * sonunda `__exports` nesnesine yazılır. Konak ES modülü yükleyemez (Electron `utilityProcess` içinde `vm` modülleri
 * açılamıyor); bu yüzden yalnız satır başındaki yalın `export` biçimleri kabul edilir.
 */
export function prepareSource(source: string, file: 'index.mjs' | 'selftest.mjs'): PreparedSource {
  const failed = (issues: AuditIssue[]): PreparedSource => ({ ok: false, issues, script: '', exports: [] });
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
    return failed([{ rule: 'size', message: `${file} çok büyük (en çok ${MAX_SOURCE_BYTES / 1000} KB).`, line: 1 }]);
  }
  if (source.includes('\0')) return failed([{ rule: 'binary', message: `${file} metin dosyası olmalı.`, line: 1 }]);

  const scanned = scan(source);
  const issues = auditScan(source, scanned);
  const exports: string[] = [];
  const edits: Array<{ start: number; end: number; text: string }> = [];

  for (const match of scanned.code.matchAll(/(?<![\w$.])export(?![\w$])/g)) {
    const index = match.index;
    const lineStart = scanned.code.lastIndexOf('\n', index - 1) + 1;
    const rest = scanned.code.slice(index);
    const report = (message: string) => issues.push({ rule: 'export', message, line: lineOf(source, index) });
    if (scanned.code.slice(lineStart, index).trim() !== '') {
      report('export satır başında olmalı.');
      continue;
    }
    const asDefault = /^export\s+default(?![\w$])/.exec(rest);
    if (asDefault) {
      if (exports.includes('default')) report('Birden çok "export default" olamaz.');
      exports.push('default');
      edits.push({ start: index, end: index + asDefault[0].length, text: '__exports.default =' });
      continue;
    }
    const declaration = DECLARATION.exec(rest);
    if (!declaration) {
      report('Desteklenmeyen export biçimi. Kullan: "export const ad = …", "export function ad() {…}" ya da "export default …".');
      continue;
    }
    exports.push(declaration[2]!);
    edits.push({ start: index, end: index + 6, text: '      ' });
  }

  const required = file === 'index.mjs' ? 'tools' : 'default';
  if (!exports.includes(required)) {
    issues.push({
      rule: 'export',
      message:
        file === 'index.mjs'
          ? 'index.mjs "export const tools = { ... }" vermeli.'
          : 'selftest.mjs "export default async function ({ tools, ctx, assert, effects }) { ... }" vermeli.',
      line: 1,
    });
  }
  if (issues.length > 0) return failed(issues.sort((a, b) => a.line - b.line));

  let script = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    script = script.slice(0, edit.start) + edit.text + script.slice(edit.end);
  }
  const named = exports.filter((name) => name !== 'default');
  script += `\n;${named.map((name) => `__exports.${name} = ${name};`).join(' ')}`;
  return { ok: true, issues: [], script, exports };
}

export function describeIssues(file: string, issues: AuditIssue[]): string[] {
  return issues.map((issue) => `${file} satır ${issue.line}: ${issue.message}`);
}

// ───────────────────────────── eklenti sayfası (page.html) ─────────────────────────────

/** SVG/XML ad alanı bildirimleri ağ isteği değildir; dış kaynak denetiminde sayılmaz. */
const NAMESPACE_URL = /https?:\/\/www\.w3\.org\/[^\s"'<>)]*/gi;
const REMOTE_URL = /\b(?:https?|wss?|ftp):\/\//i;
const PROTOCOL_RELATIVE = /(?:\bsrc|\bhref|\baction|url\()\s*=?\s*["']?\s*\/\//i;

/**
 * Eklenti sayfasının statik denetimi. Sayfa güvenli kutuda (opak kökenli çerçeve + içerik güvenlik politikası) koşar;
 * asıl çit odur. Bu denetim, kutuda zaten çalışmayacak şeyleri (dış kaynak, iç çerçeve, başka belgeye yönlendirme)
 * yapımda yakalar ve yazan modele nedenini söyler.
 */
export function auditPage(html: string, file: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const add = (rule: string, message: string, index = 0) => issues.push({ rule, message, line: lineOf(html, index) });
  if (Buffer.byteLength(html, 'utf8') > MAX_SOURCE_BYTES) {
    add('size', `${file} çok büyük (en çok ${MAX_SOURCE_BYTES / 1000} KB).`);
    return issues;
  }
  if (html.includes('\0')) {
    add('binary', `${file} metin dosyası olmalı.`);
    return issues;
  }
  if (html.trim() === '') add('empty', `${file} boş.`);
  const withoutNamespaces = html.replace(NAMESPACE_URL, (match) => ' '.repeat(match.length));
  const remote = REMOTE_URL.exec(withoutNamespaces) ?? PROTOCOL_RELATIVE.exec(withoutNamespaces);
  if (remote) {
    add('remote', 'Sayfa dış bir adres içeriyor. Sayfada ağ yoktur: bütün betik, stil ve görseller belgenin içinde olmalı; veri için fuber.call ile eklentinin aracını çağır.', remote.index);
  }
  for (const [rule, pattern, message] of [
    ['iframe', /<\s*(?:iframe|frame|object|embed|portal)\b/i, 'İç çerçeve ve gömülü nesne (iframe, object, embed) kullanılamaz.'],
    ['meta', /<\s*meta[^>]+http-equiv/i, 'meta http-equiv kullanılamaz (içerik politikası ve yönlendirme uygulamaya aittir).'],
    ['base', /<\s*base\b/i, '<base> kullanılamaz.'],
    ['form', /<\s*form[^>]+action\s*=/i, 'Form bir adrese gönderilemez; düğmeye tıklamayı betikle ele al.'],
    ['worker', /\b(?:Worker|SharedWorker|importScripts)\s*\(/, 'Worker kullanılamaz.'],
    ['navigate', /\b(?:top|parent)\s*\.\s*location\b|\bwindow\s*\.\s*open\s*\(/, 'Sayfa başka bir adrese gidemez ve pencere açamaz.'],
  ] as const) {
    const hit = pattern.exec(html);
    if (hit) add(rule, message, hit.index);
  }
  return issues;
}
