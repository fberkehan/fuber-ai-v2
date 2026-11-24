// JARVIS MODE: tam ekran holografik HUD. Normalde GÖRÜNMEZDİR: rayda düğmesi, menü öğesi ya da kısayol ipucu yoktur (sayfa
// `hidden`). Kullanıcı konuşurken "Jarvis moduna geç" der, `jarvis_mode` aracı `jarvis.mode` olayını yollar, kabuk sayfayı açar
// ve HUD iris açılışıyla gelir; "Jarvis modunu kapat" der, HUD iris kapanışıyla gider (Esc de aynı çıkıştır).
// Veri ana süreçteki `jarvis` modülünden gelir (her saniye `jarvis.snapshot`); sayfa yalnız çizer. 1600×900'lük sahne
// pencereye oranlanarak ölçeklenir (4K ve 1080p'de aynı kompozisyon). Sekme/palet seçimi ana süreçte kalıcıdır.
import { Atom, Broadcast, Wrench } from '@phosphor-icons/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { HUD_PALETTES, HUD_TABS, type HudPalette, type HudSnapshot, type HudTab, type JarvisState } from '../../../../main/modules/jarvis/types';
import { LEVEL_LABEL } from '../../../../main/modules/jarvis/load';
import { attempt, useEvent } from '../../shell/live';
import { useShell } from '../../shell/context';
import { definePage } from '../page';
import { CalPanel, EnvPanel, FinPanel, LinksPanel, LogPanel } from './panels';
import { Reactor } from './reactor';
import { JarvisSettings } from './settings';
import { CommsTab, WorkshopTab } from './tabs';
import { DataField, HudWindow, Launcher, useHudWindows, useLaunchItems } from './windows';
import { Num, ReducedMotion, StageScale, Type, useSystemReduced } from './widgets';
import './jarvis.css';

const W = 1600;
const H = 900;

const TAB_LABEL: Record<HudTab, string> = { overview: 'GENEL', workshop: 'ATÖLYE', comms: 'İLETİŞİM' };
const TAB_ICON = { overview: Atom, workshop: Wrench, comms: Broadcast } as const;

/** Açılış ve kapanış animasyonlarının süreleri (ms); `jarvis.css` içindeki `jv-iris-*` ile aynı. */
const ENTER_MS = 950;
const LEAVE_MS = 700;
/** Kalp atışı yok (saat eklentisi çekirdekte değil): çekirdek halkası sabit, sakin bir ritimle atar. */
const BEAT_SEC = 3.2;
const PAL_LABEL: Record<HudPalette, string> = { cyan: 'CAM', blue: 'MAVİ', ember: 'KOR', ice: 'BUZ' };

