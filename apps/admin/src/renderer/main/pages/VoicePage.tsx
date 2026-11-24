import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowsClockwise, CheckCircle, Cpu, DownloadSimple, Ear, Key, Play, SpeakerHigh, Trash, Warning, WarningCircle } from '@phosphor-icons/react';
import { ProviderError } from '../components/ProviderError';
import { classifyProviderError } from '../lib/provider-error';
import {
  DEFAULT_ELEVENLABS_VOICE_ID,
  KEY_PROVIDERS,
  TTS_ENGINES,
  TTS_ENGINE_IDS,
  t,
  type TtsEngineId,
  type KeyProvider,
  type KeyStatus,
  type KeyTestResult,
  type LocalModel,
  type Policy,
  type ProviderVoiceInfo,
  type V1ImportPreview,
  type V1ImportResult,
} from '@fuber/shared';
import { Badge, Button, Dialog, IconButton, Input, List, Row, Select, Skeleton, Spinner, Switch, Textarea, Waveform, toast, cn, type SelectOption, type Tone } from '@fuber/ui';
import { useLive } from '../app/live-store';
import { usePolicy, useField } from '../app/policy-store';
import { Block, ErrorPanel, Fields, InlineEmpty, Notice, Page, PanelSkeleton, SettingRow, StatusDot, Steps, SummaryStrip, type DotTone, type StatProps } from '../components/layout';
import { keyReady, roleModelLabel, roleProviderLabel, roleTone, sttLabel, sttTone, ttsLabel, ttsTone } from '../lib/status';
import { ttsEngineEdits } from '../lib/policy-diff';
import { formatBytes, formatDateTime, fromNow } from '../lib/format';
import { errorMessage, useAdminEvent, useResource } from '../lib/ipc';
import type { PageProps } from './types';

export function VoicePage(_: PageProps) {
  const { draft, loading } = usePolicy();
  const ready = !loading && !!draft;
  return (
    <Page
      title={t('admin.voice.title')}
      description={t('admin.voice.description')}
      summary={ready ? <VoiceSummary /> : undefined}
      aside={
        ready ? (
          <>
            <FlowBlock />
            <SampleBlock />
          </>
        ) : (
          <PanelSkeleton rows={3} />
        )
      }
      below={
        ready ? (
          <div className="ad-pair">
            <BehaviorBlock />
            <LocalModelsBlock models={draft.localModels} />
          </div>
        ) : undefined
      }
    >
      {ready ? (
        <>
          <PipelineBlock />
          <KeysBlock />
        </>
      ) : (
        <>
          <PanelSkeleton rows={3} />
          <PanelSkeleton rows={3} />
        </>
      )}
    </Page>
  );
}

// ───────────────────────── Bir bakışta ─────────────────────────

function VoiceSummary() {
  const { draft } = usePolicy();
  const { keys } = useLive();
  if (!draft) return null;
  const list = keys.data ?? [];
  const ready = KEY_PROVIDERS.filter((p) => keyReady(list, p)).length;
  const stt = draft.voice.stt.provider;
  const tts = draft.voice.tts.provider;
  const items: StatProps[] = [
    { label: t('admin.voice.stat.hear'), icon: <Ear />, value: sttLabel(stt), note: stt === 'whisper-local' ? t('admin.voice.stat.onDevice') : t('admin.voice.stat.cloud') },
    { label: t('admin.voice.stat.speak'), icon: <SpeakerHigh />, value: ttsLabel(tts), note: TTS_ENGINES[tts].kind === 'cloud' ? t('admin.voice.stat.cloud') : t('admin.voice.stat.onDevice') },
    {
      label: t('admin.voice.stat.keys'),
      icon: <Key />,
      value: keys.data ? ready : null,
      unit: `/ ${KEY_PROVIDERS.length}`,
      note: t('admin.voice.stat.keysNote'),
      testId: 'stat-keys',
    },
    { label: t('admin.voice.stat.local'), icon: <Cpu />, value: draft.localModels.length, note: t('admin.voice.stat.localNote') },
  ];
  return <SummaryStrip items={items} testId="voice-summary" />;
}

/** Ses hattı akışı: Duyma → Beyin → Konuşma; her adımda çalışabilirlik noktası (anahtar ve motor seçiminden). */
function FlowBlock() {
  const { draft } = usePolicy();
  const { keys } = useLive();
  if (!draft) return null;
  const list = keys.data;
  const stt = draft.voice.stt.provider;
  const tts = draft.voice.tts.provider;
  const voice = draft.models.voice;
  const label = (tone: DotTone) => (tone === 'success' ? t('admin.voice.flow.ready') : t('admin.voice.flow.needsKey'));
  const step = (tone: DotTone) => ({ state: tone === 'success' ? ('done' as const) : ('pending' as const), status: { tone, label: label(tone) } });
  return (
    <Block index={2} title={t('admin.voice.flow.title')} description={t('admin.voice.flow.description')} testId="voice-flow">
      <Steps
        testId="voice-flow-steps"
        items={[
          { title: t('admin.voice.flow.hear'), body: t('admin.voice.flow.hearBody', { engine: sttLabel(stt) }), ...step(sttTone(stt, list)) },
          {
            title: t('admin.voice.flow.think'),
            body: t('admin.voice.flow.thinkBody', { model: roleModelLabel(voice, draft), provider: roleProviderLabel(voice, draft) }),
            ...step(roleTone(voice, draft, list)),
          },
          { title: t('admin.voice.flow.speak'), body: t('admin.voice.flow.speakBody', { engine: ttsLabel(tts) }), ...step(ttsTone(tts, list)) },
        ]}
      />
    </Block>
  );
}

