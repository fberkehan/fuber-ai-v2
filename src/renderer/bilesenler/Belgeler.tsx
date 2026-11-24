// Hafıza → Belgeler (Görev 20b, K3): öğretme klasörüne bırakılan ya da "Dosya öğret"le seçilen belgeler. Ad, tür, tarih, boyut,
// Fuber'in özeti ve bu belgeden öğrenilen kayıt sayısı; ad, içerik ya da "D-12" ile arama; silme 5 sn "Geri al" penceresinden
// sonra uygulanır (geri-al.ts) ve bu belgeden öğrenilenleri de unutturur. Dil İş moduna uygun: dizin/parça gibi teknik söz yok.
import { useEffect, useState } from 'react';
import { cagir, dinle, zamanGoreli } from '../api';
import { Ikon } from './Ikon';
import { UFAK_HAP } from './DusunmeOrtak';
import { silmeler, useSilmeler } from '../geri-al';
import { belgeTurAdi, OZETSIZ_BITTI_NOTU, OZETSIZ_NOTU, type BelgeOzeti } from '../../shared/belge';
import { useMod } from '../mod';

/** A5: .jsonl İş modunda "Sohbet kaydı", Geliştirici'de "Claude Code sohbeti" (shared/belge.ts). */
const turAdi = belgeTurAdi;

/** Çıkarılan metnin boyu → "12 KB metin" (bayt yaklaşık karakter). */
function boyutMetni(n: number): string {
  if (n < 1024) return `${n} B metin`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB metin`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB metin`;
}

export function Belgeler() {
  const [liste, setListe] = useState<BelgeOzeti[] | null>(null);
  const [sorgu, setSorgu] = useState('');
  const { gizli } = useSilmeler();
  const mod = useMod();

  const yenile = async () => {
    const l = await cagir<BelgeOzeti[]>('belge:liste', { sorgu: sorgu.trim() || undefined }).catch(() => [] as BelgeOzeti[]);
    setListe(Array.isArray(l) ? l : []);
  };
  useEffect(() => { const z = setTimeout(() => void yenile(), sorgu ? 250 : 0); return () => clearTimeout(z); }, [sorgu]);
  useEffect(() => { const k = [dinle('iceaktar:islendi', () => void yenile()), dinle('kokpit:veri-degisti', () => void yenile())]; return () => k.forEach((f) => f()); }, [sorgu]);

  // Tost yalnız GERÇEKTEN unutulacakları sayar (kaynağı yalnız bu belge); ortak kayıtlar kalır, kaynaklarından belge düşer.
  // Silme ana süreçte uygulanır; liste `kokpit:veri-degisti` olayıyla yenilenir.
  const sil = (b: BelgeOzeti) => silmeler.ertele(
    { tur: 'belge', id: b.id },
    b.yalnizBundan ? `“${b.ad}” silindi; yalnız ondan öğrenilen ${b.yalnizBundan} kayıt da unutuluyor` : `“${b.ad}” silindi`,
    `“${b.ad}” silinemedi`,
  );

  const gorunen = (liste ?? []).filter((b) => !gizli(`belge:${b.id}`));
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 280px' }}>
          <span style={{ position: 'absolute', left: 13, top: 11, color: 'var(--ink-4)' }}><Ikon ad="ara" olcu={17} /></span>
          <input className="girdi" style={{ paddingLeft: 40 }} aria-label="Belgelerde ara" placeholder="Ara: belge adı ya da içindeki bir kelime…" value={sorgu} onChange={(e) => setSorgu(e.target.value)} />
        </div>
        <button className="dgm dgm--koyu dgm--k" onClick={() => void cagir('iceaktar:dosya-sec').then(() => void yenile())}><Ikon ad="ice" olcu={14} />Dosya öğret</button>
      </div>
      {liste === null ? <div className="cok-soluk" style={{ fontSize: 13 }}>Yükleniyor…</div>
        : !gorunen.length ? (
          <div className="kart kutu cok-soluk" data-belge-bos="" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            {sorgu.trim() ? 'Eşleşen belge yok.' : 'Henüz öğrettiğin bir belge yok. Bağlantılar → Öğretme klasörüne bir dosya bırak ya da “Dosya öğret”le seç: Fuber okur, özetler ve öğrendiklerini hafızasına işler. Belgelerin burada görünür; istediğini silebilirsin.'}
          </div>
        ) : gorunen.map((b) => (
          <div key={b.id} className="kart belge" data-belge={b.id}>
            <div className="belge__ana">
              <div className="belge__ust">
                <span className="hap" style={UFAK_HAP}>D-{b.id}</span>
                <span className="hap" style={UFAK_HAP}>{turAdi(b.tur, mod)}</span>
                {b.durum === 'bekliyor' && <span className="hap" style={UFAK_HAP}>inceleniyor</span>}
                {b.durum === 'hata' && <span className="hap" style={{ ...UFAK_HAP, color: 'var(--yazi-hata)' }}>okunamadı</span>}
                {b.durum === 'ozetsiz' && !b.ozetHakkiBitti && <span className="hap" style={UFAK_HAP} data-belge-ozetsiz="">özet sonra</span>}
                <b className="belge__ad" title={b.ad}>{b.ad}</b>
              </div>
              {b.ozet && <div className="soluk belge__ozet">{b.ozet}</div>}
              {/* 0.12 cila düzeltme turu 1 (I-1): özet çıkarılamadıysa sakin not — hata değil; Fuber sonra yeniden dener. */}
              {!b.ozet && b.durum === 'ozetsiz' && <div className="soluk belge__ozet" role="note" data-ozetsiz-notu={b.ozetHakkiBitti ? 'bitti' : 'sonra'}>{b.ozetHakkiBitti ? OZETSIZ_BITTI_NOTU : OZETSIZ_NOTU}</div>}
              <div className="t-kucuk">{[zamanGoreli(b.tarih), boyutMetni(b.boyut), b.hafiza ? `${b.hafiza} hafıza kaydı bundan` : 'bundan hafıza kaydı yok'].join(' · ')}</div>
            </div>
            <button className="dgm dgm--hayalet dgm--k dgm--simge" title="Sil" aria-label={`Sil: ${b.ad}`} onClick={() => sil(b)}><Ikon ad="cop" olcu={14} /></button>
          </div>
        ))}
      {!!gorunen.length && <div className="t-kucuk">Silinen belgenin dosyası öğretme klasöründe kalır; Fuber onu kendiliğinden yeniden öğrenmez. Yeniden öğretmek için “Dosya öğret”le seç.</div>}
    </div>
  );
}
