// ── Bilgisayar kullanımı (fare + klavye + ekran) ─────────────────────────────────────────────────────────────
// Browser use ve computer use şart, eklentisiz: asistan kullanıcının faresini ve klavyesini
// kullanabilmeli. → resources/bin/fuber-girdi.exe (C#, Windows API: SendInput,
// CopyFromScreen, EnumWindows) tek süreç olarak açılır, JSON satırlarıyla konuşulur.
// Güvenlik: (1) Ayarlar → Yetkiler'de açık olmalı. (2) Her görevde ilk eylemden önce kullanıcıya sorulur ("bu görev
// için izin ver"). (3) Kontrol sürerken her ekranda ayırt edilir "Fuber" imleci + ince kenar ışığı + "Alt+Shift+Q" şeridi
// (imlec.ts); kısayol bütün ajan turlarını anında keser. Ayarlar → "Tam yetki" açıksa (2) atlanır. (4) Parola/kart girmek, satın almak, silmek kişilikte yasak.
// (5) Kullanıcı fareyi/klavyeyi kendisi kullanmaya başlarsa Fuber eylemi yapmaz, o tur boyunca çekilir (tam yetkide de).
// Model ekran görüntüsünü küçültülmüş (en çok 1366 px) görür; verdiği koordinatlar o görüntüdedir, burada fiziksel
// piksele çevrilir.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { BrowserWindow, screen, shell } from 'electron';
import fs from 'node:fs';
import { yollar } from './yollar.js';
import { ayarlar } from './ayarlar.js';
import { kontrolBasla, kontrolBitirSonra, imlecGit, imlecRozet, hareketSuresi, imlecKapat } from './imlec.js';
import { aracKaydet, sema, metinKisalt, type Arac, type AracBaglami, type AracSonucu } from './ajan/araclar/kayit.js';
import { sonOnayYanitZamani } from './olaylar.js';
import { acilDurdurmaYolu } from './acil-kisayol.js';
import { acilDurdurmaKisayolu } from '../shared/genel-kisayol.js';
import { kisayolOkunur } from '../shared/kisayol.js';
import { yazmaEtiketi } from '../shared/arac-satiri.js';

let surec: ChildProcessWithoutNullStreams | null = null;
let tampon = '';
const bekleyenler: ((s: Record<string, unknown>) => void)[] = [];
let sonGoruntu: { x0: number; y0: number; w: number; h: number; gw: number; gh: number } | null = null;

function yardimci(): ChildProcessWithoutNullStreams {
  if (surec && !surec.killed) return surec;
  // FUBER_GIRDI_KOMUT: yalnız testler için (["node", "scripts/dev/sahte-girdi.mjs"]) — kilitli oturumda ajan döngüsünü sınamak.
  const ozel = process.env.FUBER_GIRDI_KOMUT ? (JSON.parse(process.env.FUBER_GIRDI_KOMUT) as string[]) : null;
  const exe = ozel ? ozel[0] : yollar.kaynak('bin', 'fuber-girdi.exe');
  if (!ozel && !fs.existsSync(exe)) throw new Error('fuber-girdi.exe bulunamadı (kurulum eksik).');
  const p = spawn(exe, ozel ? ozel.slice(1) : [], { windowsHide: true });
  surec = p;
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d: string) => {
    if (surec !== p) return; // durdurulmuş eski sürecin artığı yeni sürecin yanıtlarına karışmasın
    tampon += d;
    let i: number;
    while ((i = tampon.indexOf('\n')) >= 0) {
      const satir = tampon.slice(0, i).trim();
      tampon = tampon.slice(i + 1);
      if (!satir) continue;
      const coz = bekleyenler.shift();
      try { coz?.(JSON.parse(satir)); } catch { coz?.({ ok: false, hata: 'yardımcı yanıtı okunamadı' }); }
    }
  });
  p.on('exit', () => {
    if (surec !== p) return; // girdiYardimcisiniDurdur zaten temizledi; yeniden açılmış süreci silme
    surec = null;
    while (bekleyenler.length) bekleyenler.shift()?.({ ok: false, hata: 'yardımcı kapandı' });
  });
  // Başlatılamadı (ör. güvenlik yazılımı engelledi) ya da kapanmışken yazıldı: dinleyicisiz 'error' ana süreci düşürürdü.
  // Bekleyenler hatayla döner, bir sonraki komut süreci yeniden açmayı dener. (Adanın tam ekranı bu yardımcıyı AÇMAZ: olay güdümlü
  // fuber-olay.exe — olay-yardimcisi.ts, tam-ekran.ts; 0.14 T22.)
  const hata = (e: Error) => {
    if (surec !== p) return;
    surec = null;
    while (bekleyenler.length) bekleyenler.shift()?.({ ok: false, hata: `yardımcı çalışmadı: ${e.message}` });
  };
  p.on('error', hata);
  p.stdin.on('error', hata);
  return p;
}

