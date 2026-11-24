// Yapay zekânın sohbet kartı (0.11 G6): `kart_goster` aracının altı türü — özet, liste, tablo, adımlar, karşılaştırma, bağlantılar. Fuber arayüz
// kütüphanesinden (Kart, Liste, Satir, MetinKirp) kurulur: aynı tipografi, aynı taşma kuralı (her metnin satır sınırı var, tamamı `title`'da ve
// klavye odağında), üç tema. İçerik her zaman React METNİdir — ham HTML enjeksiyonu, Markdown çevirisi ya da HTML yok (tests/kart.test.ts kaynağı
// tarar); "<" ve ">" içeren metin olduğu gibi görünür. Bağlantı yalnız ana sürecin `sistem:ac` yoluyla açılır (o da yalnız http/https; shared/kart.ts
// adresi zaten doğrular); sayfa içi bağlantı öğesi yok. Veri tek kaynaktan doğrulanmış gelir (shared/kart.ts kartDogrula).
// KartOzeti: adadaki kısaltılmış görünüm (ilk 3 satır + "Sohbette gör").
import { cagir } from '../api';
import { Kart, Liste, MetinKirp, Satir } from '../ui';
import { Ikon } from './Ikon';
import { kartBaslik, kartOzetSatirlari, type KartVerisi } from '../../shared/kart';
import './sohbet-kartlari.css';

type Tur<T extends KartVerisi['tur']> = Extract<KartVerisi, { tur: T }>;

/** Bağlantının görünen sunucu adı ("www." düşer); çözülemezse adresin kendisi. */
const sunucuAdi = (adres: string): string => { try { return new URL(adres).hostname.replace(/^www\./i, '') || adres; } catch { return adres; } };

function Ozet({ k }: { k: Tur<'ozet'> }) {
  return (
    <ul className="yz-maddeler">
      {k.maddeler.map((m, i) => (
        <li key={i}><span className="yz-nokta" aria-hidden="true" /><MetinKirp as="span" metin={m} satir={4} /></li>
      ))}
    </ul>
  );
}

function ListeKarti({ k }: { k: Tur<'liste'> }) {
  return (
    <Liste>
      {k.ogeler.map((o, i) => (
        <Satir
          key={i}
          baslik={o.baslik}
          satir={2}
          alt={o.alt}
          altSatir={2}
          sag={o.sag ? <span className="yz-sag"><MetinKirp as="span" metin={o.sag} satir={2} /></span> : undefined}
        />
      ))}
    </Liste>
  );
}

function Hucre({ metin }: { metin: string }) {
  return metin ? <MetinKirp as="span" metin={metin} satir={4} /> : <span className="yz-bos" role="img" aria-label="boş">—</span>;
}

/** Yığın görünümünde ("dar kapta dört+ sütun") hücrenin başındaki sütun adı: CSS `attr()` ile çizilir, uzun başlık kısalır. */
const sutunEtiketi = (s: string): string => { const c = [...s]; return c.length > 24 ? `${c.slice(0, 23).join('')}…` : s; };

