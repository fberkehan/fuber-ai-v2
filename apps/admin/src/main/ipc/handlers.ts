/**
 * `AdminApi` kanallarının işleyicileri. Her biri süreç içindeki kontrol servisinin yönetim cephesini
 * çağırır (HTTP'ye gitmez: port dolu olsa bile yönetim çalışır). Anahtar değerleri arayüze asla dönmez.
 */

import { BrowserWindow, shell } from 'electron';
import { ControlServiceError, ProviderRequestError } from '@fuber/control';
import {
  t,
  UserError,
  type AdminApi,
  type AdminSettings,
  type AppInfo,
  type ClaudeCodeInfo,
  type ControlServiceStatus,
} from '@fuber/shared';
import type { ControlHost } from '../control-host';
import { importKeysFromV1, previewV1Import } from '../key-import';
import type { Handler, IpcRouter } from './router';

export interface HandlerDeps {
  host: ControlHost;
  appInfo(): AppInfo;
  /** v1 veri klasörü; bulunamıyorsa `null`. */
  v1DataDir(): string | null;
  /** `close` ana pencereyi gizler (tepside yaşar). */
  hideWindow(win: BrowserWindow): void;
  restartService(): Promise<ControlServiceStatus>;
  /** Bu bilgisayardaki Claude Code CLI'nin durumu (kurulu, sürüm, oturum). */
  claudeCode(): Promise<ClaudeCodeInfo>;
  settings: {
    get(): AdminSettings;
    /** Saklar ve (yalnız paketli uygulamada) Windows açılış kaydını uygular. */
    update(patch: Partial<Pick<AdminSettings, 'openAtLogin'>>): AdminSettings;
  };
}

/** Servis hatalarını arayüzde gösterilebilir Türkçe hataya çevirir. */
function guard<K extends keyof AdminApi>(handler: Handler<K>): Handler<K> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ControlServiceError || error instanceof ProviderRequestError) {
        throw new UserError(error.message);
      }
      throw error;
    }
  };
}

export function registerHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const admin = () => deps.host.admin();

  const handlers: { [K in keyof AdminApi]: Handler<K> } = {
    'app.info': () => deps.appInfo(),
    'app.window': ({ action }, { window }) => {
      if (window && !window.isDestroyed()) {
        if (action === 'minimize') window.minimize();
        else if (action === 'toggleMaximize') {
          if (window.isMaximized()) window.unmaximize();
          else window.maximize();
        } else deps.hideWindow(window);
      }
      return { maximized: !!window && !window.isDestroyed() && window.isMaximized() };
    },
    'app.openExternal': async ({ url }) => {
      if (!/^https?:\/\//i.test(url)) throw new UserError(t('admin.main.openExternal.invalid'));
      await shell.openExternal(url);
      return { ok: true };
    },

    'settings.get': () => deps.settings.get(),
    'settings.update': ({ patch }) => {
      if (patch.openAtLogin !== undefined && typeof patch.openAtLogin !== 'boolean') {
        throw new UserError(t('common.unknownError'));
      }
      return deps.settings.update({ openAtLogin: patch.openAtLogin });
    },

    'service.status': () => deps.host.status(),
    'service.restart': () => deps.restartService(),

    'policy.get': () => admin().getPolicy(),
    'policy.update': (request) => admin().updatePolicy(request),
    'policy.history': ({ limit }) => admin().policyHistory(limit),
    'policy.rollback': ({ revision }) => admin().rollbackPolicy(revision),
    'policy.setKillSwitch': ({ active, message }) => admin().setKillSwitch(active, message),

    'devices.list': () => admin().listDevices(),
    'devices.approve': ({ id }) => admin().approveDevice(id),
    'devices.revoke': ({ id }) => admin().revokeDevice(id),
    'devices.delete': async ({ id }) => {
      await admin().deleteDevice(id);
      return { ok: true };
    },

    'keys.list': () => admin().listKeys(),
    'keys.set': ({ provider, value }) => admin().setKey(provider, value),
    'keys.delete': ({ provider }) => admin().deleteKey(provider),
    'keys.test': ({ provider, value }) => admin().testKey(provider, value),
    'keys.previewV1Import': () => previewV1Import(admin(), deps.v1DataDir()),
    'keys.importV1': () => importKeysFromV1(admin(), deps.v1DataDir()),

    'models.list': () => admin().listModels(),
    'voices.list': () => admin().listVoices(),
    'providers.models': ({ endpointId, baseUrl, preset, keyId }) =>
      admin().listCloudModels(endpointId, { ...(baseUrl ? { baseUrl } : {}), ...(preset ? { preset } : {}), ...(keyId ? { keyId } : {}) }),
    'deep.claudeCode': () => deps.claudeCode(),

    'usage.summary': ({ days }) => admin().usageSummary(days),
    'audit.list': ({ limit, before }) => admin().listAudit(limit, before),

    'voice.preview': async ({ text, voiceId, model }) => {
      const result = await admin()
        .previewVoice({ text, voiceId, model })
        .catch((error: unknown) => {
          // Anahtar yoksa "Dene" düğmesi hata penceresi yerine sonucu satır içinde gösterir.
          if (error instanceof ControlServiceError && error.code === 'not_found') {
            return { ok: false, message: error.message, httpStatus: null, audio: null, mimeType: null };
          }
          throw error;
        });
      // HTTP durumu iletide durur: arayüz hatayı ona göre sade anlatır (402 plan, 401 anahtar, 429 kota).
      const status = result.httpStatus === null ? '' : ` (${result.httpStatus})`;
      return {
        ok: result.ok,
        message: result.ok ? result.message : `ElevenLabs${status}: ${result.message}`,
        audioBase64: result.audio ? result.audio.toString('base64') : null,
        mimeType: result.mimeType,
      };
    },
  };

  for (const channel of Object.keys(handlers) as Array<keyof AdminApi>) {
    router.handle(channel, guard(handlers[channel] as Handler<typeof channel>) as never);
  }
}