/** Acil durdurma: yardımcı süreç öldürülür (sürmekte olan uzun `yaz` da kesilir); bekleyen komutlar hatayla döner.
 *  Yalnız bir sonraki GERÇEK bilgisayar komutunda yeniden açılır (tam ekran yoklaması onu açmaz). */
export function girdiYardimcisiniDurdur(): void {
  const p = surec;
  surec = null;
  tampon = '';
  while (bekleyenler.length) bekleyenler.shift()?.({ ok: false, hata: 'Kullanıcı durdurdu (Alt+Shift+Q).' });
  try { p?.kill(); } catch { /* zaten kapalı */ }
}

function komut(k: Record<string, unknown>, zamanAsimi = 20_000): Promise<Record<string, unknown>> {
  const s = yardimci();
  return new Promise((coz, red) => {
    const z = setTimeout(() => red(new Error('Girdi yardımcısı yanıt vermedi')), zamanAsimi);
    bekleyenler.push((r) => {
      clearTimeout(z);
      if (r.ok === false) { red(new Error(String(r.hata))); return; }
      coz(r);
    });
    s.stdin.write(`${JSON.stringify(k)}\n`);
  });
}

// ── İzin: görev başına sorar; Ayarlar → Yetkiler → "Tam yetki" açıksa hiç sormaz ────────────────────────────
async function izinli(b: AracBaglami, amac: string): Promise<boolean> {
  if (ayarlar().yetki.tamYetki || b.gorevIzinleri.has('bilgisayar')) return true;
  // Acil durdurma tuşu yalnız gerçekten alındıysa söylenir (Görev 20b düzeltme turu 2); yoksa tepsideki "Tümünü durdur".
  const yol = acilDurdurmaYolu(kisayolOkunur(acilDurdurmaKisayolu(), process.platform === 'darwin'));
  const k = await b.onay({ baslik: 'Fuber fare ve klavyeni kullanabilir mi?', aciklama: `Bu görev için: ${amac}. İstediğin an ${yol} ile durdurabilirsin.`, tehlike: 'yuksek', gorevBoyu: true });
  if (k === 'reddet') return false;
  if (k === 'bu_gorev') b.gorevIzinleri.add('bilgisayar');
  return true;
}

function fiziksel(x: number, y: number): { x: number; y: number } {
  if (!sonGoruntu) throw new Error('Önce bilgisayar_ekran ile ekrana bak; koordinatlar o görüntüye göredir.');
  const g = sonGoruntu;
  return { x: Math.round(g.x0 + (x / g.gw) * g.w), y: Math.round(g.y0 + (y / g.gh) * g.h) };
}

async function imlecKonumu(): Promise<{ x: number; y: number } | null> {
  try { const r = await komut({ k: 'imlec' }); return { x: Number(r.x), y: Number(r.y) }; } catch { return null; }
}

