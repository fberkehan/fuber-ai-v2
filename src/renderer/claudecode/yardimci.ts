// ── Claude Code çalışma alanı: saf yardımcılar (Görev 28, K17) — birim testli: tests/cc-arayuz.test.ts ──────────────────────────
// Yazma kutusunun "/" ve "@" tetikleri, tamamlama, komut süzme, oturum hâli etiketi, süre/maliyet/belirteç biçimi, oturum arama,
// geçmişin projelere göre gruplanması, sanal listenin aralık hesabı, "@" sorgusunun gecikmeli (debounce) zamanlayıcısı.
import { CC_VARSAYILAN_MODELLER, CC_EFOR_SEVIYELERI, type CcOturumOzeti, type CcMod, type CcSonuc, type CcEfor } from '../../shared/cc-olay.ts';
import { katla } from '../../shared/ayar-arama.ts';

// ── Yazma kutusu tetikleri ────────────────────────────────────────────────────────────────────────────────────────────────
export type Tetik = { tur: 'komut' | 'dosya'; sorgu: string; bas: number; son: number };

/**
 * İmlecin bulunduğu belirteç bir tetik mi:
 *  • "/" komut paleti: metnin EN BAŞINDA "/" ve imleç ilk sözcükte (ör. "/comp|") — metnin ortasındaki "/" (yol) tetik değil.
 *  • "@" dosya önerisi: imlecin solundaki sözcük "@" ile başlıyor ve "@"den önce boşluk ya da metnin başı var (e-posta değil).
 */
export function tetikBul(metin: string, imlec: number): Tetik | null {
  const i = Math.max(0, Math.min(imlec, metin.length));
  let bas = i;
  while (bas > 0 && !/\s/.test(metin[bas - 1])) bas--;
  let son = i;
  while (son < metin.length && !/\s/.test(metin[son])) son++;
  const sozcuk = metin.slice(bas, i);
  if (bas === 0 && sozcuk.startsWith('/') && !sozcuk.slice(1).includes('/')) return { tur: 'komut', sorgu: sozcuk.slice(1), bas, son };
  if (sozcuk.startsWith('@')) return { tur: 'dosya', sorgu: sozcuk.slice(1), bas, son };
  return null;
}

/** Tetiğin yerine seçilen komut ya da yol yazılır (sonuna tek boşluk); dönen imleç eklenenin sonu. */
export function tamamla(metin: string, t: Tetik, deger: string): { metin: string; imlec: number } {
  const ek = t.tur === 'komut' ? `/${deger}` : `@${/\s/.test(deger) ? `"${deger}"` : deger}`;
  const sonra = metin.slice(t.son);
  const bosluk = sonra.startsWith(' ') ? '' : ' ';
  const yeni = `${metin.slice(0, t.bas)}${ek}${bosluk}${sonra}`;
  return { metin: yeni, imlec: t.bas + ek.length + 1 };
}

export interface KomutBilgisi { ad: string; aciklama: string; ipucu: string; yerlesik: boolean; takmaAdlar: string[] }

/**
 * Komut paleti süzgeci: ad öneki → takma ad öneki → adın içinde → açıklamada; eşitlikte yerleşikler sonra, ada göre. Tek harfte
 * yalnız önek eşleşir ("c" → clear, compact; "gözden-geçir" değil): ilk tuşta liste gürültülü olmasın.
 */
