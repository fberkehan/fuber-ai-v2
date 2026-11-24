// Yürürlükteki yetki durumu (`authority.get` + `authority.changed`): Ayarlar › Genel ve durum şeridi aynı kaynaktan okur.
import type { AuthorityState } from '@fuber/shared';
import { useLive } from './live';

export function useAuthority(): { state: AuthorityState | null; reload: () => void } {
  const live = useLive<AuthorityState>(() => window.fuber.invoke('authority.get'), ['authority.changed']);
  return { state: live.data, reload: live.reload };
}