/** Gerçek imleci ve Fuber imlecini AYNI eğriyle hedefe götürür (ikisi birlikte süzülür, ışınlanma yok). */
async function oraya(hedef: { x: number; y: number }, eylem: string): Promise<void> {
  const bas = await imlecKonumu();
  const sure = hareketSuresi(bas, hedef);
  await Promise.all([imlecGit(bas, hedef, sure, eylem), komut({ k: 'yolla', x: hedef.x, y: hedef.y, sure }, sure + 5000)]);
}

// Ekran görüntüsü: Fuber'in kendi katmanları ve (kontrol sürerken) asistan yakalamadan HARİÇ (içerik koruması);
// eskiden her görüntüde pencereler gizlenip gösteriliyordu → kullanıcı sürekli "kapanıp açılma" görüyordu.
export async function ekranGoruntusu(en = 1366, ekranNo?: number): Promise<AracSonucu> {
  const r = await komut({ k: 'ekran', en, ekran: ekranNo ?? -1 });
  if (r.kilitli) {
    sonGoruntu = null;
    return { icerik: 'Windows oturumu KİLİTLİ (kilit ekranı açık): Windows bu durumda ekran görüntüsünü ve fare/klavye kullanımını engeller. Kullanıcıya kilidi açınca tekrar deneyebileceğini söyle; tahmin yürütme.', hata: true, ozet: 'oturum kilitli' };
  }
  sonGoruntu = { x0: Number(r.x0), y0: Number(r.y0), w: Number(r.w), h: Number(r.h), gw: Number(r.gw), gh: Number(r.gh) };
  const not = r.karanlik ? '\nUYARI: görüntü neredeyse tamamen siyah — ekran uykuda/kapalı olabilir ya da içerik yakalanamıyor (tam ekran video/oyun). Başka ekranı dene (ekran parametresi) ya da kullanıcıya sor.' : '';
  return { icerik: `Ekran görüntüsü ${r.gw}×${r.gh} (gerçek ${r.w}×${r.h}). Koordinatları bu görüntüye göre ver. Kırmızı halka = gerçek imleç.${not}`, gorseller: [{ medya: 'image/jpeg', veri: String(r.jpeg) }], ozet: r.karanlik ? 'siyah görüntü' : `${r.gw}×${r.gh}` };
}

/** 0.11 G9 (düzeltme turu 1): görevin ekran gözcüsünün küçük görüntüsü (base64 JPEG; kilitli/alınamazsa null). `sonGoruntu`ya DOKUNMAZ —
 *  araçların koordinatları modelin gördüğü son görüntüye göredir; gözcünün 160 px'lik bakışı onları ölçeklememeli. */
export async function gozcuEkranGoruntusu(en = 160): Promise<string | null> {
  const r = await komut({ k: 'ekran', en, ekran: -1 });
  return r.kilitli || !r.jpeg ? null : String(r.jpeg);
}

const sonra = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Kullanıcı devralırsa çekil ──────────────────────────────────────────────────────────────────────────────
// Yardımcı kendi gönderdiği son girdinin zamanını tutar; Windows'un son girdi zamanı ondan sonraysa o girdi kullanıcınındır.
// İzleme turun ilk ekran bakışında/eyleminde başlar (sohbete yazıp Enter'a basmak sayılmaz). İşaretler turun izin
// kümesinde tutulur (araç bağlamı her çağrıda yenidir, küme tur boyunca aynıdır). Onay kartına basmak da girdidir:
// onay yanıtından sonraki 1,5 sn sayılmaz.
const IZLENIYOR = 'girdi:izleniyor', DEVRALINDI = 'girdi:devralindi';
const DEVRALINDI_SONUCU: AracSonucu = {
  icerik: 'DURDUM: kullanıcı fareyi/klavyeyi kendisi kullanmaya başladı; kontrol onda. Bu turda başka fare/klavye eylemi YAPMA. Kullanıcıya kısaca nerede kaldığını söyle; "devam et" derse ekrana yeniden bakıp sürdürürsün.',
  hata: true,
  ozet: 'kontrol kullanıcıda',
};