function useStageFit(): number {
  const [scale, setScale] = useState(() => Math.min(window.innerWidth / W, window.innerHeight / H));
  useLayoutEffect(() => {
    const on = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return scale;
}

function useClockTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Çekirdekten panellere uzanan bağlantı çizgileri ("AZ 315 / ENV" etiketleriyle). */
function Connectors({ delay }: { delay: number }) {
  const lines: Array<{ pts: Array<[number, number]>; label: string; at: [number, number]; anchor?: 'start' | 'end' }> = [
    { pts: [[404, 205], [520, 205], [632, 258]], label: 'AZ 315 / HAVA', at: [412, 197] },
    { pts: [[404, 452], [500, 452], [560, 396]], label: 'AZ 270 / TAKVİM', at: [412, 444] },
    { pts: [[1196, 205], [1080, 205], [968, 258]], label: 'PİYASA / AZ 045', at: [1188, 197], anchor: 'end' },
    { pts: [[1196, 452], [1100, 452], [1040, 396]], label: 'BAĞ / AZ 090', at: [1188, 444], anchor: 'end' },
    { pts: [[800, 640], [800, 650]], label: '', at: [0, 0] },
  ];
  return (
    <svg className="jv-conn" width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ ['--d' as string]: `${delay}ms` }} aria-hidden>
      {lines.map((l, i) => (
        <g key={i}>
          <polyline points={l.pts.map((p) => p.join(',')).join(' ')} pathLength={1} />
          {[0, 1.6].map((off, k) => (
            <circle key={k} className="dot" r="2.4">
              <animateMotion dur="3.2s" begin={`${off + 1.4}s`} repeatCount="indefinite" path={`M${l.pts.map((p) => p.join(' ')).join(' L')}`} keyPoints={i % 2 ? '1;0' : '0;1'} keyTimes="0;1" calcMode="linear" />
            </circle>
          ))}
          <rect x={l.pts.at(-1)![0] - 3} y={l.pts.at(-1)![1] - 3} width="6" height="6" />
          {l.label && (
            <text x={l.at[0]} y={l.at[1]} textAnchor={l.anchor ?? 'start'}>
              {l.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function Header({ s, tab, setTab, palette, setPalette }: { s: HudSnapshot; tab: HudTab; setTab: (t: HudTab) => void; palette: HudPalette; setPalette: (p: HudPalette | 'auto') => void }) {
  const auto = s.paletteMode !== 'manual';
  const load = s.load;
  return (
    <header className="jv-head">
      <div className="jv-brand">
        <b>
          <Type text="JARVIS" speed={60} />
        </b>
        <span>DÜĞÜM.{s.node ?? 'PC'} / FUBER AI v2</span>
      </div>
      <nav className="jv-tabs" aria-label="JARVIS sekmeleri">
        {HUD_TABS.map((t) => {
          const Icon = TAB_ICON[t];
          return (
            <button key={t} type="button" className={t === tab ? 'is-on' : ''} onClick={() => setTab(t)} data-testid={`jv-tab-${t}`} aria-current={t === tab}>
              <Icon size={15} weight={t === tab ? 'fill' : 'regular'} />
              {TAB_LABEL[t]}
            </button>
          );
        })}
      </nav>
      <div className="jv-palbox">
        <div className="jv-pal" role="group" aria-label="Palet">
          <button type="button" className={`p-auto ${auto ? 'is-on' : ''}`} onClick={() => setPalette('auto')} data-testid="jv-pal-auto" title="Palet yoğunluğa göre kendiliğinden değişir">
            <i />
            OTO
          </button>
          {HUD_PALETTES.map((p) => (
            <button key={p} type="button" className={`p-${p} ${!auto && p === palette ? 'is-on' : ''}`} onClick={() => setPalette(p)} data-testid={`jv-pal-${p}`}>
              <i />
              {PAL_LABEL[p]}
            </button>
          ))}
        </div>
        {load && (
          <div className={`jv-load l-${load.level}`} title={load.reasons.length ? load.reasons.join(' · ') : 'Dikkat bekleyen bir şey yok'} data-testid="jv-load">
            <span>
              YOĞUNLUK <b>{load.score}</b> · {LEVEL_LABEL[load.level]}
            </span>
            <i style={{ ['--w' as string]: `${load.score}%` }} />
            {auto ? <em>OTO · {palette === 'ice' ? 'BUZ' : palette === 'blue' ? 'MAVİ' : palette === 'ember' ? 'KOR' : 'CAM'}</em> : <em>ELLE</em>}
          </div>
        )}
      </div>
      <div className="jv-clock">
        <b data-testid="jv-time">{s.clock.time}</b>
        <span>
          {s.clock.date} · {s.clock.tz}
        </span>
      </div>
    </header>
  );
}

function Footer({ s, tab, onSettings, onExit, onChat, onLauncher }: { s: HudSnapshot; tab: HudTab; onSettings: () => void; onExit: () => void; onChat: () => void; onLauncher: () => void }) {
  const up = s.core.uptimeSec ?? 0;
  const e = s.env;
  return (
    <footer className="jv-foot">
      <span>
        SİS.00 / {TAB_LABEL[tab]} · AÇIK KALMA {Math.floor(up / 86400)} G {Math.floor((up % 86400) / 3600)} S
      </span>
      <span className="jv-foot-btns">
        <button type="button" className="jv-btn primary" onClick={onChat} data-testid="jv-open-chat">
          SOHBET
        </button>
        <button type="button" className="jv-btn" onClick={onLauncher} data-testid="jv-open-launcher" title="Ctrl+Boşluk">
          KOMUT
        </button>
        <button type="button" className="jv-btn" onClick={onSettings} data-testid="jv-open-settings">
          AYAR
        </button>
        <button type="button" className="jv-btn" onClick={onExit} data-testid="jv-exit">
          ESC · ÇIK
        </button>
      </span>
      <span>{e.status === 'off' ? 'KONUM BİLİNMİYOR' : `${e.lat.toFixed(4)} ${e.lat >= 0 ? 'K' : 'G'} ${e.lon.toFixed(4)} ${e.lon >= 0 ? 'D' : 'B'}`}</span>
    </footer>
  );
}

function Overview({ s, onFocus, beat, boot, levelRef, onCore }: { s: HudSnapshot; onFocus: (sym: string) => void; beat: number; boot: number; levelRef: { current: number }; onCore: () => void }) {
  const d = (n: number) => (boot ? n : n / 5);
  return (
    <>
      <Connectors delay={d(900)} />
      <div className="jv-hello" style={{ ['--d' as string]: `${d(300)}ms` }}>
        <h1 data-testid="jv-greeting">
          <Type text={s.greeting} delay={d(400)} speed={34} />
        </h1>
        <p data-testid="jv-summary">
          {s.voice && (s.voice.state === 'speaking' || s.voice.state === 'thinking') && s.voice.text ? s.voice.text : <Type text={s.summary} delay={d(900)} speed={16} />}
        </p>
      </div>
      <div className="jv-core-wrap" onClick={onCore} role="button" aria-label="Komut halkasını aç" data-testid="jv-core">
        <Reactor core={s.core} beatSec={beat} delay={d(100)} voice={s.voice?.state} levelRef={levelRef} />
      </div>
      <EnvPanel s={s} x={32} y={86} w={372} h={234} delay={d(200)} />
      <CalPanel s={s} x={32} y={332} w={372} h={540} delay={d(380)} />
      <FinPanel s={s} onFocus={onFocus} x={1196} y={86} w={372} h={240} delay={d(260)} />
      <LinksPanel s={s} x={1196} y={340} w={372} h={256} delay={d(440)} />
      <LogPanel s={s} x={1196} y={610} w={372} h={262} delay={d(620)} />
    </>
  );
}

function JarvisHud() {
  const shell = useShell();
  const [state, setState] = useState<JarvisState | null>(null);
  const [settings, setSettings] = useState(false);
  const [launcher, setLauncher] = useState(false);
  const [boot, setBoot] = useState(1);
  /** `entering`: iris açılıyor · `open` · `leaving`: iris kapanıyor (bitince Bugün'e dönülür). */
  const [phase, setPhase] = useState<'entering' | 'open' | 'leaving'>('entering');
  const launchItems = useLaunchItems();
  const titleOf = useCallback((kind: string) => launchItems.find((i) => i.kind === kind)?.label ?? kind.toUpperCase(), [launchItems]);
  const win = useHudWindows(titleOf);
  const scale = useStageFit();
  useClockTick();
  const sysReduced = useSystemReduced();
  const reduced = sysReduced || shell.settings?.reducedMotion === 'on';

  useEffect(() => {
    let alive = true;
    void attempt(() => window.fuber.invoke('jarvis.get', {})).then((r) => alive && r && setState(r));
    return () => {
      alive = false;
    };
  }, []);
  useEvent('jarvis.snapshot', ({ snapshot }) => setState((cur) => (cur ? { ...cur, snapshot, config: { ...cur.config, palette: cur.config.paletteMode === 'auto' ? cur.config.palette : snapshot.palette, tab: snapshot.tab, paletteMode: snapshot.paletteMode ?? cur.config.paletteMode } } : cur)));

  useEffect(() => {
    const id = setTimeout(() => setPhase((p) => (p === 'entering' ? 'open' : p)), ENTER_MS);
    return () => clearTimeout(id);
  }, []);

  // Tam ekran: açılırken aç, çıkarken geri al.
  useEffect(() => {
    void window.fuber.invoke('jarvis.fullscreen', { on: true }).catch(() => undefined);
    return () => void window.fuber.invoke('jarvis.fullscreen', { on: false }).catch(() => undefined);
  }, []);

  /** Çıkış animasyonunu başlatır; bitince Bugün'e dönülür. Tekrar çağrılırsa yok sayılır. */
  const leaving = useRef(false);
  const exit = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    setPhase('leaving');
    window.setTimeout(() => shell.navigate('today'), shell.settings?.reducedMotion === 'on' ? 180 : LEAVE_MS);
  }, [shell]);
  // "Jarvis modunu kapat" (ses ya da araç): aynı çıkış.
  useEvent('jarvis.mode', ({ on }) => {
    if (!on) exit();
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        setLauncher((v) => !v);
        return;
      }
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (settings) setSettings(false);
      else if (launcher) setLauncher(false);
      else if (!win.closeTop()) exit();
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [exit, settings, launcher, win]);

  // İlk açılış bittikten sonra sekme geçişleri kısa sıralı açılır.
  useEffect(() => {
    const id = setTimeout(() => setBoot(0), 4200);
    return () => clearTimeout(id);
  }, []);

  const setTab = useCallback((tab: HudTab) => {
    setState((cur) => (cur ? { ...cur, snapshot: { ...cur.snapshot, tab }, config: { ...cur.config, tab } } : cur));
    void attempt(() => window.fuber.invoke('jarvis.setTab', { tab }));
  }, []);
  const setPalette = useCallback((palette: HudPalette | 'auto') => {
    setState((cur) =>
      cur
        ? palette === 'auto'
          ? { ...cur, snapshot: { ...cur.snapshot, paletteMode: 'auto' }, config: { ...cur.config, paletteMode: 'auto' } }
          : { ...cur, snapshot: { ...cur.snapshot, palette, paletteMode: 'manual' }, config: { ...cur.config, palette, paletteMode: 'manual' } }
        : cur,
    );
    void attempt(() => window.fuber.invoke('jarvis.setPalette', { palette }));
  }, []);
  const onFocus = useCallback((sym: string) => void attempt(() => window.fuber.invoke('jarvis.setConfig', { focus: sym })).then((r) => r && setState(r)), []);
  const onOpen = useCallback(
    (ref: string) => {
      if (ref.startsWith('cal:')) shell.navigate('planner');
    },
    [shell],
  );

  const s = state?.snapshot;
  const beat = BEAT_SEC;

  const stageStyle: CSSProperties = { width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` };
  const tab = s?.tab ?? 'overview';
  const d = (n: number) => (boot ? n : n / 6);

  const root = (
    <ReducedMotion.Provider value={reduced}>
      <StageScale.Provider value={scale}>
        <div className={`jv-root ${reduced ? 'is-reduced' : ''} ${phase === 'entering' ? 'is-entering' : phase === 'leaving' ? 'is-leaving' : ''}`} data-phase={phase} data-pal={s?.palette ?? 'cyan'} data-tab={tab} data-testid="jarvis-page" data-ready={s ? '1' : '0'}>
          {phase !== 'open' && <div className="jv-iris" aria-hidden />}
          <div className="jv-bg" aria-hidden>
            <div className="jv-vignette" />
            <div className="jv-scanline" />
          </div>
          <div className="jv-stage" style={stageStyle}>
            <DataField />
            {s ? (
              <>
                <Header s={s} tab={tab} setTab={setTab} palette={s.palette} setPalette={setPalette} />
                <div className="jv-tabcontent" key={tab}>
                  {tab === 'overview' && <Overview s={s} onFocus={onFocus} beat={beat} boot={boot} levelRef={shell.level} onCore={() => setLauncher((v) => !v)} />}
                  {tab === 'workshop' && (
                    <WorkshopTab
                      s={s}
                      r={{
                        gauges: { x: 32, y: 86, w: 540, h: 786, delay: d(100) },
                        history: { x: 588, y: 86, w: 620, h: 300, delay: d(250) },
                        cores: { x: 588, y: 402, w: 620, h: 470, delay: d(400) },
                        jobs: { x: 1224, y: 86, w: 344, h: 786, delay: d(550) },
                      }}
                    />
                  )}
                  {tab === 'comms' && (
                    <CommsTab
                      s={s}
                      onOpen={onOpen}
                      r={{
                        log: { x: 32, y: 86, w: 900, h: 786, delay: d(100) },
                        notices: { x: 948, y: 86, w: 620, h: 786, delay: d(300) },
                      }}
                    />
                  )}
                </div>
                <div className="jv-winlayer">
                  {win.wins.map((w, i) => (
                    <HudWindow key={w.id} win={w} delay={0} onClose={() => win.close(w.id)} onFocus={() => win.focus(w.id)} onPatch={(p) => win.patch(w.id, p)} />
                  ))}
                </div>
                {launcher && (
                  <Launcher
                    items={launchItems}
                    onClose={() => setLauncher(false)}
                    onPick={(kind) => {
                      setLauncher(false);
                      win.open(kind);
                    }}
                  />
                )}
                <Footer s={s} tab={tab} onSettings={() => setSettings(true)} onExit={exit} onChat={() => win.open('chat')} onLauncher={() => setLauncher((v) => !v)} />
              </>
            ) : (
              <div className="jv-loading">
                <Num value={null} fallback="BAŞLATILIYOR" />
              </div>
            )}
          </div>
          {settings && state && (
            <JarvisSettings
              config={state.config}
              onClose={() => setSettings(false)}
              onSave={(patch) => void attempt(() => window.fuber.invoke('jarvis.setConfig', patch)).then((r) => r && setState(r))}
            />
          )}
        </div>
      </StageScale.Provider>
    </ReducedMotion.Provider>
  );
  return createPortal(root, document.body);
}

export default definePage({
  id: 'jarvis',
  titleKey: 'jarvis.nav',
  icon: Atom,
  order: 73,
  moduleId: 'jarvis',
  // Rayda görünmez: yalnız sesle (`jarvis_mode`) açılır.
  hidden: true,
  Component: JarvisHud,
});