/** Örnek ses: seçili motor ve ses; ElevenLabs'te "Sesi dene" (ses yalnız düğmeyle çalar), yerel motorda cihazda dinlenir. */
function SampleBlock() {
  const [tts] = useField<Policy['voice']['tts']['provider']>(['voice', 'tts', 'provider']);
  const [voiceId] = useField<string | undefined>(['voice', 'tts', 'voiceId']);
  const [model] = useField<string | undefined>(['voice', 'tts', 'model']);
  const eleven = tts === 'elevenlabs';
  const supertonicVoice = tts === 'supertonic' ? TTS_ENGINES.supertonic.voices.find((v) => v.id === (voiceId ?? TTS_ENGINES.supertonic.defaultVoice)) : undefined;
  const voiceName = supertonicVoice ? t(supertonicVoice.label) : eleven ? (voiceId ? t('admin.voice.sample.chosen') : t('admin2.voice.voice.default')) : t('admin.voice.sample.engineVoice');
  return (
    <Block index={3} title={t('admin.voice.sample.title')} description={t('admin.voice.sample.description', { engine: ttsLabel(tts), voice: voiceName })} testId="voice-sample">
      {eleven ? (
        <VoicePreview voiceId={voiceId} model={model} />
      ) : (
        <>
          <SampleWave tone="muted" />
          <p className="text-sm text-fg-muted" data-testid="tts-preview-local">
            {t('tts.admin.previewLocal')}
          </p>
        </>
      )}
    </Block>
  );
}

/** Örnek ses dalgası: sabit bir konuşma zarfı (süs döngüsü yok; çizim yerleşince durur). */
const SAMPLE_LEVELS = Array.from({ length: 44 }, (_, i) => {
  const envelope = Math.sin((i / 43) * Math.PI) ** 0.6;
  const syllable = 0.55 + 0.45 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.45));
  return Math.max(0.08, envelope * syllable);
});

function SampleWave({ tone }: { tone: 'accent' | 'muted' }) {
  return (
    <div className="ad-sample-wave" data-testid="voice-sample-wave">
      <Waveform levels={SAMPLE_LEVELS} bars={44} height={56} tone={tone} label={t('admin.voice.sample.waveLabel')} />
    </div>
  );
}

// ───────────────────────── Ses hattı ─────────────────────────

/** Bilinen ElevenLabs TTS modelleri; politikada başka bir kimlik varsa o da listelenir. */
const ELEVEN_MODELS = ['eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_multilingual_v2', 'eleven_v3'] as const;

function PipelineBlock() {
  const [engine, setEngine] = useField<Policy['voice']['engine']>(['voice', 'engine']);
  const [stt, setStt] = useField<Policy['voice']['stt']['provider']>(['voice', 'stt', 'provider']);
  const [tts] = useField<Policy['voice']['tts']['provider']>(['voice', 'tts', 'provider']);
  const { editMany } = usePolicy();
  const [voiceId, setVoiceId] = useField<string | undefined>(['voice', 'tts', 'voiceId']);
  const [ttsModel, setTtsModel] = useField<string | undefined>(['voice', 'tts', 'model']);
  const elevenSelected = tts === 'elevenlabs';
  const supertonicSelected = tts === 'supertonic';
  const localSelected = TTS_ENGINES[tts].kind !== 'cloud';
  const realtimeSelected = engine === 'openai-realtime';
  // Motor değişince eski motorun ses kimliği ve modeli temizlenir (bkz. `ttsEngineEdits`).
  const changeEngine = (next: TtsEngineId) => next !== tts && editMany(ttsEngineEdits(next));
  const ttsOptions: SelectOption<TtsEngineId>[] = TTS_ENGINE_IDS.map((id) => ({
    value: id,
    label: ttsOptionLabel[id],
    description: ttsOptionHint[id],
  }));

  const engineOptions: SelectOption<Policy['voice']['engine']>[] = [
    { value: 'cascade', label: t('admin.voice.engine.cascade'), description: t('admin.voice.engine.cascadeHint') },
    { value: 'gemini-live', label: t('admin.voice.engine.gemini'), description: t('admin.voice.engine.later'), disabled: true },
    { value: 'openai-realtime', label: t('admin.voice.engine.openai'), description: t('admin.voice.engine.openaiHint') },
  ];

  return (
    <Block index={0} tone="lead" title={t('admin.voice.pipeline.title')} description={t('admin.voice.pipeline.description')}>
      <Fields max={2}>
        <SettingRow label={t('admin.voice.engine.label')} description={t('admin.voice.engine.hint')}>
          <Select aria-label={t('admin.voice.engine.label')} value={engine} onChange={setEngine} options={engineOptions} />
        </SettingRow>
        {/* Sıralı hat alanları (yazıya çevirme, seslendirme) yalnız cascade'te anlamlıdır; gerçek zamanlı motor bunları atlar. */}
        {!realtimeSelected && (
          <>
            <SettingRow label={t('admin.voice.stt.label')} description={t('admin.voice.stt.hint')}>
              <Select
                aria-label={t('admin.voice.stt.label')}
                value={stt}
                onChange={setStt}
                options={[
                  { value: 'whisper-local', label: t('admin.voice.stt.local'), description: t('admin.voice.stt.localHint') },
                  { value: 'elevenlabs-scribe', label: t('admin.voice.stt.scribe'), description: t('admin.voice.stt.scribeHint') },
                ]}
              />
            </SettingRow>
            <SettingRow
              label={t('tts.admin.label')}
              htmlFor="tts-provider-select"
              description={
                <>
                  {t('tts.admin.hint')}
                  {localSelected && <span data-testid="tts-local-note"> {t('tts.admin.localNote')}</span>}
                  {elevenSelected && <span data-testid="tts-fallback-note"> {t('admin2.voice.fallback')}</span>}
                </>
              }
            >
              <Select aria-label={t('tts.admin.label')} value={tts} onChange={changeEngine} options={ttsOptions} id="tts-provider-select" />
            </SettingRow>
            {supertonicSelected && <SupertonicVoiceRow voiceId={voiceId} setVoiceId={setVoiceId} />}
            {elevenSelected && <ElevenVoiceRows voiceId={voiceId} setVoiceId={setVoiceId} model={ttsModel} setModel={setTtsModel} />}
          </>
        )}
        {realtimeSelected && <RealtimeRows />}
      </Fields>
    </Block>
  );
}