async function izlemeyeBasla(b: AracBaglami): Promise<void> {
  if (b.gorevIzinleri.has(IZLENIYOR)) return;
  b.gorevIzinleri.add(IZLENIYOR);
  await komut({ k: 'referans' }).catch(() => undefined);
}

async function kullaniciDevraldi(b: AracBaglami): Promise<boolean> {
  if (!b.gorevIzinleri.has(IZLENIYOR)) { await izlemeyeBasla(b); return false; }
  const r = await komut({ k: 'kullanici' }).catch(() => null);
  if (!r?.degdi) return false;
  if (Date.now() - Number(r.ms ?? 0) <= sonOnayYanitZamani + 1500) { await komut({ k: 'referans' }).catch(() => undefined); return false; }
  return true;
}

/** Eylem sonrası otomatik yeni görüntü: model sonucu hemen görsün (bir adım tasarrufu). */
async function eylem(b: AracBaglami, amac: string, f: () => Promise<unknown>, mesaj: string): Promise<AracSonucu> {
  if (!(await izinli(b, amac))) return { icerik: 'Kullanıcı fare/klavye izni vermedi (reddedildi).', hata: true, ozet: 'reddedildi' };
  if (b.sinyal.aborted) return { icerik: 'Durduruldu.', hata: true };
  if (b.gorevIzinleri.has(DEVRALINDI)) return DEVRALINDI_SONUCU;
  if (await kullaniciDevraldi(b)) {
    b.gorevIzinleri.add(DEVRALINDI);
    imlecRozet(await imlecKonumu(), 'Kontrol sende — durdum', 2600);
    kontrolBitirSonra(1200);
    return DEVRALINDI_SONUCU;
  }
  kontrolBasla();
  try {
    await f();
    await sonra(380);
    const g = await ekranGoruntusu();
    return { ...g, icerik: `${mesaj}\n${g.icerik}`, ozet: mesaj };
  } finally {
    kontrolBitirSonra(4000);
  }
}

