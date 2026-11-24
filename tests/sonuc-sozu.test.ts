// 0.14 T34b · Sonuç sözü kapısı (ürün kuralı P14): gizlilik ve güvence metni mutlak söz ya da sonuç sözü vermez ("hiçbir şey çıkmaz",
// "buluta gitmez"); yalnız neyin KAPALI olduğunu ya da nasıl çalıştığını söyler ("Gizli modda buluttaki yapay zekâ kapalı").
//  - Kaynak taraması: src/ altındaki her .ts/.tsx dosyasının dizgeleri (TypeScript AST'sinden string, şablon parçası, JSX metni; yorumlar AST'de
//    yoktur). Yasak kalıplar aşağıda; eşleşme ancak İZİN listesindeki bir kayıtla (dosya + metin parçası + tek satır gerekçe) geçer.
//  - İzin listesi küçük ve açıktır: yalnız doğrulanmış teknik ifadeler ve modele giden talimatlar (kullanıcı görmez). Kullanılmayan kayıt testi
//    düşürür (liste bayatlamaz).
//  - Tek kaynak: "Nerede çalışır / Gizli / Yalnız bu bilgisayar" sözleri shared/gizlilik-metni.ts'tedir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const kok = path.resolve(import.meta.dirname, '..');
function dosyalar(d: string): string[] {
  return fs.readdirSync(path.join(kok, d), { withFileTypes: true }).flatMap((e) => {
    const g = `${d}/${e.name}`;
    return e.isDirectory() ? dosyalar(g) : /\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name) ? [g] : [];
  });
}
function dizgeler(g: string): { satir: number; metin: string }[] {
  const sf = ts.createSourceFile(g, fs.readFileSync(path.join(kok, g), 'utf8'), ts.ScriptTarget.Latest, true, g.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const s: { satir: number; metin: string }[] = [];
  const gez = (n: ts.Node): void => {
    const metin = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || n.kind === ts.SyntaxKind.JsxText ? (n as ts.StringLiteral).text : null;
    if (metin) s.push({ satir: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, metin });
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return s;
}

/** Tanıtım sitesinin Türkçe kolu (satır + etiketsiz metin). */
function siteTr(): { satir: number; metin: string }[] {
  const s = fs.readFileSync(path.join(kok, 'landing/kaynak/sayfa.html'), 'utf8');
  return [...s.matchAll(/\[\[([\s\S]*?)\|\|([\s\S]*?)\|\|([\s\S]*?)\|\|([\s\S]*?)\]\]/g)].map((m) => ({
    satir: s.slice(0, m.index).split('\n').length,
    metin: m[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' '),
  }));
}

/** Telefon kabuğunun (Flutter) Dart dizgeleri: yorum satırları atılır, tek ve çift tırnaklı dizge değişmezleri (T34b düzeltme turu 2, N1). */
function dartDosyalari(d: string): string[] {
  if (!fs.existsSync(path.join(kok, d))) return [];
  return fs.readdirSync(path.join(kok, d), { withFileTypes: true }).flatMap((e) => {
    const g = `${d}/${e.name}`;
    if (e.isDirectory()) return ['build', '.dart_tool', 'android', 'ios', 'web'].includes(e.name) ? [] : dartDosyalari(g);
    return e.name.endsWith('.dart') ? [g] : [];
  });
}
function dartDizgeleri(g: string): { satir: number; metin: string }[] {
  const s: { satir: number; metin: string }[] = [];
  fs.readFileSync(path.join(kok, g), 'utf8').split(/\r?\n/).forEach((l, i) => {
    if (/^\s*\/\//.test(l)) return;
    for (const m of l.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) s.push({ satir: i + 1, metin: m[1] ?? m[2] ?? '' });
  });
  return s;
}

/** Yasak sonuç sözü kalıpları (küçük harfe Türkçe kuralıyla çevrilmiş metinde; sözcük sınırlı). */
const YASAK: readonly [ad: string, kalip: RegExp][] = [
  ['buluta gitmez/çıkmaz/çıkmadı/gönderilmez', /(?<!\p{L})buluta (gitmez|çıkmaz|çıkmadı|gönderilmez)(?!\p{L})/u],
  ['çıkmaz', /(?<!\p{L})çıkmaz(?!\p{L})/u],
  ['gönderilmez', /(?<!\p{L})gönderilmez(?!\p{L})/u],
  ['saklanmaz', /(?<!\p{L})saklanmaz(?!\p{L})/u],
  ['ağa bağlanmaz / ağa çıkmaz', /(?<!\p{L})ağa (bağlanmaz|çıkmaz)(?!\p{L})/u],
  ['hiçbir şey', /(?<!\p{L})hiçbir şey/u],
  ['asla', /(?<!\p{L})asla(?!\p{L})/u],
  ['garanti', /(?<!\p{L})garanti/u],
  ['kesinlikle', /(?<!\p{L})kesinlikle(?!\p{L})/u],
  ['veri tutulmaz', /(?<!\p{L})veri tutulmaz(?!\p{L})/u],
  ['internet istemez', /(?<!\p{L})internet istemez(?!\p{L})/u],
  ['içeriği okuyamaz', /(?<!\p{L})içeriği okuyamaz(?!\p{L})/u],
  // Düzeltme turu 1 (I1, Kaygı 3): "kalır" ve "her şey" sonuç sözleri — her "kalır" değil, yalnız yer sözü ve "her şey … kalır".
  ['bu bilgisayarda kalır', /(?<!\p{L})bilgisayar(ın)?(ın)?da kalır(?!\p{L})/u],
  ['her şey … kalır', /(?<!\p{L})her şey[^.;:]*(?<!\p{L})kalır(?!\p{L})/u],
  ['göremez', /(?<!\p{L})göremez(?!\p{L})/u],
  ['okunamaz', /(?<!\p{L})okunamaz(?!\p{L})/u],
  ['gitmez', /(?<!\p{L})gitmez(?!\p{L})/u],
];

/** İzin listesi: dosya + dizgenin içerdiği parça (büyük/küçük harf duyarsız) + tek satır gerekçe. */
const IZIN: readonly { dosya: string; parca: string; neden: string }[] = [
  { dosya: 'src/shared/kurulum-metin.ts', parca: 'bu bilgisayarda saklanmaz', neden: 'Hesap şifresi diske yazılmaz, yalnız oturum anahtarı tutulur (T32 incelemesinde doğrulandı: main/hesap.ts).' },
  { dosya: 'src/main/ajan/anlatim-kurali.ts', parca: 'hiçbir şey yazma', neden: 'Modele giden araç anlatım ve sesli tur talimatları; kullanıcı görmez.' },
  { dosya: 'src/main/ajan/kisilik.ts', parca: 'Uydurma atıf ASLA verme', neden: 'Modele giden kişilik talimatı; kullanıcı görmez.' },
  { dosya: 'src/main/ajan/kisilik.ts', parca: 'kimlik numarası ASLA girme', neden: 'Modele giden kişilik talimatı (parola girme yasağı); kullanıcı görmez.' },
  { dosya: 'src/main/entegrasyon/eposta.ts', parca: 'onaylanmazsa gönderilmez', neden: 'Modele giden araç tanımı; onay kapısı kodda (gönderim onaysız çalışmaz).' },
  { dosya: 'src/main/entegrasyon/eposta.ts', parca: 'kayıtlı parola yeni sunucuya gönderilmez', neden: 'Doğrulandı: sunucu bilgisi değişince kayıtlı parola okunmadan hata döner (entegrasyon/eposta.ts sına).' },
  { dosya: 'src/shared/kopru-protokol.ts', parca: 'kayıtlı parola başka bir sunucuya gönderilmez', neden: 'Doğrulandı: telefondan parola olmadan sunucu değiştirilemez, istek reddedilir (uzakEpostaReddi).' },
  { dosya: 'src/shared/form-gonderimi.ts', parca: 'onaylamazsan gönderilmez', neden: 'Onay kapısının işleyişi: gönderim kullanıcı onayına bağlı (form-gonderimi.ts karar işlevi).' },
  { dosya: 'src/main/claudecode/oturum-yoneticisi.ts', parca: 'Boş mesaj gönderilmez.', neden: 'Doğrulama hatası: boş metin reddedilir (aynı satırdaki koşul).' },
  { dosya: 'src/main/claudecode/eklenti-kurucu.ts', parca: 'hiçbir şey açılmadı', neden: 'Geçmiş olayın raporu: arşiv denetimi düşünce açma adımına geçilmeden hata atılır.' },
  { dosya: 'src/renderer/ayarlar/dizin.ts', parca: 'telefondan okunamaz', neden: 'Doğrulandı: sır okuma kanalı yok (ipc.ts yalnız sir:yaz; kopru-protokol.ts sir:yaz telefondan kapalı).' },
  { dosya: 'src/renderer/claudecode/Projeler.tsx', parca: 'Gizli anahtarları ASLA dosyaya yazma', neden: 'Proje CLAUDE.md şablonu: Claude Code modeline talimat; uygulama sözü değil.' },
];

test('P14 · src/ dizgelerinde sonuç sözü yok (yasak kalıplar yalnız izin listesindeki doğrulanmış ifadelerde)', () => {
  const ihlal: string[] = [];
  const kullanilan = new Set<number>();
  // src/ dizgeleri + tanıtım sitesinin [[EN||TR||FR||DE]] dörtlülerinin TR kolu (etiketsiz; ürünün sözüyle aynı kural).
  // Açık kaynak hazırlığı: tanıtım sitesi (landing/) ve telefon (mobil/) yalnız özel depoda.
  const siteVar = fs.existsSync(path.join(kok, 'landing/kaynak/sayfa.html'));
  const kaynaklar = [...dosyalar('src').map((g) => [g, dizgeler(g)] as const), ...(siteVar ? [['landing/kaynak/sayfa.html', siteTr()] as const] : []), ...dartDosyalari('mobil').map((g) => [g, dartDizgeleri(g)] as const)];
  for (const [g, liste] of kaynaklar) {
    for (const d of liste) {
      const kucuk = d.metin.toLocaleLowerCase('tr');
      for (const [ad, kalip] of YASAK) {
        if (!kalip.test(kucuk)) continue;
        const i = IZIN.findIndex((z) => z.dosya === g && kucuk.includes(z.parca.toLocaleLowerCase('tr')));
        if (i >= 0) { kullanilan.add(i); continue; }
        ihlal.push(`${g}:${d.satir} [${ad}] «${d.metin.replace(/\s+/g, ' ').slice(0, 160)}»`);
      }
    }
  }
  assert.deepEqual(ihlal, [], `Sonuç sözü (neyin kapalı olduğunu ya da nasıl çalıştığını söyle; doğrulanmış teknik ifadeyse gerekçesiyle IZIN'e yaz):\n${ihlal.join('\n')}`);
  const bayat = IZIN.filter((z, i) => !kullanilan.has(i) && fs.existsSync(path.join(kok, z.dosya))).map((z) => `${z.dosya} «${z.parca}»`);
  assert.deepEqual(bayat, [], `Kullanılmayan izin kaydı (sil):\n${bayat.join('\n')}`);
});

test('P14 · kapı kör değil: yasak kalıplar örnek sonuç sözlerini yakalar, durum sözlerini geçirir', () => {
  const yakalar = (s: string) => YASAK.some(([, k]) => k.test(s.toLocaleLowerCase('tr')));
  for (const s of ['Yanıtlar buluta gitmez.', 'Buluta çıkmadı', 'Ses bu bilgisayardan çıkmaz.', 'hesap ağa bağlanmaz', 'HİÇBİR ŞEY gönderilmez', 'Telefonda veri tutulmaz.', 'internet istemez', 'Asla yazmaz.', 'garantili', 'Kesinlikle güvenli.', 'her şey bilgisayarında kalır', 'yazdıkların bu bilgisayarda kalır', 'Köprü içeriği göremez.', 'telefona gitmez']) assert.ok(yakalar(s), s);
  for (const s of ['Gizli modda buluttaki yapay zekâ kapalı.', 'Ses bu bilgisayarda yazıya dökülür.', 'Bu bilgisayarda üretilir; çevrimdışı çalışır.', 'uçtan uca şifrelenir', 'hiçbir pencere mikrofonu açamaz', 'başlat', 'çıkmazsa']) assert.ok(!yakalar(s), s);
});

test('P14 · tek kaynak: Nerede / Gizli / Yalnız bu bilgisayar sözleri shared/gizlilik-metni.ts\'ten', async () => {
  const gm = await import('../src/shared/gizlilik-metni.ts');
  const km = await import('../src/shared/kurulum-metin.ts');
  assert.equal(km.KM.inisGizli, gm.GM.inisGizli);
  assert.equal(km.KM.inisYerel, gm.GM.inisYerel);
  // Her söz neyin kapalı olduğunu söyler.
  assert.match(gm.GIZLI_BULUT_KAPALI, /^Gizli modda buluttaki yapay zekâ kapalı$/);
  for (const c of [gm.GM.inisGizli, gm.GM.inisYerel]) for (const s of c) assert.match(s, /buluttaki yapay zekâ kapalı\.$/);
  const kaynak = (g: string) => fs.readFileSync(path.join(kok, g), 'utf8');
  // Grup A'nın bütün yerleri ortak kaynağı okur.
  for (const g of [
    'src/renderer/kurulum2/NeredeAdimi.tsx', 'src/shared/nerede.ts', 'src/renderer/ayarlar/Gizlilik.tsx', 'src/shared/kurulum-yerel.ts',
    'src/shared/motor-durumu.ts', 'src/shared/tek-motor.ts', 'src/shared/abonelik.ts', 'src/renderer/ayarlar/dizin.ts',
  ]) assert.match(kaynak(g), /from '[./]+(shared\/)?gizlilik-metni(\.ts)?'/, `${g}: shared/gizlilik-metni.ts'i içe aktarmıyor`);
  // N3: Ayarlar → Gizlilik, kurulumla aynı iniş notunu söyler.
  assert.match(kaynak('src/renderer/ayarlar/Gizlilik.tsx'), /GM\.inisGizli/);
  assert.match(kaynak('src/renderer/ayarlar/Gizlilik.tsx'), /GM\.inisYerel/);
});