/** OpenAI gerçek zamanlı seslerinin listesi (resmi: belgeler marin / cedar önerir). */
const REALTIME_VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'] as const;
/** Bilinen gerçek zamanlı modeller; politikada başka bir kimlik varsa o da listelenir. */
const REALTIME_MODELS = ['gpt-realtime-2.1', 'gpt-realtime-2', 'gpt-realtime'] as const;
const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2.1';
const DEFAULT_REALTIME_VOICE = 'marin';

/** Gerçek zamanlı (OpenAI Realtime) motorun model + ses seçimi ve anahtar uyarısı. */
function RealtimeRows() {
  const [s2s, setS2s] = useField<Policy['voice']['s2s']>(['voice', 's2s']);
  const { keys } = useLive();
  const hasKey = !!keys.data?.find((k) => k.provider === 'openai')?.present;
  const model = s2s?.model?.trim() || DEFAULT_REALTIME_MODEL;
  const voice = s2s?.voice?.trim() || DEFAULT_REALTIME_VOICE;
  const setModel = (next: string) => setS2s({ model: next, voice });
  const setVoice = (next: string) => setS2s({ model, voice: next });
  const modelOptions: SelectOption[] = [
    ...REALTIME_MODELS.map((id) => ({ value: id, label: id })),
    ...(REALTIME_MODELS.includes(model as never) ? [] : [{ value: model, label: model }]),
  ];
  const voiceOptions: SelectOption[] = [
    ...REALTIME_VOICES.map((id) => ({ value: id, label: id })),
    ...(REALTIME_VOICES.includes(voice as never) ? [] : [{ value: voice, label: voice }]),
  ];
  return (
    <>
      <SettingRow label={t('admin.voice.realtime.model')} description={t('admin.voice.realtime.modelHint')}>
        <Select aria-label={t('admin.voice.realtime.model')} value={model} onChange={setModel} options={modelOptions} id="realtime-model-select" />
      </SettingRow>
      <SettingRow label={t('admin.voice.realtime.voice')} description={t('admin.voice.realtime.voiceHint')}>
        <Select aria-label={t('admin.voice.realtime.voice')} value={voice} onChange={setVoice} options={voiceOptions} id="realtime-voice-select" />
      </SettingRow>
      <SettingRow wide label={t('admin.voice.realtime.title')} description={t('admin.voice.realtime.description')}>
        {!hasKey ? (
          <Notice tone="warning" icon={<Key />} testId="realtime-no-key">
            {t('admin.voice.realtime.noKey')}
          </Notice>
        ) : (
          <Notice tone="neutral" icon={<WarningCircle />} testId="realtime-note">
            {t('admin.voice.realtime.note')}
          </Notice>
        )}
      </SettingRow>
    </>
  );
}

const ttsOptionLabel: Record<TtsEngineId, string> = {
  supertonic: t('tts.admin.option.supertonic'),
  'ema-lightning': t('tts.admin.option.ema'),
  'piper-local': t('tts.admin.option.piper'),
  elevenlabs: t('tts.admin.option.eleven'),
};
const ttsOptionHint: Record<TtsEngineId, string> = {
  supertonic: t('tts.admin.option.supertonicHint'),
  'ema-lightning': t('tts.admin.option.emaHint'),
  'piper-local': t('tts.admin.option.piperHint'),
  elevenlabs: t('tts.admin.option.elevenHint'),
};

/** Supertonic 3'ün on sesi: cihazların varsayılan sesi (cihazda Ayarlar › Ses'ten değiştirilebilir). */
function SupertonicVoiceRow({ voiceId, setVoiceId }: { voiceId: string | undefined; setVoiceId: (value: string | undefined) => void }) {
  const options: SelectOption[] = TTS_ENGINES.supertonic.voices.map((voice) => ({ value: voice.id, label: t(voice.label) }));
  return (
    <SettingRow label={t('tts.admin.voice')} description={t('tts.admin.voiceHint')}>
      <Select
        aria-label={t('tts.admin.voice')}
        value={voiceId ?? TTS_ENGINES.supertonic.defaultVoice ?? 'M4'}
        onChange={(v) => setVoiceId(v)}
        options={options}
        id="tts-voice-select"
      />
    </SettingRow>
  );
}