const araclar: Arac[] = [
  {
    grup: 'bilgisayar', risk: 'serbest',
    etiket: () => 'Ekrana bakıyor',
    tanim: { ad: 'bilgisayar_ekran', aciklama: 'İmlecin bulunduğu ekranın görüntüsünü alır. Fare/klavye eyleminden önce MUTLAKA bak.', sema: sema({ ekran: { type: 'integer', description: 'Ekran sırası (boş = imlecin olduğu ekran)' } }) },
    async calistir(g, b) {
      await izlemeyeBasla(b);
      return ekranGoruntusu(1366, g.ekran === undefined ? undefined : Number(g.ekran));
    },
  },
  {
    grup: 'bilgisayar', risk: 'kontrol',
    etiket: (g) => `${g.dugme === 'sag' ? 'Sağ tıklıyor' : g.adet === 2 ? 'Çift tıklıyor' : 'Tıklıyor'} (${g.x}, ${g.y})`,
    tanim: {
      ad: 'bilgisayar_tikla',
      aciklama: 'Son ekran görüntüsündeki (x, y) noktasına tıklar. Sonra yeni görüntü döner.',
      sema: sema({ x: { type: 'number' }, y: { type: 'number' }, dugme: { type: 'string', enum: ['sol', 'sag', 'orta'] }, adet: { type: 'integer', description: '2 = çift tık' }, amac: { type: 'string', description: 'Neden (kullanıcıya gösterilir)' } }, ['x', 'y']),
    },
    async calistir(g, b) {
      const p = fiziksel(Number(g.x), Number(g.y));
      const iz = g.dugme === 'sag' ? 'sag' : Number(g.adet) === 2 ? 'cift' : 'tikla';
      return eylem(b, String(g.amac ?? 'ekranda tıklama'), async () => {
        await oraya(p, iz);
        await komut({ k: 'tikla', x: p.x, y: p.y, d: g.dugme ?? 'sol', adet: g.adet ?? 1 });
      }, `Tıklandı (${g.x}, ${g.y})`);
    },
  },
  {
    grup: 'bilgisayar', risk: 'kontrol',
    etiket: (g) => yazmaEtiketi('bilgisayar_yaz', g), // P10: yazılan metin etikette yok — yalnız hedef ve karakter sayısı
    tanim: { ad: 'bilgisayar_yaz', aciklama: 'Odaktaki alana metin yazar (Türkçe karakterler dahil). Parola/kart bilgisi YAZMA.', sema: sema({ metin: { type: 'string' }, amac: { type: 'string' } }, ['metin']) },
    async calistir(g, b) {
      const metin = String(g.metin);
      return eylem(b, String(g.amac ?? 'metin yazma'), async () => {
        imlecRozet(await imlecKonumu(), `yazıyor… ${[...metin].length} karakter`, Math.min(8000, 600 + metin.length * 12)); // P10: metnin kendisi rozette yok
        await komut({ k: 'yaz', metin }, 60_000);
      }, 'Yazıldı');
    },
  },
  {
    grup: 'bilgisayar', risk: 'kontrol',
    etiket: (g) => `Tuşa basıyor: ${g.kombin}`,
    tanim: { ad: 'bilgisayar_tus', aciklama: 'Tuş ya da kısayol: "enter", "ctrl+c", "alt+tab", "win+d", "ctrl+shift+t", "f5"…', sema: sema({ kombin: { type: 'string' }, amac: { type: 'string' } }, ['kombin']) },
    async calistir(g, b) {
      const k = String(g.kombin).toLowerCase();
      if (/ctrl\+alt\+(del|delete)|win\+l/.test(k)) return { icerik: 'Bu kısayol güvenlik nedeniyle engelli.', hata: true };
      return eylem(b, String(g.amac ?? `kısayol ${g.kombin}`), async () => {
        imlecRozet(await imlecKonumu(), `⌨ ${String(g.kombin)}`, 1200);
        await komut({ k: 'tus', kombin: k });
      }, `Basıldı: ${g.kombin}`);
    },
  },
  {
    grup: 'bilgisayar', risk: 'kontrol',
    etiket: (g) => `Kaydırıyor ${Number(g.miktar) > 0 ? 'yukarı' : 'aşağı'}`,
    tanim: { ad: 'bilgisayar_kaydir', aciklama: 'Fare tekerleğiyle kaydırır (miktar: + yukarı, − aşağı; 1 = bir çentik).', sema: sema({ x: { type: 'number' }, y: { type: 'number' }, miktar: { type: 'integer' }, yatay: { type: 'boolean' } }, ['miktar']) },
    async calistir(g, b) {
      const p = g.x !== undefined && g.y !== undefined ? fiziksel(Number(g.x), Number(g.y)) : null;
      return eylem(b, 'kaydırma', async () => {
        if (p) await oraya(p, 'bak');
        imlecRozet(p ?? await imlecKonumu(), Number(g.miktar) > 0 ? '↑ kaydırıyor' : '↓ kaydırıyor', 900);
        await komut({ k: 'kaydir', x: -1, y: -1, dy: g.yatay ? 0 : Number(g.miktar), dx: g.yatay ? Number(g.miktar) : 0 });
      }, 'Kaydırıldı');
    },
  },
  {
    grup: 'bilgisayar', risk: 'kontrol',
    etiket: () => 'Sürüklüyor',
    tanim: { ad: 'bilgisayar_surukle', aciklama: 'Bir noktadan diğerine sürükleyip bırakır.', sema: sema({ x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, amac: { type: 'string' } }, ['x1', 'y1', 'x2', 'y2']) },
    async calistir(g, b) {
      const a = fiziksel(Number(g.x1), Number(g.y1)), z = fiziksel(Number(g.x2), Number(g.y2));
      return eylem(b, String(g.amac ?? 'sürükle-bırak'), async () => {
        await oraya(a, 'tikla');
        const sure = hareketSuresi(a, z);
        await Promise.all([imlecGit(a, z, sure, 'tikla'), komut({ k: 'surukle', x1: a.x, y1: a.y, x2: z.x, y2: z.y })]);
      }, 'Sürüklendi');
    },
  },
  {
    grup: 'bilgisayar', risk: 'serbest',
    etiket: () => 'Açık pencerelere bakıyor',
    tanim: { ad: 'bilgisayar_pencereler', aciklama: 'Açık pencereleri (başlık, uygulama, konum) listeler.', sema: sema({}) },
    async calistir() {
      const r = await komut({ k: 'pencereler' });
      const l = (r.pencereler as { baslik: string; surec: string; on: boolean; kucuk: boolean }[]) ?? [];
      return { icerik: l.map((p) => `${p.on ? '▶ ' : ''}${p.baslik} [${p.surec}]${p.kucuk ? ' (simge durumunda)' : ''}`).join('\n') || 'Pencere yok', ozet: `${l.length} pencere` };
    },
  },
  {
    grup: 'bilgisayar', risk: 'kontrol',
    etiket: (g) => `Pencereyi öne getiriyor: ${g.baslik}`,
    tanim: { ad: 'bilgisayar_odakla', aciklama: 'Başlığında ya da uygulama adında geçen pencereyi öne getirir.', sema: sema({ baslik: { type: 'string' } }, ['baslik']) },
    async calistir(g, b) { return eylem(b, `"${g.baslik}" penceresini öne getirme`, () => komut({ k: 'odakla', baslik: String(g.baslik) }), `Öne getirildi: ${g.baslik}`); },
  },
  {
    grup: 'bilgisayar', risk: 'kontrol',
    etiket: (g) => `Açıyor: ${metinKisalt(String(g.hedef ?? ''), 50)}`,
    tanim: { ad: 'uygulama_ac', aciklama: 'Bir web adresini varsayılan tarayıcıda, bir dosyayı/klasörü ilişkili uygulamada açar.', sema: sema({ hedef: { type: 'string', description: 'https://… ya da tam dosya yolu' } }, ['hedef']) },
    async calistir(g, b) {
      const h = String(g.hedef);
      if (/^https?:\/\//i.test(h)) { await shell.openExternal(h); return { icerik: `Açıldı: ${h}`, ozet: 'açıldı' }; }
      if (!(await izinli(b, `${h} açma`))) return { icerik: 'İzin verilmedi (reddedildi).', hata: true };
      const hata = await shell.openPath(h);
      return hata ? { icerik: hata, hata: true } : { icerik: `Açıldı: ${h}`, ozet: 'açıldı' };
    },
  },
];

export function bilgisayarAraclariniKaydet(): void { aracKaydet(...araclar); }
export function bilgisayarKapat(): void { imlecKapat(); girdiYardimcisiniDurdur(); }

// ── Öz-sınama (Ayarlar → Yetkiler → "Dene"): yapay zekâ OLMADAN gerçek Win32 katmanı ─────────────────────────
// Ekranın ortasında küçük bir test penceresi açar; yardımcıyla ekran görüntüsü alır, metin kutusuna GERÇEK fare
// tıklaması gönderir, Türkçe karakterli metin yazar, Enter'a basar ve pencere listesini okur. Yalnız kullanıcı düğmeye
// bastığında çalışır; dokunduğu tek yer bu test penceresidir.
const DENEME_HTML = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Fuber bilgisayar denemesi</title></head>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0f0f0f;color:#fff;font-family:Segoe UI,sans-serif;border:1px solid #333;box-sizing:border-box">
<div style="text-align:center"><div style="font-size:15px;color:#a1a1a1;margin-bottom:14px">Fuber fare ve klavyeyi deniyor…</div>
<input id="kutu" style="font-size:22px;padding:12px 16px;width:420px;border-radius:12px;border:2px solid #7aa2ff;background:#fff;color:#000"
 onkeydown="if(event.key==='Enter'){document.getElementById('sonuc').textContent=this.value}">
<div id="sonuc" style="margin-top:12px;font-size:16px;color:#9fe0a0;min-height:22px"></div></div></body></html>`;

export interface DenemeAdimi { ad: string; tamam: boolean; ayrinti?: string }
export async function bilgisayarDene(): Promise<{ tamam: boolean; kilitli?: boolean; adimlar: DenemeAdimi[] }> {
  const adimlar: DenemeAdimi[] = [];
  let durum: Record<string, unknown>;
  try { durum = await komut({ k: 'kilit' }); } catch (e) { return { tamam: false, adimlar: [{ ad: 'Girdi yardımcısı', tamam: false, ayrinti: (e as Error).message }] }; }
  if (durum.kilitli) return { tamam: false, kilitli: true, adimlar: [{ ad: 'Windows oturumu', tamam: false, ayrinti: 'kilitli — kilit açıkken tekrar dene' }] };
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const g = 620, y = 260;
  const x0 = Math.round(d.workArea.x + (d.workArea.width - g) / 2), y0 = Math.round(d.workArea.y + (d.workArea.height - y) / 2);
  const pen = new BrowserWindow({ x: x0, y: y0, width: g, height: y, frame: false, resizable: false, skipTaskbar: true, show: false, alwaysOnTop: true, backgroundColor: '#0f0f0f', webPreferences: { sandbox: true } });
  pen.setAlwaysOnTop(true, 'screen-saver');
  try {
    await pen.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(DENEME_HTML)}`);
    pen.show(); pen.focus();
    await sonra(500);
    const e = await komut({ k: 'ekran', en: 640 });
    adimlar.push({ ad: 'Ekran görüntüsü', tamam: Boolean(e.jpeg) && !e.karanlik, ayrinti: e.karanlik ? 'görüntü siyah (ekran uykuda olabilir)' : `${e.w}×${e.h}` });
    const r = await pen.webContents.executeJavaScript("(() => { const b = document.getElementById('kutu').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()") as { x: number; y: number };
    const p = screen.dipToScreenPoint({ x: Math.round(x0 + r.x), y: Math.round(y0 + r.y) });
    kontrolBasla();
    await oraya({ x: Math.round(p.x), y: Math.round(p.y) }, 'tikla');
    await komut({ k: 'tikla', x: Math.round(p.x), y: Math.round(p.y), d: 'sol', adet: 1 });
    await sonra(300);
    const odak = await pen.webContents.executeJavaScript('document.activeElement ? document.activeElement.id : ""');
    adimlar.push({ ad: 'Fare tıklaması', tamam: odak === 'kutu', ayrinti: `(${Math.round(p.x)}, ${Math.round(p.y)})` });
    const metin = 'Fuber testi ğüşıöç İ 123';
    // Yazmadan önce odak bizim kutumuzda mı? Değilse yazma (metin kullanıcının başka bir uygulamasına gitmesin).
    if (odak !== 'kutu' || !pen.isFocused()) throw new Error('Test penceresi odak almadı; güvenlik için yazma yapılmadı.');
    await komut({ k: 'yaz', metin });
    if (!pen.isFocused()) throw new Error('Odak test penceresinden çıktı; Enter gönderilmedi.');
    await komut({ k: 'tus', kombin: 'enter' });
    await sonra(400);
    const deger = String(await pen.webContents.executeJavaScript("document.getElementById('sonuc').textContent"));
    adimlar.push({ ad: 'Klavye (Türkçe karakterler + Enter)', tamam: deger === metin, ayrinti: deger || '(boş)' });
    const pl = await komut({ k: 'pencereler' });
    const liste = (pl.pencereler as unknown[] | undefined) ?? [];
    adimlar.push({ ad: 'Pencere listesi', tamam: liste.length > 0, ayrinti: `${liste.length} pencere` });
  } catch (err) {
    adimlar.push({ ad: 'Hata', tamam: false, ayrinti: (err as Error).message });
  } finally {
    pen.destroy();
    kontrolBitirSonra(1200);
  }
  return { tamam: adimlar.length > 0 && adimlar.every((a) => a.tamam), adimlar };
}
