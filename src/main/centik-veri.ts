// ── Çentik panelinin verisi: Gündem, Görevler, Gelenler (0.14 T24; R12, P14, B23) ─────────────────────────────────────────────────────────────
// 'centik:veri' (ipc.ts): sayfa görünür olunca çağrılır (yoklama yok; sayfalar ayrıca kokpit:veri-degisti ve isler:durum olaylarıyla tazelenir). Kurallar
// shared/centik-veri.ts'te; burada yalnız gerçek kaynaklar bağlanır:
//  • kokpit verisi (kokpit/duzen.ts kokpitVerisi: hatırlatıcı, iş, e-posta, WhatsApp, mesele) — kokpitin kendi okuduğu yerel kayıtlar, yeni model çağrısı yok;
//  • takvim: bu modda görünen, bu bilgisayarda bağlı ve gündem aracı tanımlı katalog girdisi (entegrasyon/mcp-katalog.ts; ağa çıkmadan yerel kayıttan),
//    çağrı mcpKatalogAraciCagir ile (yalnız girdinin gündem aracı); en çok 15 dk'da bir (çağrı durumu bu modülde bellekte). Önbellek yerel veritabanında
//    `takvim-onbellek` anahtarıyla (vt.ts meta: kokpit kartlarıyla aynı depo; B23). P14: Gizli ve "Yalnız bu bilgisayar"da çağrı yok, son kopya okunur;
//  • Düzeltme turu 1 (stale-while-revalidate): yanıt takvimi BEKLEMEZ — yerel veri ve önbellekteki takvim hemen döner; çağrı gerekiyorsa arka planda başlar,
//    bitince mevcut 'kokpit:veri-degisti' olayı yayınlanır ve görünen sayfa yeniden çeker (o an önbellek tazedir: yeni çağrı olmaz);
//  • Bağla'nın yeri: takvim servisinin kartı ('servis-<id>'); katalogda takvim servisi yoksa Bağla yok, tek düz satır (5 Kas).
import { kokpitVerisi } from './kokpit/duzen.js';
import { isListesi } from './isler/zamanlayici.js';
import { ayarlar } from './ayarlar.js';
import { whatsappIzinli } from './entegrasyon/whatsapp-kapisi.js';
import { meta, metaYaz } from './vt.js';
import { yayinla } from './olaylar.js';
import { gorunenKatalog, mcpBaglantiDurumu, mcpKatalogAraciCagir } from './entegrasyon/mcp-katalog.js';
import { bulutKapaliMi } from './entegrasyon/mcp-oauth.js';
import {
  gelenlerSayfasi, gundemSayfasi, takvimHemen, takvimDurumuYeni, type CentikVerisi, type TakvimBaglami,
} from '../shared/centik-veri.js';
import { OTOMATIK_GUNDEM_ARACI, takvimServisiMi } from '../shared/mcp-katalog.js';

/** Takvimin gerçek bağlamı (süreç boyunca tek çağrı durumu). Dışa açık: ana süreç testi yavaş servisi `aracCagir`ı değiştirerek sınar. */
export const takvimBaglami: TakvimBaglami = {
  bulutKapali: () => bulutKapaliMi(),
  girdi: () => {
    // 5 Kas: takvim servisi (simge takvim/microsoft ya da gündem araçlı); Yönetim gündem aracı tanımlamadıysa araç çağrı anında sunucudan seçilir.
    const g = gorunenKatalog().find((x) => takvimServisiMi(x) && mcpBaglantiDurumu(x.id) === 'bagli');
    return g ? { id: g.id, arac: g.gundemAraci ?? { ad: OTOMATIK_GUNDEM_ARACI, girdi: {} } } : null;
  },
  yenilenmeli: () => gorunenKatalog().some((x) => takvimServisiMi(x) && mcpBaglantiDurumu(x.id) === 'yenilenmeli'),
  aracCagir: (id, ad, girdi) => mcpKatalogAraciCagir(id, ad, girdi),
  oku: (k) => meta(k),
  yaz: (k, v) => metaYaz(k, v),
  simdi: () => Date.now(),
  durum: takvimDurumuYeni(),
};

/** Gündem'in "Bağla"sı: takvim servisinin kartı. 5 Kas (Bağla bir şey açıyor ama işe yaramıyordu): katalogda takvim servisi yoksa null — Bağla
 *  sunulmaz (eskiden E-posta/Servisler açılıyor, orada takvim yoktu); Gündem tek düz satır söyler. */
function gundemCipasi(): string | null {
  const takvim = gorunenKatalog().find(takvimServisiMi);
  return takvim ? `servis-${takvim.id}` : null;
}

/** Panelin üç sayfasının verisi: ağ beklemez, hiç fırlatmaz (takvim hatası Gündem'in tek satırı olur). */
export async function centikVerisi(): Promise<CentikVerisi> {
  const t = takvimHemen(takvimBaglami);
  // Arka plandaki takvim çağrısı bitince (başarı ya da hata) görünen sayfa yeniden çeker; Gizli'de bu yol hiç açılmaz (tazele null).
  void t.tazele?.then(() => yayinla('kokpit:veri-degisti', { neden: 'takvim' }));
  const v = kokpitVerisi();
  const a = ayarlar();
  const simdi = Date.now();
  return {
    gundem: gundemSayfasi(v, t.olaylar, simdi, { not: t.not, hata: t.hata, cipa: gundemCipasi(), yenilenmeli: t.yenilenmeli === true, yedekCipa: a.mod === 'gelistirici' ? 'mcp' : 'servisler' }),
    gorevler: { isler: isListesi(), mod: a.mod },
    gelenler: gelenlerSayfasi({
      epostalar: v.epostalar, whatsapp: v.whatsapp, kaynak: { eposta: a.eposta.length > 0, whatsapp: whatsappIzinli() && (a.whatsapp.etkin || a.whatsapp.bagli) },
      bulut: { gizliMod: a.yerel.gizliMod === true, yalnizYerel: a.yerel.yalnizYerel === true },
    }),
    bulutKapali: bulutKapaliMi(),
  };
}
