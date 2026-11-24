// Ayarlar içeriklerinin ortak parçaları: dizindeki metinle satır (Satir), satır olmayan ayarın kutusu (AyarBolgesi),
// Kaydet düğmeli metin girdisi ve "Kaydedildi" rozeti. `data-ayar` arama sonucundan gelince kaydırma + vurgu hedefidir.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { AYAR_TANIMLARI } from './dizin';
import { useAyarlar } from './baglam';
import { gorunurMu } from '../../shared/ayar-arama';
import { sureSuruyor } from '../../shared/ada';
import { acilYerlestir } from '../../shared/genel-kisayol';
import { useAcilDurdurma } from '../acil-kisayol';

/** Süreli ayarlar (adayı 1 saat gizle, rahatsız etme): süre ve bitiş saatinin yazısı. */
export const SAAT_MS = 3600_000;
export const saatMetni = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

/** Süreli bir durum sürüyor mu; bitince satır kendiliğinden yeniden çizilir (en geç 30 sn'de bir: uyku sonrası da). */
export function useSureBitince(bitis: string | undefined) {
  const [, yenidenCiz] = useState(0);
  const suruyor = sureSuruyor(bitis, Date.now());
  useEffect(() => {
    if (!suruyor || !bitis) return;
    const z = setTimeout(() => yenidenCiz((n) => n + 1), Math.min(Date.parse(bitis) - Date.now() + 250, 30_000));
    return () => clearTimeout(z);
  });
  return suruyor;
}

/** Bir ayarın tanımı (moda göre açıklamasıyla); İş modunda geliştirici ayarı için null. Açıklamadaki acil durdurma yer tutucusu
 *  gerçek duruma göre dolar (B8: alındıysa tuş — Mac'te ⌘+Shift+Esc —, alınamadıysa tepsideki "Tümünü durdur"). */
export function useAyarTanimi(id: string) {
  const { mod } = useAyarlar();
  const acil = useAcilDurdurma();
  const t = AYAR_TANIMLARI.get(id);
  if (!t) { console.error(`[ayarlar] dizinde olmayan ayar: ${id}`); return null; }
  if (!gorunurMu(t, mod)) return null;
  return { ad: (mod === 'is' && t.adIs) || t.ad, aciklama: acilYerlestir((mod === 'is' && t.aciklamaIs) || t.aciklama || '', acil) };
}

/** Ayar satırı: solda dizindeki ad + açıklama (ya da `aciklama`), sağda denetim. `ek` açıklamanın sonuna eklenir.
 *  `ust`: denetim üstten hizalı; `dikey`: denetimler metnin altında, tam genişlikte (birden çok seçici). */
export function Satir({ id, children, aciklama, ek, ust, dikey, stil }: { id: string; children?: ReactNode; aciklama?: ReactNode; ek?: ReactNode; ust?: boolean; dikey?: boolean; stil?: CSSProperties }) {
  const t = useAyarTanimi(id);
  if (!t) return null;
  const metin = aciklama ?? t.aciklama;
  return (
    <div className={dikey ? 'ayar ayar--dikey' : 'ayar'} data-ayar={id} style={{ ...(ust ? { alignItems: 'flex-start' } : {}), ...stil }}>
      <div className="ayar__metin"><b>{t.ad}</b>{(metin || ek) && <span>{metin}{ek}</span>}</div>
      {children}
    </div>
  );
}

/** Satır olmayan ayar (kart ızgarası, form): yalnız `data-ayar` ve mod süzgeci. */
export function AyarBolgesi({ id, children, className, stil }: { id: string; children: ReactNode; className?: string; stil?: CSSProperties }) {
  const t = useAyarTanimi(id);
  if (!t) return null;
  return <div data-ayar={id} className={className} style={stil}>{children}</div>;
}

/** Metin ayarı: yazarken kaydetmez; Kaydet düğmesi (ya da Enter) ile kaydeder. */
export function KaydetliGirdi({ deger, kaydet, genislik = 220, etiket }: { deger: string; kaydet: (v: string) => void; genislik?: number; etiket?: string }) {
  const [v, setV] = useState(deger);
  useEffect(() => setV(deger), [deger]);
  const degisti = v.trim() !== deger;
  return (
    <span style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 'none' }}>
      <input className="girdi" style={{ width: genislik }} value={v} aria-label={etiket} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && degisti) kaydet(v.trim()); }} />
      <button type="button" className="dgm dgm--koyu dgm--k" disabled={!degisti || !v.trim()} onClick={() => kaydet(v.trim())}>Kaydet</button>
    </span>
  );
}

/** Her kayıttan sonra 2 sn görünen "Kaydedildi" rozeti. */
export function KaydedildiRozeti({ zaman }: { zaman: number }) {
  const [gorunur, setGorunur] = useState(false);
  useEffect(() => {
    if (!zaman) return;
    setGorunur(true);
    const z = setTimeout(() => setGorunur(false), 2000);
    return () => clearTimeout(z);
  }, [zaman]);
  return <span className="hap ayarlar__kaydedildi" data-gorunur={gorunur} aria-live="polite">{gorunur ? '✓ Kaydedildi' : ''}</span>;
}
