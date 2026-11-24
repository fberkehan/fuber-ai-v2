// Sahibi: T2. `attention.*` kanalları: bildirimler ve onay kartları.
import { t, UserError } from '@fuber/shared';
import type { RegisterHandlers } from '../router';
import { hushNotices } from '../../voice/quick';

export const register: RegisterHandlers = (ipc, { attention, tools, settings, voice }) => {
  ipc.handleAll({
    'attention.pending': () => ({ notifications: attention.pending(), approvals: tools.pendingApprovals() }),
    'attention.recent': ({ limit }) => attention.recent(limit),
    'attention.dismiss': ({ id }) => {
      attention.dismiss(id);
      return { ok: true };
    },
    'attention.hush': ({ id }) => hushNotices(attention, voice, id ? { id } : {}),
    'attention.act': ({ id, actionId }) => {
      attention.act(id, actionId);
      return { ok: true };
    },
    'attention.resolveApproval': ({ id, approve, scope }) => {
      // `scope: 'task'` ("Bu iş boyunca sorma"): onayla birlikte iş bitene kadar Tam yetki (Yönetim izin veriyorsa).
      if (!tools.resolveApproval(id, approve ? 'approved' : 'denied', 'ui', approve && scope === 'task' ? { scope: 'task' } : undefined)) {
        throw new UserError('Bu onay isteği artık geçerli değil.');
      }
      return { ok: true };
    },
    'authority.get': () => tools.authority(),
    // Arayüzden gelen değişiklik kullanıcının kendi açık eylemidir: ayrıca onay sorulmaz. Yönetim sınırı yine uygulanır.
    'authority.set': ({ level, minutes, task, clearGrant }) => {
      if (clearGrant) tools.grantAuthority(null);
      if (level) settings.update({ authorityLevel: level });
      if (typeof minutes === 'number' && minutes > 0 && !tools.grantAuthority({ minutes })) throw new UserError(t('authority.say.capped', { level: t(`authority.level.${tools.authority().max}`) }));
      if (task === true && !tools.grantAuthority({ task: true })) throw new UserError(t('authority.say.capped', { level: t(`authority.level.${tools.authority().max}`) }));
      return tools.authority();
    },
  });
};