function ElevenVoiceRows({
  voiceId,
  setVoiceId,
  model,
  setModel,
}: {
  voiceId: string | undefined;
  setVoiceId: (value: string | undefined) => void;
  model: string | undefined;
  setModel: (value: string | undefined) => void;
}) {
  const voices = useResource(() => window.fuber.invoke('voices.list'));
  useAdminEvent('keys.changed', ({ provider }) => provider === 'elevenlabs' && void voices.reload());

  const options = useMemo(() => voiceOptions(voices.data ?? [], voiceId), [voices.data, voiceId]);
  const selected = voices.data?.find((v) => v.voiceId === voiceId) ?? null;
  // Varsayılan ses (Daniel) hazır seslerdendir; listede görünmese de "kütüphane sesi" uyarısı verilmez.
  const libraryVoice =
    voiceId !== undefined && voiceId !== DEFAULT_ELEVENLABS_VOICE_ID && !!voices.data && (!selected || selected.category !== 'premade');
  const noKey = !!voices.error && classifyProviderError(voices.error) === 'missing';

  // "Sağlayıcının varsayılanı" her zaman seçilebilir: seçilince alan politikadan kalkar.
  const modelOptions: SelectOption[] = [
    { value: DEFAULT_OPTION, label: t('admin.voice.model.default'), description: ELEVENLABS_DEFAULT_MODEL },
    ...ELEVEN_MODELS.map((id) => ({ value: id, label: t(`admin.voice.model.${id}`), description: id })),
    ...(model && !ELEVEN_MODELS.includes(model as never) ? [{ value: model, label: model }] : []),
  ];

  return (
    <>
      <SettingRow label={t('admin.voice.model.label')} description={t('admin.voice.model.hint')}>
        <Select
          aria-label={t('admin.voice.model.label')}
          value={model ?? DEFAULT_OPTION}
          onChange={(v) => setModel(v === DEFAULT_OPTION ? undefined : v)}
          options={modelOptions}
          id="voice-model-select"
        />
      </SettingRow>
      {/* Ses seçimi; "Sesi dene" bağlam sütunundaki örnek ses kartında (seçilen ses orada dinlenir). */}
      {/* Ses satırı tek başına kaplar ki uyarılar geniş dursun; seçici üstteki alanlarla aynı sütun çizgisinde (ilk sütun). */}
      <SettingRow wide label={t('admin.voice.voice.label')} description={`${t('admin.voice.voice.hint')} ${t('admin.voice.sample.hint')}`}>
        <div className="grid gap-x-7" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(max(260px, calc((100% - 28px) / 2)), 100%), 1fr))' }}>
          {voices.loading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Select
              aria-label={t('admin.voice.voice.label')}
              value={voiceId ?? DEFAULT_OPTION}
              onChange={(v) => setVoiceId(v === DEFAULT_OPTION ? undefined : v)}
              options={options}
              id="voice-select"
            />
          )}
          {/* Listede olmayan ses (hesaba eklenmemiş kütüphane sesi, klonlanmış ses): kimliği elle yazılır. */}
          <ManualVoiceId voiceId={voiceId} setVoiceId={setVoiceId} />
        </div>
        {!voices.loading &&
          voices.error &&
          (noKey ? (
            <Notice tone="neutral" icon={<Key />} testId="voices-unavailable">
              {t('admin.voice.voice.noKey')}
            </Notice>
          ) : (
            <ProviderError message={voices.error} testId="voices-unavailable" />
          ))}
        {libraryVoice && !voices.loading && (
          <p className="flex items-start gap-1.5 text-sm text-warning" data-testid="library-voice-note">
            <Warning aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
            {t('admin.voice.voice.libraryNote')}
          </p>
        )}
      </SettingRow>
    </>
  );
}

/** ElevenLabs ses kimliğini elle yazma kutusu: 20 harf/rakam. Yazılan kimlik geçerliyse taslağa işlenir (Kaydet ile yayınlanır). */
function ManualVoiceId({ voiceId, setVoiceId }: { voiceId: string | undefined; setVoiceId: (value: string | undefined) => void }) {
  const [text, setText] = useState(voiceId ?? '');
  useEffect(() => setText(voiceId ?? ''), [voiceId]);
  const clean = text.trim();
  const valid = /^[A-Za-z0-9]{16,40}$/.test(clean);
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-fg-faint">{t('admin.voice.voice.manual')}</span>
      <Input
        value={text}
        invalid={clean !== '' && !valid}
        placeholder={t('admin.voice.voice.manualPlaceholder')}
        onChange={(e) => {
          setText(e.target.value);
          const next = e.target.value.trim();
          if (/^[A-Za-z0-9]{16,40}$/.test(next) && next !== voiceId) setVoiceId(next);
        }}
        spellCheck={false}
        maxLength={40}
        data-testid="voice-id-manual"
      />
    </label>
  );
}

/** Seçim listelerinde "sağlayıcının varsayılanı": politikada alan yok demektir. */
const DEFAULT_OPTION = '__default__';
/** Masaüstünün ve kontrol servisinin ses seçilmemişken kullandığı model (`packages/control/src/providers.ts`). */
const ELEVENLABS_DEFAULT_MODEL = 'eleven_flash_v2_5';

