// Kabuğun sayfalara verdiği ortak durum: gezinme, asistanın adı, ses durumu, beyin, ayarlar, politika.
import { createContext, useContext, type MutableRefObject } from 'react';
import type { AppInfo, AppStatus, BrainStatus, HotkeyStatus, ModuleInfo, Policy, Settings, VoiceStatus } from '@fuber/shared';
import type { CoreState, PresenceState } from '@fuber/ui';
import type { AssistantLive } from './assistant-live';

/** Beyin şu an nerede çalışıyor: bulut (Claude), bu bilgisayardaki yerel model ya da hiçbiri (`AppStatus.brain`). */
export type BrainMode = BrainStatus['provider'];

export interface Shell {
  navigate(page: string): void;
  page: string;
  info: AppInfo | null;
  status: AppStatus | null;
  voice: VoiceStatus | null;
  /** Eski ad: ses durumu → varlık (yalnız altı temel hâl). Yeni kodda `presence` kullanın. */
  core: CoreState;
  /** Jarvis'in varlığının hâli: ses durumu; boştayken bekleyen onay ya da süren iş. */
  presence: PresenceState;
  /** Canlı satırın verisi: duyulan söz, söylenen cümle, çalışan araç, bekleyen onaylar, süren işler. */
  live: AssistantLive;
  /** Adanın sahibi: `main` = pencere odakta, durum pencerenin çentiğinde; `island` = durum yüzen adada. */
  hudOwner: 'main' | 'island';
  /** Son genlik (0–1); Core her karede okur, React çizimi gerekmez. */
  level: MutableRefObject<number>;
  policy: Policy | null;
  settings: Settings | null;
  modules: ModuleInfo[] | null;
  hotkeys: HotkeyStatus[];
  brain: BrainMode;
  /** Beynin ayrıntılı durumu (neden yerelde, yerel model hazır mı); durum henüz okunmadıysa `null`. */
  brainStatus: BrainStatus | null;
  /** Asistanın adı (politika): "Jarvis". */
  name: string;
  /** Kullanıcıya hitap: ayar ya da politika. */
  address: string;
  /** Uyandırma sözü, ilk harfleri büyük: "Hey Jarvis". */
  wakePhrase: string;
  moduleEnabled(id: string): boolean;
}

export const ShellContext = createContext<Shell | null>(null);

export function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error('useShell kabuk dışında kullanıldı');
  return shell;
}

export const getLevelFrom = (ref: MutableRefObject<number>) => () => ref.current;
