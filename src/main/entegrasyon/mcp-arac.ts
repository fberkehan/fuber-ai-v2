// ── MCP aracı → Fuber aracı (0.14 T16; katalog servisleri ve Developer'ın kendi sunucuları ortak kullanır) ─────────────────────────────────
// Bir MCP sunucusunun `tools/list` sonucu buradan Fuber'in araç kaydına (ajan/araclar/kayit.ts Arac) çevrilir. Kurallar tek yerde:
//  • Ad: sağlayıcının kabul ettiği ^[a-zA-Z0-9_-]{1,64}$ (shared/mcp-baglanti.ts mcpAracAdlari); çağrı her zaman servisin ÖZGÜN adıyla gider.
//  • Şema: sağlayıcıya düzleşmiş (tür dizisi, anyOf/oneOf/allOf yok), sunucunun şema sınırına (16.000) sığacak biçimde; girdinin doğrulaması özgün şemayla.
//  • Onay: MCP'de yazan araç HER çağrıda onay ister (bir_kez / reddet; görev boyu izin yok). Katalog servisinde onaysız yalnız: katalogun saltOkunur
//    listesindeki araç ya da salt okunur ilanlı, yıkıcı olmayan ve adı okuma fiilli araç (shared/mcp-katalog.ts aracOnayGerekirMi; düzeltme turu 1,
//    denetleyici kararı) — karar HER çağrıda o anki katalog girdisiyle verilir. Developer'ın kendi sunucusunda readOnlyHint onaysız.
//  • Ad öneki: katalog `mcp__<servis>__`, Developer'ın sunucusu `mcpg__<servis>__` (aynı adlı iki servisin araçları çakışmaz).
//  • Sonuç: metin parçaları (yoksa yapılandırılmış sonucun JSON'ı) 40.000 karakterde kesilir ve not GERÇEK boyu söyler; ajan döngüsü 20.000'de yeniden
//    keser ve aynı gerçek boyu taşır (ajan/zincir.ts aracSonucuKisalt). Sessiz kesme yok.
import { metinKisalt, type Arac, type AracSonucu } from '../ajan/araclar/kayit.js';
import { aracSonucuKisalt } from '../ajan/zincir.js';
import { aracOnayGerekirMi, type McpKatalogGirdisi } from '../../shared/mcp-katalog.js';
import { mcpAracAdlari, mcpOneki, mcpSemaDuzlestir, semaAciklamasiz } from '../../shared/mcp-baglanti.js';
import { ARAC_ISTEK_SINIRI } from '../../shared/sohbet-protokolu.js';

/** MCP `tools/list` öğesinin kullandığımız alanları. */
export interface McpAracBilgisi {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
}
/** MCP `tools/call` sonucunun kullandığımız alanları. */
export interface McpCagriSonucu { content?: unknown; structuredContent?: unknown; isError?: boolean }

/** MCP sonucunun modele giden ilk kesimi (karakter): bellekte ve kayıtta sınırsız büyümesin; asıl sınır ajan döngüsünde (20.000). */
export const MCP_ON_KESIM = 40_000;
const ACIKLAMA_AZAMI = 1_000;

/** Şema sunucunun araç başına sınırını aşıyorsa önce iç açıklamalar atılır; yine sığmazsa boş nesne şeması + açıklamada not (araç düşmez). */
function semaSigdir(sema: Record<string, unknown>): { sema: Record<string, unknown>; not: string } {
  if (JSON.stringify(sema).length <= ARAC_ISTEK_SINIRI.sema) return { sema, not: '' };
  const sade = semaAciklamasiz(sema) as Record<string, unknown>;
  if (JSON.stringify(sade).length <= ARAC_ISTEK_SINIRI.sema) return { sema: sade, not: '' };
  return { sema: { type: 'object', properties: {}, additionalProperties: true }, not: ' (Girdi şeması çok büyük olduğu için burada verilmedi; alanları servisin belgesine göre ver.)' };
}

/** Sonucun modele giden metni: metin parçaları, yoksa yapılandırılmış sonucun (ya da tüm sonucun) JSON'ı; 40.000'de gerçek boyu söyleyen notla kesilir. */
export function mcpSonucMetni(r: McpCagriSonucu): { icerik: string; gorseller?: { medya: string; veri: string }[]; ham: string } {
  const parcalar = (Array.isArray(r.content) ? r.content : []) as Array<{ type?: string; text?: string; data?: string; mimeType?: string }>;
  const ham = parcalar.filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('\n') || JSON.stringify(r.structuredContent ?? r) || '';
  const gorseller = parcalar.filter((p) => p?.type === 'image' && typeof p.data === 'string' && p.data).slice(0, 2).map((p) => ({ medya: p.mimeType ?? 'image/png', veri: String(p.data) }));
  return { icerik: aracSonucuKisalt(ham, MCP_ON_KESIM), ...(gorseller.length ? { gorseller } : {}), ham };
}

