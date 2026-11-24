// ── Claude Code araçları: oturumları bul, bir oturumun son hâline bak, iş ver ─────────────────────────────────────
// 0.14 T13: ajan küçük kod işini kendi dosya ve komut araçlarıyla yapar; büyük kod işini kullanıcının Claude Code aboneliğine bu araçlarla verir
// (kişilik kuralı: ajan/kod-isleri.ts). Görev 27 (K17):
// claude_code_gorev artık UYGULAMA İÇİ oturum başlatır (Claude Code sayfasında canlı; izinler orada ve adada; bitince bu sohbete kısa
// özet — main/claudecode/yonetim.ts). Eski yol (görünür terminal) Ayarlar'da seçenek: claudeCode.yol = 'terminal'.
import fs from 'node:fs';
import { aracKaydet, sema, metinKisalt, type Arac } from '../ajan/araclar/kayit.js';
import { ayarlar } from '../ayarlar.js';
import { ccTara, ccBul, type CcOturum } from './indeks.js';
import { ccAra } from '../../shared/cc-ara.js';
import { harnesBildirimleri } from '../../shared/cc-olay.js';
import { terminaldeAc } from './baslat.js';
import { ccYonetici, ccProjeKlasoru } from './yonetim.js';
import { ccGorevCalistir } from './gorev.js';

const goreli = (iso?: string) => {
  if (!iso) return '?';
  const dk = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return dk < 60 ? `${dk} dk önce` : dk < 1440 ? `${Math.round(dk / 60)} sa önce` : `${Math.round(dk / 1440)} gün önce`;
};
const satir = (o: CcOturum) => `[${o.id.slice(0, 8)}] ${o.baslik} · ${o.proje} (${o.cwd || '?'})${o.dal ? ` · dal ${o.dal}` : ''} · son: ${goreli(o.sonZaman)} · ${o.istemSayisi} istem\n   ilk: ${metinKisalt(o.ilk ?? '', 140)}\n   son: ${metinKisalt(o.son ?? '', 140)}`;

/** Bir oturumun son kısmı (dosyanın son ~3 MB'ı): son istemler ve Claude'un son yanıt metinleri. */
function sonHal(o: CcOturum): string {
  const boyut = fs.statSync(o.dosya).size;
  const n = Math.min(boyut, 3 * 1024 * 1024);
  const fd = fs.openSync(o.dosya, 'r');
  const b = Buffer.alloc(n);
  fs.readSync(fd, b, 0, n, boyut - n);
  fs.closeSync(fd);
  const satirlar = b.toString('utf8').split('\n').slice(1);
  const out: string[] = [];
  for (const s of satirlar) {
    if (s.length > 400_000 || s.includes('"tool_result"')) continue;
    let j: { type?: string; isMeta?: boolean; isSidechain?: boolean; message?: { content?: unknown } };
    try { j = JSON.parse(s); } catch { continue; }
    if (j.isMeta || j.isSidechain || (j.type !== 'user' && j.type !== 'assistant')) continue;
    const c = j.message?.content;
    const metin = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p: { type?: string }) => p?.type === 'text').map((p: { text?: string }) => p.text ?? '').join('\n') : '';
    const temiz = metin.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
    // 5 Kas: koşum bildirimi (arka plan işi bitti…) kullanıcı sözü değil — modele "Kullanıcı:" diye gitmez.
    const bildirim = j.type === 'user' ? harnesBildirimleri(temiz) : null;
    if (bildirim) { out.push(`Claude Code: ${bildirim.map((x) => x.metin).join(' · ')}`); continue; }
    if (temiz) out.push(`${j.type === 'user' ? 'Kullanıcı' : 'Claude'}: ${metinKisalt(temiz.replace(/\s+/g, ' '), 500)}`);
  }
  return out.slice(-14).join('\n');
}

