// Öz-durumun seslendirme kısmı: "sesim nerede üretiliyor" sorusunun yanıtı motorun GERÇEKTE çalıştığı yerden gelir.
// Ölçüt: Jarvis "sesim bu bilgisayarın ekran kartında üretiliyor" diyebilmeli ve bu DOĞRU olmalı.
import { describe, expect, it } from 'vitest';
import type { VoiceDiagnosticsReport, VoiceStatus } from '@fuber/shared';
import { readVoiceState } from '../../modules/voice-control/index';
import { correctSelfClaim, describeSelf, renderSelfBlock, selfHints, type SelfState, type SelfVoiceState } from './self';

const voice = (tts: SelfVoiceState['tts']): SelfVoiceState => ({
  ready: true,
  stt: { provider: 'whisper-local', gpu: true },
  tts,
  micMuted: false,
  quiet: false,
  bargeIn: 'voice',
  wakePaused: false,
  conversation: false,
});

const state = (tts: SelfVoiceState['tts'], patch: Partial<SelfState> = {}): SelfState => ({
  appName: 'Fuber AI 2',
  appVersion: '2.0.0-demo.3',
  brain: { provider: 'local', reason: 'no_key', cause: null, model: 'qwen3.5-4b-q4km', deep: { ok: false, reason: null } },
  voice: voice(tts),
  admin: 'approved',
  hotkeys: { talk: 'Ctrl+Alt+J', mute: 'Ctrl+Alt+K' },
  capabilities: [],
  ...patch,
});

const GPU = { provider: 'supertonic', active: 'supertonic', device: 'cuda', fallbackReason: null } as const;

describe('öz-durum: ses nerede üretiliyor', () => {
  it('Supertonic 3 CUDA ile konuşuyorken: ekran kartında üretildiği, motor adıyla söylenir; özet "tamamen yerelde"', () => {
    const block = renderSelfBlock(state(GPU));
    expect(block).toContain('SESİN: BU BİLGİSAYARIN EKRAN KARTINDA üretiliyor (Supertonic 3, CUDA); bulut kullanılmıyor.');
    expect(block).toContain('Özet: şu an TAMAMEN bu bilgisayarda çalışıyorsun');
    expect(block).not.toContain('ElevenLabs');
    expect(describeSelf(state(GPU))).toContain('EKRAN KARTINDA üretiliyor (Supertonic 3, CUDA)');
  });

  it('DirectML de ekran kartıdır; EMA Lightning adıyla söylenir', () => {
    const dml = renderSelfBlock(state({ provider: 'supertonic', active: 'supertonic', device: 'directml', fallbackReason: null }));
    expect(dml).toContain('BU BİLGİSAYARIN EKRAN KARTINDA üretiliyor (Supertonic 3, DirectML)');
    const ema = renderSelfBlock(state({ provider: 'ema-lightning', active: 'ema-lightning', device: 'cuda', fallbackReason: null }));
    expect(ema).toContain('EKRAN KARTINDA üretiliyor (EMA Lightning, CUDA)');
    const emaCpu = renderSelfBlock(state({ provider: 'ema-lightning', active: 'ema-lightning', device: 'cpu', fallbackReason: null }));
    expect(emaCpu).toContain('İŞLEMCİSİNDE üretiliyor (EMA Lightning); ekran kartında DEĞİL');
  });

  it('ekran kartı sesi seçili ama Piper konuşuyorsa: işlemcide üretildiği ve nedeni söylenir, "ekran kartında" denmez', () => {
    const block = renderSelfBlock(state({ provider: 'supertonic', active: 'piper-local', device: 'cpu', fallbackReason: 'gpu_failed' }));
    expect(block).toContain('SESİN: şu an bu bilgisayarın İŞLEMCİSİNDE üretiliyor (Piper); ekran kartında DEĞİL; seçili ses Supertonic 3 (ekran kartı) ama ekran kartında başlatılamadı.');
    const starting = renderSelfBlock(state({ provider: 'supertonic', active: 'piper-local', device: 'cpu', fallbackReason: 'gpu_starting' }));
    expect(starting).toContain('ekran kartına hâlâ yükleniyor');
    // Yine de her şey bu bilgisayarda: özet doğru kalır.
    expect(block).toContain('TAMAMEN bu bilgisayarda');
  });

  it('bulut seçili, kota doldu, yerel yedek ekran kartı sesi: ikisi de söylenir', () => {
    const block = renderSelfBlock(state({ provider: 'elevenlabs', active: 'supertonic', device: 'cuda', fallbackReason: 'quota' }));
    expect(block).toContain('SESİN: şu an BU BİLGİSAYARIN EKRAN KARTINDA üretiliyor (Supertonic 3, CUDA); seçili ses ElevenLabs bulutu ama ElevenLabs kotası doldu.');
  });

  it('cihaz bilinmiyorsa yer uydurulmaz: yalnız "bu bilgisayarda"', () => {
    const block = renderSelfBlock(state({ provider: 'piper-local', active: 'piper-local', fallbackReason: null }));
    expect(block).toContain('SESİN: bu bilgisayarda üretiliyor (yerel ses motoru); bulut kullanılmıyor.');
    expect(block).not.toContain('EKRAN KARTINDA üretiliyor');
  });

  it('"sesin nerede üretiliyor" sorusunda ilgili satır sorunun yanına konur', () => {
    const hints = selfHints(state(GPU), 'Sesin nerede üretiliyor, ekran kartında mı?');
    expect(hints.some((hint) => hint.includes('EKRAN KARTINDA üretiliyor (Supertonic 3, CUDA)'))).toBe(true);
  });
});