export function komutSuz(komutlar: readonly KomutBilgisi[], sorgu: string, n = 50): KomutBilgisi[] {
  const q = katla(sorgu.replace(/^\//, '')).trim();
  if (!q) return [...komutlar].sort((a, b) => Number(a.yerlesik) - Number(b.yerlesik) || a.ad.localeCompare(b.ad)).slice(0, n);
  const puan = (k: KomutBilgisi) => {
    const ad = katla(k.ad);
    if (ad.startsWith(q)) return 0;
    if (k.takmaAdlar.some((t) => katla(t).startsWith(q))) return 1;
    if (q.length < 2) return -1;
    if (ad.includes(q)) return 2;
    if (katla(k.aciklama).includes(q)) return 3;
    return -1;
  };
  return komutlar.map((k) => ({ k, p: puan(k) })).filter((x) => x.p >= 0)
    .sort((a, b) => a.p - b.p || Number(a.k.yerlesik) - Number(b.k.yerlesik) || a.k.ad.localeCompare(b.k.ad)).slice(0, n).map((x) => x.k);
}

/**
 * Süreç açılmadan önce (taslak / geçmiş oturum) "/" paletinin yerleşik listesi — Claude Code'un akış kipinde de çalışan komutlar.
 * Kullanıcı becerileri ve eklenti komutları oturumun ilk mesajından sonra (supportedCommands) gelir.
 */
export const YERLESIK_KOMUTLAR: readonly KomutBilgisi[] = [
  { ad: 'compact', aciklama: 'Konuşmayı özetleyip bağlamı küçültür', ipucu: '[odak]', yerlesik: true, takmaAdlar: [] },
  { ad: 'clear', aciklama: 'Konuşmayı temizler, yeniden başlar', ipucu: '', yerlesik: true, takmaAdlar: ['reset'] },
  { ad: 'init', aciklama: 'Proje için CLAUDE.md hazırlar', ipucu: '', yerlesik: true, takmaAdlar: [] },
  { ad: 'review', aciklama: 'Değişiklikleri ya da bir PR’ı gözden geçirir', ipucu: '[pr]', yerlesik: true, takmaAdlar: [] },
  { ad: 'security-review', aciklama: 'Bekleyen değişikliklerde güvenlik incelemesi', ipucu: '', yerlesik: true, takmaAdlar: [] },
  { ad: 'pr-comments', aciklama: 'Bir PR’ın yorumlarını getirir', ipucu: '[pr]', yerlesik: true, takmaAdlar: [] },
  { ad: 'context', aciklama: 'Bağlamın ne kadarının dolu olduğunu gösterir', ipucu: '', yerlesik: true, takmaAdlar: [] },
  { ad: 'cost', aciklama: 'Bu oturumun maliyetini ve süresini gösterir', ipucu: '', yerlesik: true, takmaAdlar: [] },
];
export const BECERI_NOTU = 'Beceri komutları ilk mesajdan sonra görünür';

// ── Araç adları (Türkçe) ve izin cümlesi ────────────────────────────────────────────────────────────────────────────────
const ARAC_ADI: Record<string, string> = {
  Read: 'Okuma', Edit: 'Düzenleme', MultiEdit: 'Çoklu düzenleme', Write: 'Yazma', NotebookEdit: 'Not defteri', NotebookRead: 'Not defteri', LS: 'Klasör',
  Bash: 'Komut', PowerShell: 'PowerShell komutu', BashOutput: 'Komut çıktısı', KillShell: 'Komutu durdur', KillBash: 'Komutu durdur',
  Grep: 'Arama', Glob: 'Dosya bulma', WebFetch: 'Web sayfası', WebSearch: 'Web araması', ExitPlanMode: 'Plan', AskUserQuestion: 'Soru',
  Task: 'Alt ajan', Agent: 'Alt ajan', TodoWrite: 'Yapılacaklar', TaskCreate: 'Görev', TaskUpdate: 'Görev', TaskList: 'Görevler', TaskGet: 'Görev',
  Skill: 'Beceri', SlashCommand: 'Eğik çizgi komutu', ListMcpResourcesTool: 'MCP kaynakları', ReadMcpResourceTool: 'MCP kaynağı',
  EnterPlanMode: 'Plan modu', TaskOutput: 'Görev çıktısı',
};
const TIP_SIMGESI: Record<string, string> = {
  okuma: 'dosya', duzenleme: 'kalem', kabuk: 'terminal', arama: 'ara', 'alt-ajan': 'agi', yapilacaklar: 'liste', web: 'kure', mcp: 'baglanti',
  soru: 'sohbet', plan: 'hedef', diger: 'arac',
};
export const aracSimgesi = (tip: string) => TIP_SIMGESI[tip] ?? 'arac';
/** MCP aracı: "mcp__sunucu__arac" → { sunucu, arac } (alt çizgiler boşluk). */
export function mcpParcalari(ad: string): { sunucu: string; arac: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(ad);
  return m ? { sunucu: m[1].replace(/_/g, ' '), arac: m[2].replace(/_/g, ' ') } : null;
}
/** Düzeltme 2 (I2): bilinmeyen araç kimliği okunur ada çevrilir ("DeployPreviewTool" → "Deploy preview tool", "my_tool" → "My tool"). */
export function okunurAd(ad: string): string {
  const s = ad.replace(/[_-]+/g, ' ').replace(/([a-zçğıöşü\d])([A-ZÇĞİÖŞÜ])/g, '$1 $2').replace(/([A-ZÇĞİÖŞÜ]+)([A-ZÇĞİÖŞÜ][a-zçğıöşü])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  if (!s) return ad;
  const k = s.split(' ').map((w, i) => (i === 0 || /^[A-Z\d]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');
  return k.charAt(0).toUpperCase() + k.slice(1);
}
/** Kartta görünen Türkçe araç adı; bilinmeyen araç "Araç · <okunur ad>" (ham kimlik tek başına görünmez). */
export function aracAdiTr(ad: string): string {
  const m = mcpParcalari(ad);
  if (m) return `MCP · ${m.sunucu}`;
  return ARAC_ADI[ad] ?? `Araç · ${okunurAd(ad)}`;
}

/**
 * İzin kartının Türkçe cümlesi (Claude Code'un kendi başlığı İngilizce olabilir: kartta yalnız ipucu olarak). Write için dosyanın var
 * olup olmadığı ayrıca sorulur (`dosyaVar`; bilinmiyorsa nötr cümle).
 */
export function izinBasligi(i: { arac: string; tip: string; girdi?: Record<string, unknown> }, dosyaVar?: boolean | null): string {
  const m = mcpParcalari(i.arac);
  if (m) return `Claude “${m.sunucu}” bağlantısındaki “${m.arac}” aracını kullanmak istiyor`;
  switch (i.arac) {
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return 'Claude bu dosyayı düzenlemek istiyor';
    case 'Write':
      return dosyaVar === true ? 'Claude bu dosyanın üzerine yazmak istiyor' : dosyaVar === false ? 'Claude yeni bir dosya oluşturmak istiyor' : 'Claude bir dosya yazmak istiyor';
    case 'Bash': case 'PowerShell': return 'Claude bu komutu çalıştırmak istiyor';
    case 'WebFetch': return 'Claude bu sayfayı açmak istiyor';
    case 'WebSearch': return 'Claude web’de arama yapmak istiyor';
    case 'ExitPlanMode': return 'Claude planını onayına sunuyor';
    default: return `Claude “${ARAC_ADI[i.arac] ?? okunurAd(i.arac)}” aracını kullanmak istiyor`;
  }
}

/**
 * Düzeltme 2 (N4): "/" listesi motordan boş ya da hatayla dönerse (kapanmış/çökmüş oturum) "Komutlar yükleniyor…"da kalınmaz: son
 * bilinen liste, o da yoksa yerleşik komutlar + beceri notu.
 */
export function komutYedegi(r: { komutlar: readonly KomutBilgisi[]; hata?: string }, son: readonly KomutBilgisi[]): { komutlar: KomutBilgisi[]; not?: string } {
  if (r.komutlar.length) return { komutlar: [...r.komutlar] };
  if (son.length) return { komutlar: [...son] };
  return { komutlar: [...YERLESIK_KOMUTLAR], not: BECERI_NOTU };
}

/**
 * Düzeltme 2 (N3): "Oturumu aç" hedefi (uygulama içi oturum id'si + Claude Code kimliği). Uygulama yeniden açıldıysa oturum gitmiş
 * olabilir: aynı kimlikli canlı oturum, yoksa geçmişteki (JSONL) oturum; ikisi de yoksa 'yok' (kısa not gösterilir).
 */
export function baglantiHedefi<C extends { id: string; kimlik?: string | null }, G extends { id: string }>(
  b: { id: string; kimlik?: string }, canlilar: readonly C[], gecmis: readonly G[],
): { tur: 'canli'; id: string } | { tur: 'gecmis'; o: G } | { tur: 'yok' } {
  if (canlilar.some((c) => c.id === b.id)) return { tur: 'canli', id: b.id };
  if (b.kimlik) {
    const c = canlilar.find((x) => x.kimlik === b.kimlik);
    if (c) return { tur: 'canli', id: c.id };
    const g = gecmis.find((x) => x.id === b.kimlik);
    if (g) return { tur: 'gecmis', o: g };
  }
  return { tur: 'yok' };
}
export const BAGLANTI_YOK = 'Bu oturum artık açık değil; geçmişten sürdürebilirsin.';

/**
 * Düzeltme 2 (N6): gönderilemeyen mesaj GÖNDERİLDİĞİ taslağa geri konur (o arada başka oturuma geçildiyse ekrandakine değil).
 * O taslağa bu arada yeni bir şey yazıldıysa ezilmez. Dönen: geri konan taslak şu an ekrandaki mi.
 */
export function taslakGeriKoy<E>(metinler: Map<string, string>, ekler: Map<string, E[]>, anahtar: string, metin: string, ek: E[], simdiki: string): boolean {
  if (metin && !metinler.get(anahtar)) metinler.set(anahtar, metin);
  if (ek.length && !ekler.get(anahtar)?.length) ekler.set(anahtar, ek);
  return anahtar === simdiki;
}

/** Çöken oturumun motor metnindeki "yeni bir mesajla sürdürebilirsin" kuyruğu (kart bunu ayrıca söyler). */
export const hataSade = (h: string) => h.replace(/\s*Yeni bir mesajla sürdürebilirsin\.?\s*$/i, '').trim();

// ── Gecikmeli sorgu ("@" önerisi; ana süreçte eşleştirme 60–200 ms sürebilir) ─────────────────────────────────────────────────
export interface Saatci { kur: (f: () => void, ms: number) => unknown; iptal: (z: unknown) => void }
const gercekSaat: Saatci = { kur: (f, ms) => setTimeout(f, ms), iptal: (z) => clearTimeout(z as ReturnType<typeof setTimeout>) };

/**
 * Son isteği `ms` sonra çalıştırır (arada gelen yenisi öncekini iptal eder); bayat yanıt (daha yeni bir istek yola çıktıktan sonra
 * dönen) yok sayılır. Bekleme sırasında son sonuç görünür kalır (çağıran onu değiştirmez).
 */
export function gecikmeliSorgu<T>(calistir: (q: string) => Promise<T>, sonuc: (q: string, r: T) => void, ms = 120, saat: Saatci = gercekSaat) {
  let zaman: unknown = null;
  let no = 0;
  return {
    iste(q: string): void {
      if (zaman !== null) saat.iptal(zaman);
      zaman = saat.kur(() => {
        zaman = null;
        const benim = ++no;
        void calistir(q).then((r) => { if (benim === no) sonuc(q, r); }, () => undefined);
      }, ms);
    },
    iptal(): void { if (zaman !== null) saat.iptal(zaman); zaman = null; no++; },
  };
}

// ── Oturum hâli ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export type HalTonu = 'calisiyor' | 'izin' | 'bitti' | 'hata' | 'sirada' | 'notr';
export function halBilgisi(o: Pick<CcOturumOzeti, 'durum' | 'siraNo' | 'turSayisi' | 'bekleyenIzin'> & { arkaPlan?: number }): { etiket: string; ton: HalTonu } {
  switch (o.durum) {
    case 'calisiyor': return { etiket: 'Çalışıyor', ton: 'calisiyor' };
    case 'izin': return { etiket: o.bekleyenIzin > 1 ? `İzin bekliyor · ${o.bekleyenIzin}` : 'İzin bekliyor', ton: 'izin' };
    case 'hata': return { etiket: 'Hata', ton: 'hata' };
    case 'sirada': return { etiket: o.siraNo ? `Sırada · ${o.siraNo}.` : 'Sırada', ton: 'sirada' };
    case 'kapandi': return { etiket: 'Kapandı', ton: 'notr' };
    // Tur bitti ama arkada ajan/kabuk sürüyor: "Bitti" değil (31 Eki); son iş bitince Bitti'ye döner.
    default: return o.arkaPlan && o.arkaPlan > 0 ? { etiket: 'Arka planda', ton: 'calisiyor' } : o.turSayisi ? { etiket: 'Bitti', ton: 'bitti' } : { etiket: 'Hazır', ton: 'notr' };
  }
}

/**
 * Sonuç kartının başlığı ve ayrıntısı. Arkada iş sürerken "Bitti" yazmaz; tahmini dolar yalnız API anahtarıyla çalışan oturumda
 * (`paraGoster`) görünür — üyelikte ya da kaynak bilinmiyorsa yok (total_cost_usd API fiyatıyla hesaplanan bir tahmindir).
 */
export function sonucEtiketi(s: Pick<CcSonuc, 'basarili' | 'kesildi' | 'sureMs' | 'turSayisi' | 'maliyetUsd' | 'hata'> & { paraGoster?: boolean }, arkaPlan = 0): { baslik: string; ton: 'tamam' | 'notr' | 'calisiyor' | 'hata'; parcalar: string } {
  const parcalar = [sureMetni(s.sureMs), s.turSayisi ? `${s.turSayisi} tur` : '', s.paraGoster && s.maliyetUsd ? maliyetMetni(s.maliyetUsd) : ''].filter(Boolean).join(' · ');
  if (!s.basarili && !s.kesildi) return { baslik: 'Hata', ton: 'hata', parcalar };
  if (s.kesildi) return { baslik: 'Durduruldu', ton: 'notr', parcalar };
  if (arkaPlan > 0) return { baslik: `Arka planda ${arkaPlan} iş sürüyor`, ton: 'calisiyor', parcalar };
  return { baslik: 'Bitti', ton: 'tamam', parcalar };
}
/** Denetçinin "Maliyet" değeri: özet tutarı taşımıyorsa (üyelik / bilinmiyor) satır hiç çizilmez. */
export const maliyetSatiri = (o: { maliyetUsd?: number }): string | null => (o.maliyetUsd === undefined ? null : maliyetMetni(o.maliyetUsd));

/** Düşünme gücü seçici adları (SDK EffortLevel: low … max). Boş değer = Claude Code'un varsayılanı. */
export const EFOR_ADLARI: Record<CcEfor, string> = { low: 'Düşük', medium: 'Orta', high: 'Yüksek', xhigh: 'Çok yüksek', max: 'En yüksek' };
export const eforSecenekleri = (): { deger: '' | CcEfor; etiket: string }[] => [{ deger: '', etiket: 'Düşünme: varsayılan' }, ...CC_EFOR_SEVIYELERI.map((e) => ({ deger: e, etiket: `Düşünme: ${EFOR_ADLARI[e].toLowerCase()}` }))];

/**
 * Sayfanın üstündeki hesap satırı: Claude Code kullanıcının KENDİ Claude hesabıyla çalışır (Fuber hesabı ya da anahtarı karışmaz).
 * `hesap` SDK accountInfo'dan (e-posta, plan); `auth` Claude Code'un oturum durumu — giriş yoksa `claude login` yönergesi.
 */
export function hesapMetni(hesap: { eposta?: string; plan?: string } | null | undefined, auth: { girisYapildi: boolean } | null | undefined): { metin: string; giris: boolean } {
  const temel = 'Kendi Claude hesabınla çalışır';
  if (auth && auth.girisYapildi === false) return { metin: `${temel}; henüz giriş yapılmamış: terminalde claude login yaz ya da Ayarlar’dan oturum aç.`, giris: true };
  const plan = hesap?.plan ? hesap.plan.charAt(0).toUpperCase() + hesap.plan.slice(1) : '';
  return { metin: [temel, hesap?.eposta ?? '', plan].filter(Boolean).join(' · '), giris: false };
}

export interface ModelSecenegi { deger: string; ad: string; aciklama: string }
/** Taslak (oturumsuz) model listesi: canlı oturumdan gelen en güncel; yoksa saklı liste; o da yoksa opus / sonnet / haiku — asla boş değil. */
export function taslakModelleri(canli: readonly ModelSecenegi[], sakli: readonly ModelSecenegi[] | null | undefined): readonly ModelSecenegi[] {
  if (canli.length) return canli;
  if (sakli?.length) return sakli;
  return CC_VARSAYILAN_MODELLER;
}
/** "Tam yetkiye geçmek için yeniden açılmalı" şeridi bitti mi: oturumun özetindeki mod hedefe ulaştı. Ana süreç modu yayınlar, ardından eski süreci
 *  kapatır (birkaç saniye) ve ancak sonra yanıt verir — şerit yanıtı beklemez (0.15 sürüm doğrulaması: "Durdur ve geç" sonrası şerit kalıyordu). */
export function modBeklemesiBitti(u: { tur: string; id?: string; mod?: CcMod } | null | undefined, o: Pick<CcOturumOzeti, 'id' | 'mod'> | null | undefined): boolean {
  return Boolean(u && u.tur === 'mod-bekliyor' && o && o.id === u.id && o.mod === u.mod);
}
/** Tur sürüyor mu (Durdur / Esc anlamlı). */
export const turSuruyor = (o: Pick<CcOturumOzeti, 'durum'> | null | undefined) => o?.durum === 'calisiyor' || o?.durum === 'izin';

export const MOD_ADLARI: Record<CcMod, string> = { default: 'Her şeyi sor', acceptEdits: 'Düzenlemelere izin ver', plan: 'Plan', bypassPermissions: 'Tam yetki' };

// ── Biçim ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function sureMetni(ms: number | undefined): string {
  if (!ms || ms < 0) return '0 sn';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const sn = Math.round(ms / 1000);
  if (sn < 60) return `${sn} sn`;
  const dk = Math.floor(sn / 60);
  if (dk < 60) return sn % 60 ? `${dk} dk ${sn % 60} sn` : `${dk} dk`;
  const sa = Math.floor(dk / 60);
  return dk % 60 ? `${sa} sa ${dk % 60} dk` : `${sa} sa`;
}

/** Yaklaşık maliyet (ABD doları, Türkçe ondalık): küçük tutarlarda dört hane. */
export function maliyetMetni(usd: number | undefined): string {
  const u = usd && Number.isFinite(usd) ? usd : 0;
  const hane = u > 0 && u < 0.1 ? 4 : 2;
  return `≈ ${new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', minimumFractionDigits: hane, maximumFractionDigits: hane }).format(u)}`;
}

export function belirtecMetni(n: number | undefined): string {
  const x = n && Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 }).format(x);
}

/** Proje içindeki yolu göreli yazar (Windows ve '/' ayraçları; büyük/küçük harf duyarsız); dışarıdaysa olduğu gibi. */
export function goreliYol(yol: string, cwd: string): string {
  const n = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '');
  const y = n(yol), k = n(cwd);
  if (k && y.toLowerCase().startsWith(`${k.toLowerCase()}/`)) return y.slice(k.length + 1);
  return y;
}
/**
 * Denetçinin değişen dosyaları (düzeltme turu 1): "Bu oturumda" = motorun saydığı, bu oturumda BAŞARIYLA biten Edit/Write/MultiEdit
 * (git durumu varsa onunla, yoksa "M"); "Depodaki diğer değişiklikler" = git status'un geri kalanı (alfabetik). Döküm gelmeden önce
 * depodaki liste (`yedek`) kullanılır.
 */
export function dosyaGruplari(
  d: { git: boolean; dosyalar: { yol: string; durum: string }[]; oturumDosyalari: string[] } | null, yedek: readonly string[], cwd: string,
): { oturumda: { yol: string; durum: string }[]; diger: { yol: string; durum: string }[] } {
  const gitDurum = new Map((d?.git ? d.dosyalar : []).map((f) => [f.yol.toLowerCase(), f]));
  const goruldu = new Set<string>();
  const oturumda: { yol: string; durum: string }[] = [];
  for (const y of d?.oturumDosyalari ?? yedek) {
    const g = goreliYol(y, cwd);
    const k = g.toLowerCase();
    if (goruldu.has(k)) continue;
    goruldu.add(k);
    const f = gitDurum.get(k);
    oturumda.push({ yol: f?.yol ?? g, durum: f?.durum ?? 'M' });
  }
  const diger = (d?.git ? d.dosyalar : []).filter((f) => !goruldu.has(f.yol.toLowerCase())).sort((a, b) => a.yol.localeCompare(b.yol));
  return { oturumda, diger };
}
/** Uzun yolun anlamlı ucu: "…\kod\mavi-kus" (son iki parça); kısa yol olduğu gibi. */
export function kisaYol(yol: string, parca = 2): string {
  const ayrac = yol.includes('\\') ? '\\' : '/';
  const p = yol.split(/[\\/]/).filter(Boolean);
  return p.length <= parca + 1 ? yol : `…${ayrac}${p.slice(-parca).join(ayrac)}`;
}
export const dosyaAdi = (yol: string) => yol.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? yol;
export const klasorAdi = (yol: string) => { const p = yol.replace(/\\/g, '/').split('/').filter(Boolean); p.pop(); return p.join('/'); };

/** Uzun metin: ilk `n` satır görünür, kalanı katlanır. */
export function satirKatla(metin: string, n: number, acik: boolean): { gorunen: string; gizli: number; toplam: number } {
  const l = metin.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (acik || l.length <= n) return { gorunen: l.join('\n'), gizli: 0, toplam: l.length };
  return { gorunen: l.slice(0, n).join('\n'), gizli: l.length - n, toplam: l.length };
}

// ── Oturum arama ve gruplama ──────────────────────────────────────────────────────────────────────────────────────────────
export function oturumEslesir(o: { baslik?: string; proje?: string; cwd?: string; dal?: string; parca?: string }, sorgu: string): boolean {
  const sozler = katla(sorgu).split(/\s+/).filter(Boolean);
  if (!sozler.length) return true;
  const metin = katla(`${o.baslik ?? ''} ${o.proje ?? ''} ${o.cwd ?? ''} ${o.dal ?? ''} ${o.parca ?? ''}`);
  return sozler.every((s) => metin.includes(s));
}

export interface GecmisOturum { id: string; cwd: string; proje: string; baslik: string; dal?: string; sonZaman?: string; istemSayisi: number; parca?: string }

/** JSONL geçmişini projelere göre gruplar (en yeni etkinlik önce); uygulamada canlı olan kimlikler çıkarılır (çift görünmesin). */
export function gecmisGrupla(liste: readonly GecmisOturum[], canliKimlikler: ReadonlySet<string>): { cwd: string; proje: string; oturumlar: GecmisOturum[] }[] {
  const g = new Map<string, { cwd: string; proje: string; oturumlar: GecmisOturum[]; son: string }>();
  for (const o of liste) {
    if (canliKimlikler.has(o.id)) continue;
    const k = (o.cwd || o.proje).toLowerCase();
    const x = g.get(k) ?? { cwd: o.cwd, proje: o.proje, oturumlar: [], son: '' };
    x.oturumlar.push(o);
    if ((o.sonZaman ?? '') > x.son) x.son = o.sonZaman ?? '';
    g.set(k, x);
  }
  return [...g.values()].sort((a, b) => b.son.localeCompare(a.son)).map(({ cwd, proje, oturumlar }) => ({ cwd, proje, oturumlar: oturumlar.sort((a, b) => (b.sonZaman ?? '').localeCompare(a.sonZaman ?? '')) }));
}

// ── Sanal liste (döküm) ───────────────────────────────────────────────────────────────────────────────────────────────────
/** Öğe üst kenarları: `ofs[i]` = i. öğenin üstü, `ofs[n]` = toplam yükseklik (öğeler arası `aralik`). */
export function konumlar(boylar: readonly number[], aralik: number): Float64Array {
  const ofs = new Float64Array(boylar.length + 1);
  for (let i = 0; i < boylar.length; i++) ofs[i + 1] = ofs[i] + boylar[i] + (i < boylar.length - 1 ? aralik : 0);
  return ofs;
}

/** Görünür aralık [bas, son): pencere [ust − pay, ust + boy + pay] ile kesişen öğeler (ikili arama). */
export function gorunurAralik(ofs: Float64Array, ust: number, boy: number, pay: number): { bas: number; son: number } {
  const n = ofs.length - 1;
  if (n <= 0) return { bas: 0, son: 0 };
  const a = Math.max(0, ust - pay), b = ust + boy + pay;
  // bas: üstü a'dan büyük olan ilk öğenin bir öncesi (a'yı kapsayan öğe)
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ofs[m + 1] <= a) lo = m + 1; else hi = m; }
  const bas = Math.min(lo, n - 1);
  lo = bas; hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ofs[m] < b) lo = m + 1; else hi = m; }
  return { bas, son: Math.max(bas + 1, lo) };
}