function voiceOptions(voices: ProviderVoiceInfo[], current: string | undefined): SelectOption[] {
  const premade = voices.filter((v) => v.category === 'premade');
  const other = voices.filter((v) => v.category !== 'premade');
  const out: SelectOption[] = [
    { value: DEFAULT_OPTION, label: t('admin2.voice.voice.default'), description: t('admin2.voice.voice.defaultHint') },
    ...premade.map((v) => ({ value: v.voiceId, label: v.name, description: t('admin.voice.voice.premade') })),
    ...other.map((v) => ({ value: v.voiceId, label: v.name, description: t('admin.voice.voice.library', { category: v.category ?? '–' }) })),
  ];
  if (current === DEFAULT_ELEVENLABS_VOICE_ID && !voices.some((v) => v.voiceId === current)) {
    // Liste gelmemişken (anahtar yok, ağ yok) varsayılan ses adıyla görünür.
    out.splice(1, 0, { value: current, label: 'Daniel', description: t('admin.voice.voice.premade') });
  } else if (current && !voices.some((v) => v.voiceId === current)) {
    out.splice(1, 0, { value: current, label: t('admin.voice.voice.unlisted', { id: current.slice(0, 8) }), description: t('admin.voice.voice.unlistedHint') });
  }
  return out;
}

/** Örnek ses kartının "Sesi dene"si: dalga, düğme ve sonucu. Ses yalnız düğmeye basılınca çalar; anahtar yoksa düğme kapalıdır. */
function VoicePreview({ voiceId, model }: { voiceId: string | undefined; model: string | undefined }) {
  const name = useField<string>(['persona', 'name'])[0];
  const hasKey = !!useLive().keys.data?.find((k) => k.provider === 'elevenlabs')?.present;
  const [state, setState] = useState<{ busy: boolean; result: { ok: boolean; message: string } | null }>({ busy: false, result: null });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audioRef.current?.pause(), []);
  // Ses değişince eski sonuç yanıltır.
  useEffect(() => setState({ busy: false, result: null }), [voiceId, model]);

  const preview = async () => {
    setState({ busy: true, result: null });
    try {
      const res = await window.fuber.invoke('voice.preview', {
        text: t('admin.voice.preview.sample', { name }),
        provider: 'elevenlabs',
        voiceId,
        model,
      });
      if (res.ok && res.audioBase64 && res.mimeType) {
        audioRef.current?.pause();
        const audio = new Audio(`data:${res.mimeType};base64,${res.audioBase64}`);
        audioRef.current = audio;
        void audio.play().catch(() => {});
      }
      setState({ busy: false, result: { ok: res.ok, message: res.message } });
    } catch (reason) {
      setState({ busy: false, result: { ok: false, message: errorMessage(reason) } });
    }
  };

  return (
    <>
      <SampleWave tone={state.result?.ok ? 'accent' : 'muted'} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-fg-faint">{hasKey ? t('admin.voice.sample.ready') : t('admin.voice.preview.needKey')}</p>
        <Button variant="primary" icon={<Play weight="fill" />} loading={state.busy} disabled={!hasKey} onClick={() => void preview()} title={hasKey ? undefined : t('admin.voice.preview.needKey')} data-testid="voice-preview">
          {t('admin.voice.preview.button')}
        </Button>
      </div>
      {state.result &&
        (state.result.ok ? (
          <Notice tone="success" icon={<CheckCircle weight="fill" />} testId="voice-preview-result">
            {t('admin.voice.preview.played')}
          </Notice>
        ) : (
          <ProviderError message={state.result.message} testId="voice-preview-result" />
        ))}
    </>
  );
}

// ───────────────────────── Konuşma davranışı ─────────────────────────

function BehaviorBlock() {
  const [bargeIn, setBargeIn] = useField<Policy['voice']['bargeIn']>(['voice', 'bargeIn']);
  const [followUp, setFollowUp, followUpError] = useField<number>(['voice', 'followUpSeconds']);
  const [conversation, setConversation] = useField<boolean>(['voice', 'conversationMode']);
  const [style, setStyle] = useField<string>(['persona', 'voiceStyle']);
  return (
    <Block index={3} title={t('admin.voice.behavior.title')} description={t('admin.voice.behavior.description')}>
      <Fields>
        <SettingRow label={t('admin.voice.bargeIn.label')} description={t('admin.voice.bargeIn.hint')}>
          <Select
            aria-label={t('admin.voice.bargeIn.label')}
            value={bargeIn}
            onChange={setBargeIn}
            options={[
              { value: 'voice', label: t('admin.voice.bargeIn.voice'), description: t('admin.voice.bargeIn.voiceHint') },
              { value: 'wake', label: t('admin.voice.bargeIn.wake'), description: t('admin.voice.bargeIn.wakeHint') },
              { value: 'off', label: t('admin.voice.bargeIn.off'), description: t('admin.voice.bargeIn.offHint') },
            ]}
          />
        </SettingRow>
        <SettingRow label={t('admin.voice.followUp.label')} description={t('admin.voice.followUp.hint')} htmlFor="voice-followup" error={followUpError}>
          <NumberInput id="voice-followup" value={followUp} onChange={setFollowUp} unit={t('admin.common.seconds')} min={0} max={120} invalid={!!followUpError} />
        </SettingRow>
        <SettingRow inline label={t('admin.voice.conversation.label')} description={t('admin.voice.conversation.hint')}>
          <Switch checked={conversation} onCheckedChange={setConversation} aria-label={t('admin.voice.conversation.label')} />
        </SettingRow>
        <SettingRow label={t('admin.voice.style.label')} description={t('admin.voice.style.hint')} htmlFor="voice-style">
          <Textarea id="voice-style" value={style} onChange={(e) => setStyle(e.target.value)} minRows={2} maxRows={5} />
        </SettingRow>
      </Fields>
    </Block>
  );
}

