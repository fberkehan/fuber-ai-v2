// Fark (diff) yardımcıları (v1 `renderer/claudecode/fark.ts`'ten). Saf. Üç kaynak aynı satır modeline çevrilir:
//  • Edit/MultiEdit girdisi (old_string → new_string): Myers satır farkı; dosyadaki gerçek satır numarası araç sonucundaki
//    `cat -n` parçasından bulunabiliyorsa oradan, bulunamazsa numara YOK (yanıltıcı göreli numara yazılmaz).
//  • Write girdisi (content): bütün satırlar eklenen.
//  • `git diff` çıktısı: birleşik fark ayrıştırılır; numaralar parça başlığından.

export type DiffKind = 'same' | 'add' | 'del';
export interface DiffLine {
  kind: DiffKind;
  text: string;
  oldNo?: number;
  newNo?: number;
}
export interface DiffHunk {
  header?: string;
  lines: DiffLine[];
}
export interface DiffFile {
  path: string;
  oldPath?: string;
  created: boolean;
  deleted: boolean;
  binary: boolean;
  hunks: DiffHunk[];
  added: number;
  removed: number;
}

/** Metni satırlara böler (CRLF → LF; sondaki tek boş satır sayılmaz). */
export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

type Op = '=' | '-' | '+';

/** Myers O(ND) satır farkı. `limit` adımı aşan (çok farklı) girdilerde `null`: çağıran "hepsi silindi, hepsi eklendi"ye düşer. */
export function myers(a: readonly string[], b: readonly string[], limit = 1200): Op[] | null {
  const n = a.length;
  const m = b.length;
  if (!n) return Array<Op>(m).fill('+');
  if (!m) return Array<Op>(n).fill('-');
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  const top = Math.min(max, limit);
  for (let d = 0; d <= top; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], n: number, m: number): Op[] {
  const out: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d]!;
    const o = d + 1;
    const k = x - y;
    const prevK = k === -d || (k !== d && v[o + k - 1]! < v[o + k + 1]!) ? k + 1 : k - 1;
    const prevX = v[o + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push('=');
      x--;
      y--;
    }
    if (d > 0) out.push(x === prevX ? '+' : '-');
    x = prevX;
    y = prevY;
  }
  return out.reverse();
}

/** İki metnin satır farkı. Başlangıç numaraları verilirse satırlar oradan sayılır; verilmezse numara yok. */
export function lineDiff(before: string, after: string, options: { oldStart?: number; newStart?: number; limit?: number } = {}): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const mid = myers(midA, midB, options.limit) ?? [...Array<Op>(midA.length).fill('-'), ...Array<Op>(midB.length).fill('+')];
  const numbered = options.oldStart !== undefined || options.newStart !== undefined;
  let oldNo = options.oldStart ?? options.newStart ?? 1;
  let newNo = options.newStart ?? options.oldStart ?? 1;
  const out: DiffLine[] = [];
  const push = (kind: DiffKind, text: string) => {
    const line: DiffLine = { kind, text };
    if (numbered) {
      if (kind !== 'add') line.oldNo = oldNo;
      if (kind !== 'del') line.newNo = newNo;
    }
    if (kind !== 'add') oldNo++;
    if (kind !== 'del') newNo++;
    out.push(line);
  };
  for (let i = 0; i < head; i++) push('same', a[i]!);
  let i = 0;
  let j = 0;
  for (const op of mid) {
    if (op === '=') {
      push('same', midA[i]!);
      i++;
      j++;
    } else if (op === '-') {
      push('del', midA[i]!);
      i++;
    } else {
      push('add', midB[j]!);
      j++;
    }
  }
  for (let k = a.length - tail; k < a.length; k++) push('same', a[k]!);
  return out;
}

export const diffCounts = (lines: readonly DiffLine[]) => ({
  added: lines.filter((line) => line.kind === 'add').length,
  removed: lines.filter((line) => line.kind === 'del').length,
});

/** `cat -n` biçimli satırlar ("    12→metin" ya da "    12\tmetin") → numara + metin. */
function numberedLines(output: string): Array<{ no: number; text: string }> {
  const out: Array<{ no: number; text: string }> = [];
  for (const line of output.replace(/\r\n?/g, '\n').split('\n')) {
    const match = /^\s*(\d+)(?:→|\t)(.*)$/.exec(line);
    if (match) out.push({ no: Number(match[1]), text: match[2]! });
  }
  return out;
}

