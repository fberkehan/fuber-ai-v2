import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MotionConfig } from 'motion/react';
import type { IslandShellHandle } from '@fuber/ui';
import { isEmpty, useEnvelope, ZERO, type Size } from './envelope';
import { IslandView, expandable } from './IslandView';
import { HOVER_LINGER_MS, insideShape, pointFromClient, shouldPassThrough, type IslandPoint } from './hover';
import { useIslandModel } from './island-model';
import { quiet, useEvent, useReportSize } from './use-hud';

/** Gövde biçim değiştirirken zarfın beklediği süre (yay süresi + pay). */
const SETTLE_MS = 520;
/** Gövdenin üst kenara çekilme süresi; bitince pencere gizlenir. */
const LEAVE_MS = 340;
/**
 * Pencere payı (CSS px): gövdenin iki yanında (omuzların ötesinde) ve altında gölge ile kenar ışığının hâlesi için
 * kalan boşluk. Üstte pay yoktur: gövde ekranın üst kenarına kaynaklıdır.
 */
const PAD = { x: 10, bottom: 22 } as const;
/** Windows üst düzey pencereyi bundan alçak yapmaz (bkz. hud.css). */
const MIN_HEIGHT = 40;
/**
 * Sahne: ada görünürken penceresi bu SABİT ölçüdedir; gövde ve içerik onun içinde canlanır. Pencere her biçim
 * değişiminde yeniden boyutlanmaz: saydam bir pencereyi animasyonun ortasında boyutlandırmak üretimde titreme
 * yapıyordu (pencere yeni ölçüye geçtiği karede içerik eski ölçüyle çiziliyor, ortalanmış gövde yarım fark kadar
 * sıçrıyordu; kullanıcı "çentikli animasyonlarda sıkıntı var" dedi). En geniş satır ve en yüksek kart buna sığar; sığmayan
 * olursa pencere o içerik için büyür. Pencere gövdeden büyük olduğu için tıklamayı yalnız biçimin içi alır (`hover.ts`).
 */
const STAGE: Size = { width: 720, height: 340 };

/**
 * Ada (üst orta). Boşta hiçbir şey çizmez; pencere de gizlidir. Ana pencere odaktayken ana süreç adayı gizler ve
 * durumu ana pencerenin çentiği gösterir (`hud.owner`); model burada da canlı kalır ki geri gelişte boş kare olmasın.
 *
 * Gövde ekranın üst kenarına kaynaklıdır ve içerikle birlikte yaylanarak biçim değiştirir; pencere zarfı izler
 * (büyürken önce pencere, küçülürken geçiş bitince). İmleç gelince ada KAYBOLMAZ: yerinde kalır, seyredilen hâllerde
 * hafifçe genişleyip hızlı denetimleri (mikrofon, sustur, sohbet kipi, ana pencere) gösterir. Tıklamayı yalnız
 * biçimin DIŞI alttaki uygulamaya geçirir (`hover.ts`).
 */
export function Island() {
  const reportRef = useReportSize('island');
  const shellRef = useRef<IslandShellHandle>(null);
  const model = useIslandModel(() => shellRef.current?.wake());
  const { view } = model;

  // Çekilme sürerken son görünüm çizilmez (gövde boşalır ve üst kenara döner); pencere geçiş bitince gizlenir.
  const [present, setPresent] = useState(view !== null);
  useLayoutEffect(() => {
    if (view) {
      setPresent(true);
      return;
    }
    const timer = setTimeout(() => setPresent(false), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [view]);

  // Zarf: gövdenin hedef ölçüsü + pay. Gövde çekilirken son ölçü korunur (pencere geçiş bitmeden küçülmez).
  const [target, setTarget] = useState<Size>(ZERO);
  const lastTarget = useRef<Size>(ZERO);
  if (!isEmpty(target)) lastTarget.current = target;
  const shape = !present ? ZERO : isEmpty(target) ? lastTarget.current : target;
  const natural = isEmpty(shape)
    ? ZERO
    : { width: Math.max(STAGE.width, shape.width + PAD.x * 2), height: Math.max(STAGE.height, MIN_HEIGHT, shape.height + PAD.bottom) };
  const envelope = useEnvelope(natural, SETTLE_MS);
  useEffect(() => {
    if (!present) lastTarget.current = ZERO;
  }, [present]);
  // Gövde büyümeden önce pencerenin gerçekten büyüdüğüne bakılır (1 px yuvarlama payı).
  const fits = useCallback(
    (size: Size) => window.innerWidth >= size.width + PAD.x * 2 - 1 && window.innerHeight >= Math.max(MIN_HEIGHT, size.height + PAD.bottom) - 1,
    [],
  );

  // ── imleç: üstüne gelme ve tıklamanın geçişi ──
  // Konum iki kaynaktan gelir: ana sürecin yoklaması (`hud.pointer`; pencere tıklamayı geçirirken de gelir) ve
  // sayfanın kendi fare olayı. Gövdenin üstündeyken ada yerinde kalır ve denetimler açılır; biçimin dışında pencere
  // tıklamayı alttaki uygulamaya geçirir.
  const pointer = useRef<IslandPoint | null>(null);
  const [inside, setInside] = useState(false);
  const [hover, setHover] = useState(false);
  // Varsayılan: geçir. Sahne gövdeden büyüktür; imleç gövdenin üstünde olduğu bilinene kadar pencere tıklamayı tutmaz.
  const [passThrough, setPassThrough] = useState(true);
  const zone = useRef<Size>(ZERO);
  zone.current = present ? shape : ZERO;
  const judge = useCallback(() => {
    setInside(insideShape(pointer.current, zone.current));
    setPassThrough(shouldPassThrough(pointer.current, zone.current));
  }, []);
  useEvent('hud.pointer', ({ surface, x, y }) => {
    if (surface !== 'island') return;
    pointer.current = { x, y };
    judge();
  });
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      pointer.current = pointFromClient(event.clientX, event.clientY, window.innerWidth);
      judge();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [judge]);
  useEffect(judge, [judge, view, shape.width, shape.height]);
  // Denetimler imleç ayrılınca kısa bir an açık kalır (kenardan kaçan imleç kapatıp açmasın).
  useEffect(() => {
    if (inside) {
      setHover(true);
      return;
    }
    const timer = setTimeout(() => setHover(false), HOVER_LINGER_MS);
    return () => clearTimeout(timer);
  }, [inside]);
  useEffect(() => {
    if (!present) {
      pointer.current = null;
      setInside(false);
      setHover(false);
      setPassThrough(true);
    }
  }, [present]);
  // Biçimin dışındaki tıklama alttaki uygulamaya geçer; ada her görünüşünde durum yeniden bildirilir (ana süreç
  // gizlenen adayı tıklanır hâle döndürür).
  useEffect(() => {
    if (!present) return;
    void quiet(window.fuber.invoke('hud.passthrough', { surface: 'island', on: passThrough }));
  }, [passThrough, present]);
  const expanded = hover && expandable(view);
  const motion = model.motionSetting;

  return (
    <MotionConfig reducedMotion={motion === 'on' ? 'always' : motion === 'off' ? 'never' : 'user'}>
      <div ref={reportRef} className="hud-content" data-testid="hud-content" data-surface="island" style={{ width: envelope.width, height: envelope.height }}>
        <div className="island-anchor" data-hover={expanded ? '' : undefined} data-passthrough={passThrough ? '' : undefined}>
          <IslandView model={model} hover={expanded} shellRef={shellRef} onTarget={setTarget} fits={fits} />
        </div>
      </div>
    </MotionConfig>
  );
}
