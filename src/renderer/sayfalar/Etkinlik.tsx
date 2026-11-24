// ── Etkinlik: Fuber'in şu an ne yaptığı ve bugün neler yaptığı (0.10 Görev 1, Karar D1; 0.13 T15: tek sütun akış) ──────────────────────────
// 3B beyin gereksiz bulundu → 3B beyin kalktı; Beyin sayfasının yerinde aynı veriyi sade gösteren 2B sayfa.
// 0.13 T15 (Spec H): paneldeki "Parçalar" bölümü anlamsız etiketler (el, göz, ayak…) gösteriyordu → Parçalar listesi, çalışan parça
// hapları ve motor kartı kalktı. KAYDIRMASIZ tek ekran, TEK sütun: "Şu an" (genel hâl + neyin çalıştığı) ve "Akış" (bugünün olayları, en yenisi
// üstte, saniyeli, düz cümlelerle: "Hatırlatıcı kuruyor", "3 e-posta okundu"). Yalnız Akış kendi içinde kayar. Anatomi metni, 3B, beyin görseli ve
// "Canlandır" anlatımı yok; bölge adları (El, Göz, Kulak…) kullanıcıya hiçbir yerde görünmez.
// Veri (ana süreç, src/main/beyin.ts — telefon da aynı kanalları kullanır): 'beyin:durum' açılışta ve 4 sn'de bir; 'beyin:olay' Akış'a
// eklenir ve 250 ms sonra durum tazelenir; 'zihin:durum' genel hâl; 'ayarlar:degisti' durumu yeniden okutur.
// Mod (K2, Ruling O / K6): İş'te sağlayıcı/model adı, ham hata ve Kod olayı yok (shared/beyin.ts olayMetni, gorunurBolgeler); model adı iki
// modda da yok.
// 0.14 T31 (Nusa dili): kök görevlerin vurgusunu taşır (vurguStili('gorevler'): Fuber'in işleri; vurgu.ts'te ayrı ekran adı yok) — yalnız "Şu an"
// noktasında. Akış boşken kart boş alanı doldurmaz (data-bos: tek satırlık boş durum, kart içeriği kadar).
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { cagir, dinle } from '../api';
import {
  gorunurBolgeler, durumOzeti, zihinHali,
  type BeyinDurumu, type BeyinOlayi, type BolgeDurumu, type BolgeId,
} from '../../shared/beyin';
import { akisBosMetni, akisSaati, akisSatirlari } from '../../shared/etkinlik';
import { gorevSayaci } from '../../shared/isler-gorunum';
import { useGorevListesi } from '../pano/useGorevler';
import { useMod } from '../mod';
import { vurguStili } from '../ui/vurgu';
import './etkinlik.css';
import { SuAnListesi } from '../is-izi/SuAn';
import { useIsIzi } from '../is-izi/depo';

/** Akış'ta en çok bu kadar satır (bellekte biraz daha fazla olay tutulur: bir kısmı satıra dönüşmez — başla/bitti gürültüsü). */
const AKIS_SATIR = 60;
const AKIS_BELLEK = 200;