/** Edit sonucunun `cat -n` parçasından yeni metnin dosyadaki ilk satır numarası; tek eşleşme yoksa `null`. */
export function editStart(output: string | undefined, newText: string): number | null {
  if (!output) return null;
  const snippet = numberedLines(output);
  if (!snippet.length) return null;
  const lines = splitLines(newText);
  const index = lines.findIndex((line) => line.trim());
  if (index < 0) return null;
  const wanted = lines[index]!.trimEnd();
  const matches = snippet.filter((item) => item.text.trimEnd() === wanted);
  if (matches.length !== 1) return null;
  const start = matches[0]!.no - index;
  return start >= 1 ? start : null;
}

/** Edit/MultiEdit/Write girdisinden fark satırları (kart ve izin ön izlemesi). Tanınmayan girdi → `null`. */
export function toolDiff(name: string, input: Record<string, unknown>, output?: string): { lines: DiffLine[]; created: boolean } | null {
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : null);
  if (name === 'Write') {
    const content = text('content');
    return content === null ? null : { lines: splitLines(content).map((line, index) => ({ kind: 'add', text: line, newNo: index + 1 })), created: true };
  }
  if (name === 'Edit') {
    const before = text('old_string');
    const after = text('new_string');
    if (before === null || after === null) return null;
    const start = editStart(output, after);
    return { lines: lineDiff(before, after, start ? { oldStart: start, newStart: start } : {}), created: false };
  }
  if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    const lines: DiffLine[] = [];
    for (const edit of input.edits.slice(0, 50)) {
      if (!edit || typeof edit !== 'object') continue;
      const before = (edit as Record<string, unknown>).old_string;
      const after = (edit as Record<string, unknown>).new_string;
      if (typeof before !== 'string' || typeof after !== 'string') continue;
      if (lines.length) lines.push({ kind: 'same', text: '⋯' });
      lines.push(...lineDiff(before, after));
    }
    return lines.length ? { lines, created: false } : null;
  }
  return null;
}

/** `git diff` (birleşik fark) → dosyalar. Başlıksız ekleme listesi ("--- /dev/null / +++ b/x / +…") de okunur. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = Infinity;
  let newLeft = Infinity;
  const open = (path = ''): DiffFile => {
    const next: DiffFile = { path, created: false, deleted: false, binary: false, hunks: [], added: 0, removed: 0 };
    files.push(next);
    hunk = null;
    return next;
  };
  const clean = (value: string) =>
    value
      .replace(/\t.*$/, '')
      .replace(/^"(.*)"$/, '$1')
      .replace(/^[ab]\//, '');
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = open();
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      if (match) {
        file.path = match[2]!;
        if (match[1] !== match[2]) file.oldPath = match[1]!;
      }
      continue;
    }
    if (line.startsWith('--- ') && (!hunk || !file)) {
      if (!file || file.hunks.length) file = open();
      const value = line.slice(4);
      if (value === '/dev/null') file.created = true;
      else if (!file.path) file.path = clean(value);
      continue;
    }
    if (line.startsWith('+++ ') && file && !hunk) {
      const value = line.slice(4);
      if (value === '/dev/null') file.deleted = true;
      else file.path = clean(value);
      continue;
    }
    if (!file) continue;
    if (line.startsWith('new file mode')) {
      file.created = true;
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      file.deleted = true;
      continue;
    }
    if (line.startsWith('rename from ')) {
      file.oldPath = line.slice(12);
      continue;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      file.binary = true;
      continue;
    }
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);
    if (header) {
      oldNo = Number(header[1]);
      newNo = Number(header[3]);
      oldLeft = header[2] === undefined ? 1 : Number(header[2]);
      newLeft = header[4] === undefined ? 1 : Number(header[4]);
      hunk = { ...(header[5] ? { header: header[5] } : {}), lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (line.startsWith('\\')) continue;
    const first = line[0];
    if (!hunk) {
      if (first !== '+') continue;
      oldNo = 0;
      newNo = 1;
      oldLeft = Infinity;
      newLeft = Infinity;
      hunk = { lines: [] };
      file.hunks.push(hunk);
    }
    const current: DiffHunk = hunk;
    if (first === '+') {
      current.lines.push({ kind: 'add', text: line.slice(1), newNo: newNo++ });
      file.added++;
      newLeft--;
    } else if (first === '-') {
      current.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++ });
      file.removed++;
      oldLeft--;
    } else if (first === ' ') {
      current.lines.push({ kind: 'same', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
      oldLeft--;
      newLeft--;
    } else continue;
    if (oldLeft <= 0 && newLeft <= 0) hunk = null;
  }
  return files.filter((item) => item.path || item.hunks.length);
}