describe('öz-durum: yanlış iddianın düzeltilmesi (ses)', () => {
  it('ses ekran kartında üretilirken "ekran kartında üretiliyor" DOĞRUDUR: düzeltilmez', () => {
    for (const fine of ['Sesim bu bilgisayarın ekran kartında üretiliyor.', 'Evet efendim, sesim ekran kartınızda, Supertonic ile üretiliyor.', 'Tamamen yerelde çalışıyorum.']) {
      expect(correctSelfClaim(state(GPU), fine), fine).toBeNull();
    }
  });

  it('ses ekran kartında üretilirken "ElevenLabs / buluttan geliyor" yanlıştır: düzeltilir', () => {
    expect(correctSelfClaim(state(GPU), 'Sesim ElevenLabs bulutundan geliyor.')).toBe('Sesim buluttan gelmiyor; bu bilgisayarın ekran kartında üretiliyor.');
    expect(correctSelfClaim(state(GPU), 'Sesim buluttan gelmiyor, ekran kartında üretiliyor.')).toBeNull();
  });

  it('Piper konuşurken (işlemci) "sesim ekran kartında üretiliyor" yanlıştır: düzeltilir', () => {
    const piper = state({ provider: 'supertonic', active: 'piper-local', device: 'cpu', fallbackReason: 'gpu_failed' });
    expect(correctSelfClaim(piper, 'Sesim bu bilgisayarın ekran kartında üretiliyor.')).toBe('Sesim şu an ekran kartında değil, bu bilgisayarın işlemcisinde üretiliyor (Piper).');
    expect(correctSelfClaim(piper, 'Sesim şu an işlemcide üretiliyor, ekran kartında değil.')).toBeNull();
    expect(correctSelfClaim(piper, 'Sesim bu bilgisayarda üretiliyor.')).toBeNull();
  });

  it('ses buluttan gelirken "ekran kartında üretiliyor" yine düzeltilir (demo.1 kusuru)', () => {
    const cloud = state({ provider: 'elevenlabs', active: 'elevenlabs', device: 'cloud', fallbackReason: null });
    expect(correctSelfClaim(cloud, 'Sesim ekran kartında üretiliyor.')).toBe('Sesim ElevenLabs bulutundan geliyor; bu bilgisayarda üretilmiyor.');
  });
});

describe('öz-durum: ses tanıdan okunur (ses denetimi modülü)', () => {
  const status = { ready: true, micMuted: false, quiet: false, wakePausedUntil: null, conversation: false } as unknown as VoiceStatus;
  const service = (tts: Partial<VoiceDiagnosticsReport['engines']['tts']>) =>
    ({
      status: () => status,
      diagnosticsReport: () =>
        ({
          engines: { stt: { id: 'whisper-local', state: 'ready', gpu: true, reason: null }, tts: { provider: 'supertonic', active: 'supertonic', local: true, voiceId: null, model: null, hasKey: false, fallback: null, charsBilled: 0, ...tts } },
          bargeIn: { policy: 'voice', effective: 'voice', echo: null },
        }) as unknown as VoiceDiagnosticsReport,
    }) as never;

  it('etkin motor ve cihaz olduğu gibi aktarılır', () => {
    expect(readVoiceState(service({ device: 'cuda' }), 'whisper-local')?.tts).toEqual({ provider: 'supertonic', active: 'supertonic', device: 'cuda', fallbackReason: null });
  });

  it('konak açılamadıysa ya da hâlâ yükleniyorsa neden kodu verilir', () => {
    const host = { engine: 'supertonic' as const, device: null, reason: 'cuda: x', attempts: [], loadMs: null, warmMs: null, restarts: 0 };
    expect(readVoiceState(service({ active: 'piper-local', device: 'cpu', host: { ...host, phase: 'failed' } }), 'whisper-local')?.tts).toEqual({
      provider: 'supertonic',
      active: 'piper-local',
      device: 'cpu',
      fallbackReason: 'gpu_failed',
    });
    expect(readVoiceState(service({ active: 'piper-local', device: 'cpu', host: { ...host, phase: 'starting' } }), 'whisper-local')?.tts.fallbackReason).toBe('gpu_starting');
  });
});
