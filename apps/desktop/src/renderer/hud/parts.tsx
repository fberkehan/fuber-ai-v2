import { useLayoutEffect, useRef, type ReactNode } from 'react';
import {
  Alarm,
  AppWindow,
  Bell,
  ChartBar,
  CheckSquare,
  FolderSimple,
  Globe,
  Info,
  ListBullets,
  Notebook,
  Table,
  Wrench,
} from '@phosphor-icons/react';
import { cn } from '@fuber/ui';

/** `Control+Alt+M` → `['Ctrl', 'Alt', 'M']` (KeyHint kapakları). */
export function acceleratorKeys(accelerator: string): string[] {
  const names: Record<string, string> = { Control: 'Ctrl', CommandOrControl: 'Ctrl', CmdOrCtrl: 'Ctrl', Option: 'Alt', Super: 'Win', Meta: 'Win' };
  return accelerator
    .split('+')
    .filter(Boolean)
    .map((key) => names[key] ?? key);
}

/** Kayma geçişinin süresi (`hud.css` › `.hud-tail > span`) + pay: bu süre boyunca sol kenar yumuşak söner. */
const TAIL_SLIDE_MS = 280;

/**
 * Tek satırlık canlı yazı: kabın en geniş hâline kadar büyür; taşınca en yeni sözcükler görünür kalır ve metin sola
 * kayar. Görünen kısım her zaman bir SÖZCÜĞÜN başından başlar: sözcük ortasından kırpılmış harf görünmez
 * ("…nüz bağlı değil" değil, "bağlı değil"). Sol kenardaki solma yalnız kayma sürerken vardır.
 */
export function TailText({ text, className, testId }: { text: string; className?: string; testId?: string }) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const box = outer.current;
    const line = inner.current;
    if (!box || !line) return;
    // Önceki turun daralttığı genişlik kalkar: taşma, kabın izin verilen en geniş hâline göre ölçülür.
    box.style.width = '';
    const overflow = Math.max(0, line.offsetWidth - box.clientWidth);
    if (overflow <= 0) {
      line.style.transform = '';
      delete box.dataset.overflow;
      delete box.dataset.sliding;
      return;
    }
    // Taşan kısmın bittiği yerden sonraki ilk sözcük başı. Hem satır hem aralık aynı dönüşümün içinde olduğu için
    // fark, süren kayma geçişinden etkilenmez.
    let shift = overflow;
    const node = line.firstChild;
    if (node instanceof Text) {
      const range = document.createRange();
      const base = line.getBoundingClientRect().left;
      for (const gap of text.matchAll(/\s+(?=\S)/g)) {
        const index = gap.index + gap[0].length;
        if (index >= node.length) break;
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const left = range.getBoundingClientRect().left - base;
        if (left >= overflow) {
          shift = left;
          break;
        }
      }
    }
    line.style.transform = `translateX(${-shift}px)`;
    // Kap görünen metne daralır: sağda yarım sözcüklük boşluk kalmaz.
    box.style.width = `${Math.ceil(line.offsetWidth - shift)}px`;
    box.dataset.overflow = '';
    box.dataset.sliding = '';
    const timer = setTimeout(() => delete box.dataset.sliding, TAIL_SLIDE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <span ref={outer} className={cn('hud-tail block min-w-0', className)} data-testid={testId} title={text}>
      <span ref={inner}>{text}</span>
    </span>
  );
}

/** Bildiren modülün simgesi (bildirim kartı ve toast). */
export function moduleIcon(moduleId: string): ReactNode {
  switch (moduleId) {
    case 'planner':
      return <Alarm weight="bold" />;
    case 'projects':
      return <FolderSimple weight="bold" />;
    case 'memory':
      return <Notebook weight="bold" />;
    case 'web':
      return <Globe weight="bold" />;
    case 'workshop':
    case 'skills':
      return <Wrench weight="bold" />;
    default:
      return <Bell weight="bold" />;
  }
}

/** Sahne kartının `icon` alanı (Phosphor adı); bilinmeyen ad genel bir simgeye düşer. */
const stageIcons: Record<string, () => ReactNode> = {
  Alarm: () => <Alarm weight="bold" />,
  Bell: () => <Bell weight="bold" />,
  CalendarCheck: () => <Alarm weight="bold" />,
  ChartBar: () => <ChartBar weight="bold" />,
  CheckSquare: () => <CheckSquare weight="bold" />,
  FolderSimple: () => <FolderSimple weight="bold" />,
  Globe: () => <Globe weight="bold" />,
  ListBullets: () => <ListBullets weight="bold" />,
  Notebook: () => <Notebook weight="bold" />,
  Table: () => <Table weight="bold" />,
  Wrench: () => <Wrench weight="bold" />,
  AppWindow: () => <AppWindow weight="bold" />,
};

export function stageIcon(name: string | undefined, fallback: 'card' | 'app'): ReactNode {
  const make = name ? stageIcons[name] : undefined;
  if (make) return make();
  return fallback === 'app' ? <AppWindow weight="bold" /> : <Info weight="bold" />;
}