export interface McpServisi {
  /** Kullanıcının gördüğü servis adı (araç kartı, onay, ARAÇ NOTLARI). */
  ad: string;
  /** Fuber kataloğundan mı (her turda listede, Developer sunucularından önce; zincir.ts araclariSirala). */
  katalog: boolean;
  /** O ANKİ katalog girdisi (saltOkunur listesi; her çağrıda yeniden okunur — katalogdaki değişiklik açık bağlantıda da hemen geçerli);
   *  Developer'ın kendi sunucusunda null. Katalog servisinde girdi artık yoksa null döner: araç onay ister. */
  girdi: () => McpKatalogGirdisi | null;
  /** Aracı ÖZGÜN adıyla çağırır. `sinyal`: tur durdurulunca ya da bulut kapanınca kesilir. */
  cagir: (ozgunAd: string, girdi: Record<string, unknown>, sinyal: AbortSignal) => Promise<McpCagriSonucu>;
  /** Çağrıdan önce (ağa çıkmadan) sorulur: bir metin dönerse araç çalışmaz, o metin hata sonucu olur (Gizli, "yenilenmeli"). */
  kapali?: () => string | null;
  /** Çağrı fırladı: kullanıcıya/modele gidecek tek cümle (bilinen hatalar); null ise "Araç hatası: …". */
  hataMetni?: (e: unknown) => string | null;
}

/** Servisin araç listesi → Fuber araçları (sıra korunur). */
export function mcpAraclariKur(servis: McpServisi, araclar: readonly McpAracBilgisi[]): Arac[] {
  const adlar = mcpAracAdlari(mcpOneki(servis.ad, servis.katalog ? 'katalog' : 'gelistirici'), araclar.map((t) => t.name));
  const temizAd = [...adlar.keys()];
  return araclar.map((t, i): Arac => {
    // Karar her çağrıda o anki girdiyle (katalog servisinin girdisi kalktıysa onaylı).
    const onayli = (): boolean => {
      if (!servis.katalog) return aracOnayGerekirMi(null, t);
      const g = servis.girdi();
      return g ? aracOnayGerekirMi(g, t) : true;
    };
    const ozgunSema = (t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema) ? t.inputSchema : { type: 'object', properties: {} }) as Record<string, unknown>;
    const { sema, not } = semaSigdir(mcpSemaDuzlestir(ozgunSema));
    const baslik = t.title ?? t.annotations?.title ?? t.name;
    return {
      grup: 'mcp',
      mcp: { servis: servis.ad, ...(servis.katalog ? { katalog: true } : {}) },
      /** Güncel karar (kart, kayıt ve geri dönüşsüzlük bunu okur). */
      get risk() { return onayli() ? 'onay' : 'serbest'; },
      etiket: () => `${servis.ad} · ${baslik}`,
      tanim: { ad: temizAd[i], aciklama: `[${servis.ad}] ${t.description ?? t.name}`.slice(0, ACIKLAMA_AZAMI - not.length) + not, sema },
      dogrulamaSemasi: ozgunSema,
      async calistir(g, b): Promise<AracSonucu> {
        const kapali = servis.kapali?.();
        if (kapali) return { icerik: kapali, hata: true, ozet: 'kullanılamıyor' };
        if (onayli()) {
          // Yazan araç: her çağrıda (görev boyu izin yok). Gizli açılırsa kart beklenirken de çağrı başlamaz (aşağıda yeniden sorulur).
          const k = await b.onay({
            baslik: `${servis.ad} aracı çalıştırılsın mı?`, aciklama: `${baslik}: ${metinKisalt(t.description ?? '', 160)}`,
            onizleme: JSON.stringify(g, null, 2).slice(0, 2000), tehlike: t.annotations?.destructiveHint ? 'yuksek' : 'orta',
          });
          if (k === 'reddet') return { icerik: 'Kullanıcı onay vermedi (reddedildi).', hata: true, ozet: 'reddedildi' };
          const yine = servis.kapali?.();
          if (yine) return { icerik: yine, hata: true, ozet: 'kullanılamıyor' };
        }
        let r: McpCagriSonucu;
        try {
          r = await servis.cagir(t.name, g, b.sinyal);
        } catch (e) {
          const m = servis.hataMetni?.(e);
          if (m) return { icerik: m, hata: true, ozet: metinKisalt(m, 120) };
          throw e;
        }
        const s = mcpSonucMetni(r);
        return { icerik: s.icerik, ...(s.gorseller ? { gorseller: s.gorseller } : {}), hata: Boolean(r.isError), ozet: metinKisalt(s.ham.slice(0, 2_000).replace(/\s+/g, ' '), 120) };
      },
    };
  });
}