const araclar: Arac[] = [
  {
    grup: 'claudecode', risk: 'serbest',
    etiket: (g) => (g.ara ? `Claude Code oturumlarında arıyor: “${metinKisalt(String(g.ara), 40)}”` : 'Claude Code oturumlarına bakıyor'),
    tanim: {
      ad: 'claude_code_oturumlari',
      aciklama: 'Kullanıcının bilgisayarındaki Claude Code oturumlarını (tüm projeler, terminal açık olmasa da) listeler ya da arar: başlık, proje klasörü, dal, son etkinlik, ilk/son istem. "Şu projedeki sohbet", "geçen hafta ödeme ekranında çalıştığım" gibi isteklerde doğru oturumu bulmak için kullan.',
      sema: sema({ ara: { type: 'string', description: 'Konu/proje anahtar kelimeleri (boş = en yeniler)' }, proje: { type: 'string', description: 'Proje klasör adı süzgeci (isteğe bağlı)' }, adet: { type: 'integer', description: 'En çok kaç sonuç (varsayılan 8)' } }),
    },
    async calistir(g) {
      const liste = await ccTara();
      const proje = String(g.proje ?? '').toLowerCase();
      const suzulu = proje ? liste.filter((o) => o.proje.toLowerCase().includes(proje) || o.cwd.toLowerCase().includes(proje)) : liste;
      const adet = Math.min(20, Math.max(1, Number(g.adet) || 8));
      const sonuc = g.ara ? ccAra(suzulu, String(g.ara)).slice(0, adet).map((x) => x.oturum) : suzulu.slice(0, adet);
      if (!sonuc.length) return { icerik: `Eşleşen Claude Code oturumu yok (${liste.length} oturum tarandı).`, ozet: '0 oturum' };
      return { icerik: `${liste.length} oturum içinden:\n${sonuc.map(satir).join('\n')}`, ozet: `${sonuc.length} oturum` };
    },
  },
  {
    grup: 'claudecode', risk: 'serbest',
    etiket: () => 'Claude Code oturumunun son hâline bakıyor',
    tanim: {
      ad: 'claude_code_oturum',
      aciklama: 'Bir Claude Code oturumunda en son ne konuşulduğunu (son istemler ve Claude\'un son yanıtları) okur. "O sohbette nerede kalmıştık?" için.',
      sema: sema({ oturum_id: { type: 'string', description: 'claude_code_oturumlari\'nın verdiği kimlik (ilk 8 karakter yeter)' } }, ['oturum_id']),
    },
    async calistir(g) {
      await ccTara();
      const o = ccBul(String(g.oturum_id));
      if (!o) return { icerik: 'Bu kimlikle oturum bulunamadı.', hata: true };
      return { icerik: `${satir(o)}\n\nSon konuşma:\n${sonHal(o) || '(okunacak metin yok)'}`, ozet: o.baslik };
    },
  },
  {
    grup: 'claudecode', risk: 'kontrol',
    etiket: (g) => `Claude Code'a iş veriyor: “${metinKisalt(String(g.komut ?? ''), 40)}”`,
    tanim: {
      ad: 'claude_code_gorev',
      aciklama: 'Claude Code\'a iş verir: Fuber uygulamasının içinde bir Claude Code oturumu başlatır (Claude Code sayfasında canlı izlenir; izin isterse orada ve adada görünür; bitince sonucu bu sohbete kısaca yazarsın). oturum_id verilirse o sohbet sürdürülür (doğru proje klasöründe); yoksa klasor\'de yeni oturum açar. Oturum başka bir yerde (terminalde) açıksa doğrudan sürdürülmez: kullanıcıya sor, isterse catalla: true ile yeni bir kolda sürdür. KOMUTU KULLANICININ SÖYLEDİĞİ GİBİ AKTAR; kendi fikrini ya da ek işi ekleme. Büyük kod işi (çok dosyalı değişiklik, proje çapında iş) için kullan; küçük düzeltmeyi kendi dosya ve komut araçlarınla yap.',
      sema: sema({
        komut: { type: 'string', description: 'Claude Code\'a verilecek komut (kullanıcının sözleri, gerekirse yalnız netleştirilmiş)' },
        oturum_id: { type: 'string', description: 'Devam ettirilecek oturum (claude_code_oturumlari\'ndan)' },
        klasor: { type: 'string', description: 'Yeni oturum için proje klasörü (oturum_id yoksa)' },
        catalla: { type: 'boolean', description: 'oturum_id başka yerde açıksa: kullanıcı isterse true → o sohbetin kopyasında (yeni kimlik) sürdür' },
      }, ['komut']),
    },
    // Kararlar gorev.ts'te (birim testli); burada gerçek bağımlılıklar verilir.
    calistir: (g, b) => ccGorevCalistir(g, b, {
      oturumBul: async (id) => { await ccTara(); return ccBul(id); },
      ayar: () => { const a = ayarlar(); return { genelTamYetki: a.yetki.tamYetki, claudeTamYetki: a.claudeCode.tamYetki, yol: a.claudeCode.yol }; },
      projeKlasoru: ccProjeKlasoru,
      terminaldeAc,
      baslat: (i) => ccYonetici().baslat(i),
      klasorGuveni: (cwd) => ccYonetici().guvenDurumu(cwd),
      modOnizleme: (kimlik) => ccYonetici().sohbetModu(kimlik),
    }),
  },
];

export function claudeCodeAraclariniKaydet(): void { aracKaydet(...araclar); }
