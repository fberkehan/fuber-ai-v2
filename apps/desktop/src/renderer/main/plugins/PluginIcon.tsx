import {
  BellSimple,
  BookOpen,
  CalendarBlank,
  ChartLine,
  Clock,
  Coins,
  GameController,
  GlobeSimple,
  Heart,
  ListBullets,
  MusicNotes,
  Note,
  PuzzlePiece,
  Star,
  Timer,
  Wrench,
  type Icon,
} from '@phosphor-icons/react';
import { pluginIconKey, type PluginIconKey } from './plugin-icons';

const ICONS: Record<PluginIconKey, Icon> = {
  puzzle: PuzzlePiece,
  timer: Timer,
  chart: ChartLine,
  note: Note,
  list: ListBullets,
  calendar: CalendarBlank,
  coin: Coins,
  globe: GlobeSimple,
  bell: BellSimple,
  star: Star,
  heart: Heart,
  wrench: Wrench,
  game: GameController,
  music: MusicNotes,
  book: BookOpen,
  clock: Clock,
};

/** Eklenti sayfasının simgesi (`PluginPageInfo.icon` adından). */
export const pluginIconComponent = (name: string | null | undefined): Icon => ICONS[pluginIconKey(name)];

export function PluginIcon({ name, weight, className }: { name: string | null | undefined; weight?: 'regular' | 'fill'; className?: string }) {
  const Component = pluginIconComponent(name);
  return <Component weight={weight} className={className} aria-hidden />;
}