function Tablo({ k }: { k: Tur<'tablo'> }) {
  return (
    <div className="yz-tablo-kap">
      <table className="yz-tablo" data-genis={k.sutunlar.length >= 4 ? '' : undefined}>
        <thead>
          <tr>{k.sutunlar.map((s, j) => <th key={j} scope="col"><MetinKirp as="span" metin={s} satir={2} /></th>)}</tr>
        </thead>
        <tbody>
          {k.satirlar.map((satir, i) => (
            <tr key={i}>{satir.map((h, j) => <td key={j} data-sutun={sutunEtiketi(k.sutunlar[j])}><Hucre metin={h} /></td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Adimlar({ k }: { k: Tur<'adimlar'> }) {
  return (
    <ol className="yz-adimlar">
      {k.adimlar.map((a, i) => (
        <li key={i}><span className="yz-no" aria-hidden="true">{i + 1}</span><MetinKirp as="span" metin={a} satir={4} /></li>
      ))}
    </ol>
  );
}

function Karsilastirma({ k }: { k: Tur<'karsilastirma'> }) {
  return (
    <div className="yz-tablo-kap">
      <table className="yz-tablo yz-tablo--kars" data-genis={k.secenekler.length >= 3 ? '' : undefined}>
        <thead>
          <tr>
            <th scope="col"><span className="ui-gizli">Özellik</span></th>
            {k.secenekler.map((s, j) => <th key={j} scope="col"><MetinKirp as="span" metin={s} satir={2} /></th>)}
          </tr>
        </thead>
        <tbody>
          {k.ozellikler.map((o, i) => (
            <tr key={i}>
              <th scope="row"><MetinKirp as="span" metin={o.ad} satir={3} /></th>
              {o.degerler.map((d, j) => <td key={j} data-sutun={sutunEtiketi(k.secenekler[j])}><Hucre metin={d} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Baglantilar({ k }: { k: Tur<'baglantilar'> }) {
  return (
    <Liste>
      {k.baglantilar.map((b, i) => (
        <Satir
          key={i}
          sol={<Ikon ad="dis" olcu={16} />}
          baslik={b.baslik}
          satir={2}
          alt={sunucuAdi(b.adres)}
          ipucu={b.adres}
          tikla={() => { void cagir('sistem:ac', b.adres); }}
        />
      ))}
    </Liste>
  );
}

function Govde({ k }: { k: KartVerisi }) {
  switch (k.tur) {
    case 'ozet': return <Ozet k={k} />;
    case 'liste': return <ListeKarti k={k} />;
    case 'tablo': return <Tablo k={k} />;
    case 'adimlar': return <Adimlar k={k} />;
    case 'karsilastirma': return <Karsilastirma k={k} />;
    case 'baglantilar': return <Baglantilar k={k} />;
  }
}

/** Sohbetteki kart. Başlığı yoksa kartın adı (tür) ekran okuyucuya `aria-label` ile söylenir. */
export function YapayZekaKarti({ kart }: { kart: KartVerisi }) {
  return (
    <Kart yogun className="yz-kart" baslik={kart.baslik} aria-label={kart.baslik ? undefined : kartBaslik(kart)} data-yz-kart={kart.tur}>
      <Govde k={kart} />
    </Kart>
  );
}

/** Adadaki kısaltılmış kart: başlık, ilk 3 satır ve "Sohbette gör". */
export function KartOzeti({ kart, sohbeteGit }: { kart: KartVerisi; sohbeteGit: () => void }) {
  const o = kartOzetSatirlari(kart, 3);
  return (
    <Kart yogun className="yz-kart yz-kart--ada" baslik={o.baslik} eylem={{ etiket: 'Sohbette gör', tikla: sohbeteGit }} data-yz-ozet={kart.tur}>
      {/* 11 Kas (tasarımcı bulgu 8): tablo ve karşılaştırma ham "Plan | Aylık" satırları değil, hizalı küçük tablo (başlık + ilk 3 satır). */}
      {o.tablo ? (
        <table className="yz-ozet-tablo" data-ozet-tablo="">
          <thead><tr>{o.tablo.sutunlar.map((s, i) => <th key={i} scope="col">{s ? <MetinKirp as="span" metin={s} satir={1} /> : null}</th>)}</tr></thead>
          <tbody>{o.tablo.satirlar.map((r, i) => <tr key={i}>{r.map((h, j) => (j === 0 ? <th key={j} scope="row"><MetinKirp as="span" metin={h} satir={1} /></th> : <td key={j}><MetinKirp as="span" metin={h} satir={1} /></td>))}</tr>)}</tbody>
        </table>
      ) : (
        <ul className="yz-ozet">
          {o.satirlar.map((s, i) => <li key={i}><MetinKirp as="span" metin={s} satir={1} /></li>)}
        </ul>
      )}
      {o.kalan > 0 && <p className="yz-kalan">+{o.kalan} satır daha</p>}
    </Kart>
  );
}