export function Etkinlik(_: { git?: (sayfa: string) => void }) {
  // Kullanım biçimi yüklenene dek İş sayılır (teknik ad bir kare bile görünmesin; useMod son bilinen değerle başlar).
  const mod = useMod() ?? 'is';
  const [durum, setDurum] = useState<BeyinDurumu | null>(null);
  const [akis, setAkis] = useState<BeyinOlayi[]>([]);
  const [zihinBildirim, setZihinBildirim] = useState('bos');
  // 11 Kas (tasarımcı bulgu 1): süren görevler kokpitin Görevler kartıyla AYNI listeden (isler:liste + isler:durum) — iki ekran çelişmez.
  const gorevler = useGorevListesi();
  const gorev = gorevSayaci(gorevler ?? [], new Date());
  const canliIs = useIsIzi().length > 0;

  useEffect(() => {
    let zaman: number | null = null;
    const al = () => void cagir<BeyinDurumu>('beyin:durum').then((d) => {
      setDurum(d);
      setAkis((a) => (a.length ? a : d.olaylar.slice(-AKIS_BELLEK)));
    }).catch(() => undefined);
    al();
    const sayac = window.setInterval(al, 4000);
    const k = [
      dinle('beyin:olay', (o: BeyinOlayi) => {
        setAkis((a) => [...a.slice(-(AKIS_BELLEK - 1)), o]);
        if (zaman === null) zaman = window.setTimeout(() => { zaman = null; al(); }, 250);
      }),
      dinle('zihin:durum', (z: string) => setZihinBildirim(z)),
      dinle('ayarlar:degisti', al),
    ];
    return () => { k.forEach((f) => f()); clearInterval(sayac); if (zaman !== null) clearTimeout(zaman); };
  }, []);

  const bolgeler = gorunurBolgeler(mod);
  const bolgeDurumu = useMemo(() => Object.fromEntries((durum?.bolgeler ?? []).map((b) => [b.id, b])) as Partial<Record<BolgeId, BolgeDurumu>>, [durum]);

  // ── Şu an ──
  const calisanlar = bolgeler.filter((b) => bolgeDurumu[b.id]?.hal === 'calisiyor');
  const hali = zihinHali(zihinBildirim, calisanlar.map((b) => b.id));
  const ozet = durumOzeti(hali, calisanlar.map((b) => b.ad), bolgeDurumu.kulak?.hal === 'dinliyor', gorev);

  // ── Akış: en yeni üstte; satıra dönüşmeyen olaylar (başla/bitti gürültüsü, İş'te Kod) süzülür, peş peşe aynı satır tek olur ──
  const satirlar = useMemo(() => akisSatirlari(akis, mod, AKIS_SATIR), [akis, mod]);

  return (
    <div className="etkinlik" data-vurgu="gorevler" style={vurguStili('gorevler') as CSSProperties} data-bos={satirlar.length ? undefined : ''}>
      <div className="sayfa etkinlik__sayfa">
        <div className="sayfa__bas">
          <div>
            <div className="t-dev" style={{ fontSize: 40 }}>Etkinlik</div>
            <div className="t-giris">Fuber’in şu an ne yaptığı ve bugün neler yaptığı.</div>
          </div>
        </div>

        <div className="etkinlik__govde">
          <section className="kart etk-kart etk-simdi" data-zihin={hali} data-gorev-suren={gorev.suren || undefined} aria-label="Şu an">
            <div className="ust-etiket etk-simdi__etiket">Şu an</div>
            {/* İş izi (11 Kas): süren işler kokpitin "Şu an" kartıyla AYNI listeden ve AYNI şeritlerle; iş yokken genel hâl cümlesi. */}
            {canliIs
              ? <SuAnListesi en={8} bos={null} />
              : <><div className="etk-simdi__baslik" aria-live="polite">{ozet.baslik}</div><div className="etk-simdi__alt">{ozet.alt}</div></>}
          </section>

          <section className="kart etk-kart etk-akis" aria-label="Akış">
            <div className="etk-kart__bas"><span className="ust-etiket">Akış</span>{satirlar.length ? <span className="etk-kart__not">son {satirlar.length}</span> : null}</div>
            {satirlar.length ? (
              <ul className="etk-liste">
                {satirlar.map(({ o, m }) => (
                  <li key={o.id} className="etk-olay" data-hata={o.hata ? '' : undefined}>
                    <span className="etk-olay__saat">{akisSaati(o.zaman)}</span>
                    <span className="etk-olay__nokta" aria-hidden="true">{o.hata && <i className="nokta nokta--kirmizi" />}</span>
                    <span className="etk-olay__metin"><b>{m.ust}</b>{m.alt && <small>{m.alt}</small>}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="etk-bos">{akisBosMetni(gorev.suren)}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