/** Sayı alanı: boşaltılınca NaN tutar (doğrulama yakalar), yazarken imleç zıplamaz. */
export function NumberInput({
  id,
  value,
  onChange,
  unit,
  min,
  max,
  step,
  invalid,
  testId,
}: {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  invalid?: boolean;
  testId?: string;
}) {
  return (
    <div className="w-full max-w-44">
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? String(value) : ''}
        min={min}
        max={max}
        step={step}
        invalid={invalid}
        trailing={unit && <span className="text-sm">{unit}</span>}
        onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
        data-testid={testId}
      />
    </div>
  );
}

// ───────────────────────── Anahtarlar ─────────────────────────

function KeysBlock() {
  const { keys, service } = useLive();
  const [importOpen, setImportOpen] = useState(false);
  const encryption = service.data?.encryptionAvailable !== false;
  return (
    <Block
      index={1}
      id="keys"
      title={t('admin.keys.title')}
      description={t('admin.keys.description')}
      action={
        <Button size="sm" icon={<DownloadSimple />} onClick={() => setImportOpen(true)} disabled={!encryption} data-testid="v1-import-open">
          {t('admin.keys.import.button')}
        </Button>
      }
    >
      {!encryption && (
        <Notice tone="danger" icon={<WarningCircle weight="fill" />} title={t('admin.keys.noEncryptionTitle')}>
          {t('admin.keys.noEncryptionBody')}
        </Notice>
      )}
      {keys.error ? (
        <ErrorPanel message={keys.error} onRetry={() => void keys.reload()} />
      ) : (
        <div className="ad-keys">
          {KEY_PROVIDERS.map((provider) => (
            <KeyCard key={provider} provider={provider} status={keys.data?.find((k) => k.provider === provider) ?? null} loading={keys.loading} canWrite={encryption} />
          ))}
        </div>
      )}
      <V1ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </Block>
  );
}

/** Anahtar satırının simgesi: sağlayıcının baş harfi (özel uç için nokta). */
const PROVIDER_ICON_TONE: Record<KeyProvider, string> = {
  anthropic: 'A',
  elevenlabs: 'E',
  gemini: 'G',
  openai: 'O',
  openrouter: 'R',
  moonshot: 'K',
  custom: '·',
};

export function keyState(status: KeyStatus | null): KeyState {
  if (!status || !status.present) return { tone: 'neutral', label: t('admin.keys.state.missing'), kind: 'missing' };
  const test = status.lastTest;
  if (!test) return { tone: 'neutral', label: t('admin.keys.state.untested'), kind: 'untested' };
  return testState(test);
}

interface KeyState {
  tone: Tone;
  label: string;
  /** Rozetin ve sınamanın okuduğu ayrıntılı durum. */
  kind: 'missing' | 'untested' | 'valid' | 'recognized' | 'invalid' | 'plan' | 'quota' | 'credit' | 'unreachable';
}

/**
 * Anthropic'te `/v1/models` 200 dönse de hesapta kredi olmayabilir; servis bunu 1 token'lık istekle ayırır.
 * Ayıramadıysa sonuç "geçerli" değil "anahtar tanındı"dır (`packages/control/src/providers.ts`).
 */
function testState(test: KeyTestResult): KeyState {
  switch (test.status) {
    case 'valid':
      if (test.provider === 'anthropic' && /tanındı/i.test(test.message)) {
        return { tone: 'accent', label: t('admin2.keys.state.recognized'), kind: 'recognized' };
      }
      return { tone: 'success', label: t('admin.keys.state.valid'), kind: 'valid' };
    // Sözleşmedeki ince durumlar: servis bunları doğrudan gönderirse iletiyi ayrıştırmaya gerek kalmaz.
    case 'recognized':
      return { tone: 'accent', label: t('admin2.keys.state.recognized'), kind: 'recognized' };
    case 'no_credit':
      return { tone: 'warning', label: t('admin2.keys.state.noCredit'), kind: 'credit' };
    case 'quota_exceeded':
      return { tone: 'warning', label: t('admin2.keys.state.quota'), kind: 'quota' };
    case 'invalid':
      return { tone: 'danger', label: t('admin.keys.state.invalid'), kind: 'invalid' };
    case 'insufficient_plan': {
      const kind = classifyProviderError(test.message, test.httpStatus);
      if (kind === 'credit') return { tone: 'warning', label: t('admin2.keys.state.noCredit'), kind: 'credit' };
      if (kind === 'quota') return { tone: 'warning', label: t('admin2.keys.state.quota'), kind: 'quota' };
      return { tone: 'warning', label: t('admin.keys.state.plan'), kind: 'plan' };
    }
    case 'unreachable':
      return { tone: 'warning', label: t('admin.keys.state.unreachable'), kind: 'unreachable' };
    default:
      return { tone: 'neutral', label: t('admin.keys.state.missing'), kind: 'missing' };
  }
}

