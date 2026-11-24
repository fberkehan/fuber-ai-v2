// Kaynak dosyadaki GÖRÜNEN metinler (0.10 Görev 3, tek sözlük taraması): TypeScript sözdizim ağacından — yorumlar kendiliğinden düşer,
// kesme işareti ya da ters tırnak içeren yorum bir dizgiyi "açmaz" (düzenli ifadeyle tarayan eski yöntemin yanlış eşleşmesi).
// Görünen metin: JSX metni, içinde boşluk olan tırnaklı yazı, ifadeye bitişik olsa da şablon dizgisi (${…} yerine "…") ve tek sözcük
// (küçük, Büyük ya da TAMAMI BÜYÜK). Kimlik gibi duran tek parça yazılar (- : / . _ # @ \ içeren: "yerel-beyin", "beyin:durum", yol, dosya
// adı) sayılmaz. Sayılmayanlar ayrıca: içe/dışa aktarma yolları, tür konumundaki dizgiler, console.* bağımsız değişkenleri (günlük),
// karşılaştırılan anahtarlar (ad === 'beyin', case 'beyin'), `id` özelliği, className / key / data-* / id öznitelikleri ve `atlaOzellik`te
// adı geçen nesne özelliklerinin değerleri (ör. beyin.ts `anatomi`: yalnız telefon gösterir, P8). `yalnizOzellik`: yalnız o özelliklerin
// değerleri (ör. araç tanımlarının sohbette görünen `etiket`i; açıklama modele gider). `sozcuk`: boşluksuz, küçük harfle başlayan tek parça
// (anahtar da olabilir — çağıran karar verir). Dosya *.test.ts değildir: `npm test` onu tek başına çalıştırmaz.
import ts from 'typescript';

export interface GorunenMetin { metin: string; satir: number; sozcuk: boolean }

const OZNITELIK_DISI = /^(className|key|id|style|href|src|type|role|data-.*|aria-(?:controls|labelledby|describedby))$/;
const KIMLIK_AYRACI = /[-:/._#@\\]/;
const ESITLIK = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);

export function gorunenMetinler(dosya: string, kaynak: string, o: { atlaOzellik?: ReadonlySet<string>; yalnizOzellik?: ReadonlySet<string> } = {}): GorunenMetin[] {
  const sf = ts.createSourceFile(dosya, kaynak, ts.ScriptTarget.Latest, true, dosya.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: GorunenMetin[] = [];
  const ad = (n: ts.PropertyName) => n.getText(sf).replace(/^['"]|['"]$/g, '');
  const ekle = (metin: string, n: ts.Node, sablon = false) => {
    const t = metin.replace(/\s+/g, ' ').trim();
    if (!/\p{L}/u.test(t)) return;
    const bosluklu = /\s/.test(t);
    if (!bosluklu && !sablon && KIMLIK_AYRACI.test(t)) return;
    if (!bosluklu && sablon && KIMLIK_AYRACI.test(t.replace(/…/g, ''))) return;
    out.push({ metin: t, satir: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, sozcuk: !bosluklu && /^\p{Ll}/u.test(t) });
  };
  const disarida = (n: ts.Node): boolean => {
    const p0 = n.parent;
    if (p0 && ts.isBinaryExpression(p0) && ESITLIK.has(p0.operatorToken.kind)) return true;
    if (p0 && ts.isCaseClause(p0) && p0.expression === n) return true;
    if (p0 && ts.isPropertyAssignment(p0) && p0.initializer === n && ad(p0.name) === 'id') return true;
    let istenen = !o.yalnizOzellik;
    for (let p: ts.Node | undefined = p0; p; p = p.parent) {
      if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isExternalModuleReference(p)) return true;
      if (ts.isJsxAttribute(p) && OZNITELIK_DISI.test(p.name.getText(sf))) return true;
      if (ts.isPropertyAssignment(p) && o.atlaOzellik?.has(ad(p.name))) return true;
      if (ts.isPropertyAssignment(p) && o.yalnizOzellik?.has(ad(p.name))) istenen = true;
      if (ts.isCallExpression(p) && /^console\.\w+$/.test(p.expression.getText(sf))) return true;
    }
    return !istenen;
  };
  const gez = (n: ts.Node): void => {
    if (ts.isJsxText(n)) { if (!o.yalnizOzellik) ekle(n.text, n); }
    else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !disarida(n)) ekle(n.text, n);
    else if (ts.isTemplateExpression(n) && !disarida(n)) ekle(n.head.text + n.templateSpans.map((s) => `…${s.literal.text}`).join(''), n, true);
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return out;
}
