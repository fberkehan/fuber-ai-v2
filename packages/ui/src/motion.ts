/**
 * Hareket ön ayarları (Motion for React). CSS tarafı `tokens.css` içindeki `--duration-*` ve `--ease-*`
 * değişkenleridir; ikisi birlikte değişir.
 *
 * Kural (KURGU §12): yay tabanlı, 180–320 ms, her geçiş kesilebilir, süs için döngü yok.
 * Yaylar `visualDuration` ile tanımlıdır: göze görünen yerleşme süresi doğrudan saniye olarak okunur,
 * yay kesildiğinde hızını koruyarak yeni hedefe döner.
 *
 * Azaltılmış hareket tek yerden: `useMotionPreset(enter.fadeUp)` konum/ölçek değişimini atar,
 * yalnız saydamlığı bırakır. Bileşenler hazır ön ayarı doğrudan değil bu kancayla kullanır.
 */
import { useReducedMotionConfig } from 'motion/react';
import type { Transition, TargetAndTransition } from 'motion/react';

/**
 * Azaltılmış hareket: çevredeki `MotionConfig` (uygulama ayarı: "Azaltılmış" / "Tam") varsa onu, yoksa işletim
 * sisteminin tercihini izler. Varlık ve ada da bunu okur: ayar "Azaltılmış" iken akış, sarmal ve dudak durur.
 */
export function useReducedMotion(): boolean | null {
  return useReducedMotionConfig();
}

/** Saniye cinsinden (Motion birimi). CSS: `--duration-*`. */
export const durations = {
  /** Basma geri bildirimi. */
  instant: 0.12,
  fast: 0.18,
  base: 0.24,
  slow: 0.32,
} as const;

/** CSS: `--ease-out`, `--ease-in-out`, `--ease-drawer`. Giriş/çıkış `out`, yerinde biçim değişimi `inOut`. */
export const easings = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
  drawer: [0.32, 0.72, 0, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** Adlandırılmış yaylar. Hepsi kesilebilir; zıplama yalnız `gentle`'da ve çok az. */
export const spring = {
  /** Düğme, anahtar, sekme göstergesi, menü: hızlı ve sert. */
  snappy: { type: 'spring', visualDuration: 0.2, bounce: 0 },
  /** Kart, panel, liste satırı, diyalog. */
  smooth: { type: 'spring', visualDuration: 0.26, bounce: 0 },
  /** Ada, sahne, toast gibi büyük ya da "canlı" yüzeyler: hafif esnek. */
  gentle: { type: 'spring', visualDuration: 0.32, bounce: 0.12 },
} as const satisfies Record<string, Transition>;

/** Eski ad (T0 iskeleti); yeni kodda `spring` kullanın. */
export const springs = spring;

/** Saydamlık ve renk gibi konumsuz geçişler için eğri tabanlı geçiş. */
export const fade: Transition = { duration: durations.fast, ease: easings.out };

/** Liste girişlerinde öğeler arası gecikme (saniye). 30–80 ms aralığında. */
export const STAGGER = 0.035;

export interface MotionPreset {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
}

/**
 * Giriş/çıkış ön ayarları. `motion.div {...enter.fadeUp}` olarak yayılır ya da `useMotionPreset` ile
 * azaltılmış hareket uygulanmış hâli alınır. Ölçek hiçbir zaman 0'dan başlamaz.
 */
export const enter = {
  /** Yalnız saydamlık. */
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: fade,
  },
  /** Sayfa bölümü, liste satırı, kart: 8 px aşağıdan. */
  fadeUp: {
    initial: { opacity: 0, transform: 'translateY(8px)' },
    animate: { opacity: 1, transform: 'translateY(0px)' },
    exit: { opacity: 0, transform: 'translateY(4px)' },
    transition: spring.smooth,
  },
  /** Menü, açılır pencere: tetikleyiciden (transform-origin çağıranda) hafif ölçekle. */
  pop: {
    initial: { opacity: 0, transform: 'scale(0.96) translateY(-4px)' },
    animate: { opacity: 1, transform: 'scale(1) translateY(0px)' },
    exit: { opacity: 0, transform: 'scale(0.98) translateY(-2px)' },
    transition: spring.snappy,
  },
  /** Diyalog: merkezde, hafif ölçek + yukarı. */
  dialog: {
    initial: { opacity: 0, transform: 'scale(0.97) translateY(10px)' },
    animate: { opacity: 1, transform: 'scale(1) translateY(0px)' },
    exit: { opacity: 0, transform: 'scale(0.98) translateY(6px)' },
    transition: spring.smooth,
  },
  /** Toast: sağ alttan, aşağıdan gelir ve aşağıdan çıkar. */
  toast: {
    initial: { opacity: 0, transform: 'translateY(100%) scale(0.98)' },
    animate: { opacity: 1, transform: 'translateY(0%) scale(1)' },
    exit: { opacity: 0, transform: 'translateY(30%) scale(0.98)' },
    transition: spring.gentle,
  },
} as const satisfies Record<string, MotionPreset>;

/** `stagger(i)`: i'nci öğenin geçişi; listeler bununla kademelenir. Uzun listede 8. öğeden sonra bekleme büyümez. */
export function stagger(index: number, base: Transition = spring.smooth): Transition {
  return { ...base, delay: Math.min(index, 8) * STAGGER };
}

/** Azaltılmış harekette bir ön ayarın yalnız saydamlık kalan hâli (saf işlev; sınanır). */
export function reducePreset(preset: MotionPreset): MotionPreset {
  const strip = (target: TargetAndTransition): TargetAndTransition => {
    const out: TargetAndTransition = {};
    if ('opacity' in target) out.opacity = target.opacity;
    return out;
  };
  return {
    initial: strip(preset.initial),
    animate: strip(preset.animate),
    exit: strip(preset.exit),
    transition: fade,
  };
}

/** Ön ayarı kullanıcının hareket tercihine göre döndürür. Bütün bileşenler bunu kullanır. */
export function useMotionPreset(preset: MotionPreset): MotionPreset {
  const reduced = useReducedMotion();
  return reduced ? reducePreset(preset) : preset;
}

/** Yay geçişini azaltılmış harekette anlık yapar (kayan göstergeler, düzen animasyonları). */
export function useMotionTransition(transition: Transition = spring.snappy): Transition {
  const reduced = useReducedMotion();
  return reduced ? { duration: 0 } : transition;
}