/** "Sonuç" satırı: başarılı sınamanın sade özeti (hata ayrıca `ProviderError` ile anlatılır). */
function resultText(state: KeyState, test: KeyTestResult): string {
  if (state.kind === 'recognized') return `${t('admin2.keys.state.recognized')}. ${t('admin2.keys.creditNote')}`;
  if (state.kind === 'valid') return test.provider === 'anthropic' ? t('admin2.keys.result.validCredit') : t('admin2.keys.result.valid');
  return state.label;
}

function KeyCard({ provider, status, loading, canWrite }: { provider: KeyProvider; status: KeyStatus | null; loading: boolean; canWrite: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const state = keyState(status);
  const present = !!status?.present;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = async () => {
    const secret = value.trim();
    if (!secret) return;
    setBusy('save');
    setError(null);
    try {
      await window.fuber.invoke('keys.set', { provider, value: secret });
      // Değer bellekte tutulmaz: kasaya yazıldıktan hemen sonra alan boşalır.
      setValue('');
      setEditing(false);
      setBusy('test');
      await window.fuber.invoke('keys.test', { provider });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    setError(null);
    try {
      await window.fuber.invoke('keys.test', { provider });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    try {
      await window.fuber.invoke('keys.delete', { provider });
      setConfirmDelete(false);
      toast.success(t('admin.keys.deleted', { provider: t(`admin.keys.provider.${provider}`) }));
    } catch (reason) {
      toast.error(t('admin.keys.deleteFailed'), { description: errorMessage(reason) });
    } finally {
      setBusy(null);
    }
  };

  const test0 = status?.lastTest ?? null;

  return (
    <div className="ad-key" data-testid={`key-card-${provider}`}>
      <div className="flex min-w-0 items-start gap-3.5">
        <span aria-hidden className="ad-icon ad-key-mark" data-size="44" data-present={present || undefined} data-testid={`key-icon-${provider}`}>
          {PROVIDER_ICON_TONE[provider]}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="ad-key-name">{t(`admin.keys.provider.${provider}`)}</h3>
          {loading ? (
            <Skeleton className="h-4 w-24 rounded-full" />
          ) : (
            <StatusDot tone={busy === 'test' ? 'accent' : (state.tone as DotTone)} testId={`key-status-${provider}`} data-status={test0?.status ?? (present ? 'untested' : 'missing')}>
              {busy === 'test' ? t('admin.keys.testing') : state.label}
            </StatusDot>
          )}
          <p className="text-sm text-fg-faint">{t(`admin.keys.use.${provider}`)}</p>
        </div>
      </div>

      <div className="ad-key-state">
        {/* Anahtar yokken rozet yeter; varken kasadaki son dört hane, son sınama ve sonucu yazar. */}
        {!editing && !loading && present && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm" data-testid={`key-facts-${provider}`}>
            <dt className="text-fg-faint">{t('admin2.keys.inVault')}</dt>
            <dd className="text-fg-muted">
              {t('admin2.keys.inVaultYes')}
              <span className="ml-2 font-mono text-fg" data-testid={`key-hint-${provider}`}>
                {status?.hint}
              </span>
            </dd>
            <dt className="text-fg-faint">{t('admin.keys.lastTest')}</dt>
            <dd className="text-fg-muted" title={test0 ? formatDateTime(test0.at) : undefined}>
              {test0 ? t('admin.keys.lastTestValue', { when: fromNow(test0.at), ms: test0.latencyMs }) : t('admin.keys.neverTested')}
            </dd>
            <dt className="text-fg-faint">{t('admin2.keys.result')}</dt>
            <dd className={cn('min-w-0', test0?.ok ? 'text-fg' : 'text-fg-muted')} data-testid={`key-result-${provider}`} data-kind={state.kind}>
              {test0 ? resultText(state, test0) : t('admin2.keys.resultNone')}
            </dd>
          </dl>
        )}
      </div>

      {!editing && (
        <div className="ad-key-actions">
          {present && <IconButton size="sm" icon={<Trash />} label={t('admin.keys.delete')} onClick={() => setConfirmDelete(true)} disabled={busy !== null} />}
          {present && (
            <Button size="sm" variant="ghost" icon={<ArrowsClockwise />} loading={busy === 'test'} onClick={() => void test()} data-testid={`key-test-${provider}`}>
              {t('admin.keys.test')}
            </Button>
          )}
          <Button size="sm" icon={<Key />} onClick={() => setEditing(true)} disabled={!canWrite || busy !== null} data-testid={`key-edit-${provider}`}>
            {present ? t('admin.keys.replace') : t('admin.keys.add')}
          </Button>
        </div>
      )}

      {test0 && !test0.ok && !editing && (
        <div className="ad-key-wide" data-testid={`key-message-${provider}`}>
          <ProviderError message={test0.message} httpStatus={test0.httpStatus} />
        </div>
      )}

      {editing && (
        <form
          className="ad-key-wide flex max-w-[560px] flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Input
            ref={inputRef}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('admin.keys.pastePlaceholder')}
            aria-label={t('admin.keys.pasteLabel', { provider: t(`admin.keys.provider.${provider}`) })}
            className="font-mono text-sm"
            data-testid={`key-input-${provider}`}
          />
          <p className="text-xs text-fg-faint">{t('admin.keys.neverShown')}</p>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" size="sm" loading={busy === 'save'} disabled={!value.trim()} data-testid={`key-save-${provider}`}>
              {t('admin.keys.saveAndTest')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setValue('');
                setEditing(false);
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}

      {error &&
        // Kasanın kendi Türkçe iletisi ("Anahtar çok kısa.") olduğu gibi; sağlayıcı yanıtı sade anlatılır.
        (classifyProviderError(error) === 'unknown' ? (
          <p role="alert" className="ad-key-wide text-sm text-danger" data-selectable>
            {error}
          </p>
        ) : (
          <div className="ad-key-wide">
            <ProviderError message={error} />
          </div>
        ))}


      <Dialog
        open={confirmDelete}
        onOpenChange={(open) => !open && busy !== 'delete' && setConfirmDelete(false)}
        role="alertdialog"
        size="sm"
        title={t('admin.keys.deleteTitle', { provider: t(`admin.keys.provider.${provider}`) })}
        description={t('admin.keys.deleteBody')}
        initialFocusRef={cancelRef}
        footer={
          <>
            <Button ref={cancelRef} variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={busy === 'delete'} onClick={() => void remove()}>
              {t('admin.keys.delete')}
            </Button>
          </>
        }
      />
    </div>
  );
}

function V1ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [preview, setPreview] = useState<V1ImportPreview | null>(null);
  const [result, setResult] = useState<V1ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setResult(null);
    setError(null);
    let alive = true;
    window.fuber.invoke('keys.previewV1Import').then(
      (value) => alive && setPreview(value),
      (reason: unknown) => alive && setError(errorMessage(reason)),
    );
    return () => {
      alive = false;
    };
  }, [open]);

  const run = async () => {
    setBusy(true);
    try {
      setResult(await window.fuber.invoke('keys.importV1'));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const canImport = !!preview?.found && preview.providers.length > 0 && !result;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !busy && onOpenChange(next)}
      title={t('admin.keys.import.title')}
      description={t('admin.keys.import.description')}
      footer={
        result ? (
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            {t('common.done')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} disabled={!canImport} onClick={() => void run()} data-testid="v1-import-confirm">
              {t('admin.keys.import.confirm')}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4" data-testid="v1-import-body">
        {error ? (
          <Notice tone="danger" icon={<WarningCircle weight="fill" />}>
            {error}
          </Notice>
        ) : !preview ? (
          <div className="flex items-center gap-3 text-sm text-fg-muted">
            <Spinner size={16} label={null} />
            {t('admin.keys.import.scanning')}
          </div>
        ) : result ? (
          <>
            <p className="text-base text-fg" title={result.message}>
              {t('admin.keys.import.done', { count: result.imported.length })}
            </p>
            <List divided>
              {result.tests.map((test, index) => {
                const s = testState(test);
                return (
                  <Row
                    key={test.provider}
                    index={index}
                    density="compact"
                    title={t(`admin.keys.provider.${test.provider}`)}
                    subtitle={test.ok ? undefined : t(`admin2.err.${classifyProviderError(test.message, test.httpStatus)}.body`)}
                    trailing={
                      <Badge tone={s.tone} dot>
                        {s.label}
                      </Badge>
                    }
                  />
                );
              })}
            </List>
          </>
        ) : (
          <>
            <p className="text-base text-fg">{preview.message}</p>
            {preview.providers.length > 0 && (
              <List divided>
                {preview.providers.map((provider, index) => (
                  <Row
                    key={provider}
                    index={index}
                    density="compact"
                    title={t(`admin.keys.provider.${provider}`)}
                    trailing={
                      preview.overwrites.includes(provider) ? (
                        <Badge tone="warning">{t('admin.keys.import.overwrite')}</Badge>
                      ) : (
                        <Badge tone="neutral">{t('admin.keys.import.new')}</Badge>
                      )
                    }
                  />
                ))}
              </List>
            )}
            {preview.usedBackup && <p className="text-sm text-fg-faint">{t('admin.keys.import.backup')}</p>}
            <p className="text-sm text-fg-faint">{t('admin.keys.import.readOnly')}</p>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ───────────────────────── Yerel modeller ─────────────────────────

function LocalModelsBlock({ models }: { models: LocalModel[] }) {
  return (
    <Block index={4} id="local-models" title={t('admin.voice.local.title')} description={t('admin.voice.local.description')} count={models.length}>
      {models.length === 0 ? (
        <InlineEmpty icon={<Cpu />} title={t('admin.voice.local.emptyTitle')}>
          {t('admin.voice.local.emptyBody')}
        </InlineEmpty>
      ) : (
        <ul className="ad-locals">
          {models.map((model) => (
            <li key={model.id}>
              <span className="min-w-0 truncate font-mono text-sm text-fg" title={model.id} data-selectable>
                {model.id}
              </span>
              <span className="text-sm text-fg-muted">
                {t(`admin.voice.local.role.${model.role}`)}
                {!model.required && <span className="text-fg-faint"> ({t('admin.voice.local.optional').toLocaleLowerCase('tr')})</span>}
              </span>
              <span className="text-right text-sm text-fg-muted tabular-nums">{formatBytes(model.files.reduce((sum, file) => sum + file.bytes, 0))}</span>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}
