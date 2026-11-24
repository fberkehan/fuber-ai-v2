// JARVIS MODE içinde HUD pencereleri: Fuber AI 2'nin bütün sayfaları (Sohbet, Planlar, Hafıza, Toplantı, İşler,
// Projeler, Yetenekler, Geliştirme, Ayarlar; eklentilerle VR, Saat…) mevcut sayfa bileşenleriyle, HUD temasında, sürüklenip
// büyütülebilen çerçeveli pencereler olarak açılır. Sahne 1600×900 ölçeklendiği için sürükleme/boyutlama sahne pikselindedir.
// Açılış: çerçeve çizilir + tarama çizgisi geçer; kapanış: içe çöker. Komut halkası: çekirdeğe tıkla ya da Ctrl+Space.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { ChatCircleText, Check, X } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { ChatDock } from '../today/chat-dock';
import { attempt } from '../../shell/live';
import { useShell } from '../../shell/context';
import { PageBoundary } from '../../shell/PageBoundary';
import { pages } from '../registry';
import { Type, useReduced, useStageScale } from './widgets';

const STAGE_W = 1600;
const STAGE_H = 900;
const CUT = 12;

export interface HudWin {
  id: string;
  kind: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  closing: boolean;
  maximized?: { x: number; y: number; w: number; h: number } | null;
}

export interface LaunchItem {
  kind: string;
  label: string;
  Icon: (props: { size?: number; weight?: 'regular' | 'fill' }) => ReactElement;
}

/** Komut halkasında görünen girdiler: Sohbet + etkin modüllerin bütün sayfaları. */
export function useLaunchItems(): LaunchItem[] {
  const shell = useShell();
  return useMemo(() => {
    const out: LaunchItem[] = [{ kind: 'chat', label: 'SOHBET', Icon: (p) => <ChatCircleText {...p} /> }];
    for (const def of pages) {
      if (def.id === 'jarvis' || def.id === 'chat') continue;
      if (def.moduleId && !shell.moduleEnabled(def.moduleId)) continue;
      const Icon = def.icon;
      out.push({ kind: def.id, label: t(def.titleKey).toLocaleUpperCase('tr'), Icon: (p) => <Icon {...p} /> });
    }
    return out;
  }, [shell]);
}

let seq = 0;
const SIZES: Record<string, [number, number]> = { chat: [560, 640] };

export function useHudWindows(titleOf: (kind: string) => string) {
  const [wins, setWins] = useState<HudWin[]>([]);
  const zTop = useRef(10);
  const open = useCallback(
    (kind: string) => {
      setWins((cur) => {
        const existing = cur.find((w) => w.kind === kind && !w.closing);
        if (existing) return cur.map((w) => (w.id === existing.id ? { ...w, z: ++zTop.current } : w));
        const [w, h] = SIZES[kind] ?? [920, 650];
        const n = cur.filter((x) => !x.closing).length;
        const x = Math.min(STAGE_W - w - 24, 180 + n * 44);
        const y = Math.min(STAGE_H - h - 40, 100 + n * 34);
        return [...cur, { id: `w${++seq}`, kind, title: titleOf(kind), x, y, w, h, z: ++zTop.current, closing: false }];
      });
    },
    [titleOf],
  );
  const close = useCallback((id: string) => {
    setWins((cur) => cur.map((w) => (w.id === id ? { ...w, closing: true } : w)));
    setTimeout(() => setWins((cur) => cur.filter((w) => w.id !== id)), 380);
  }, []);
  const focus = useCallback((id: string) => setWins((cur) => cur.map((w) => (w.id === id ? { ...w, z: ++zTop.current } : w))), []);
  const patch = useCallback((id: string, p: Partial<HudWin>) => setWins((cur) => cur.map((w) => (w.id === id ? { ...w, ...p } : w))), []);
  const closeTop = useCallback((): boolean => {
    let closed = false;
    setWins((cur) => {
      const live = cur.filter((w) => !w.closing);
      if (!live.length) return cur;
      const top = live.reduce((a, b) => (a.z > b.z ? a : b));
      closed = true;
      setTimeout(() => setWins((c) => c.filter((w) => w.id !== top.id)), 380);
      return cur.map((w) => (w.id === top.id ? { ...w, closing: true } : w));
    });
    return closed;
  }, []);
  return { wins, open, close, focus, patch, closeTop };
}

// ───────── pencere ─────────

function ChatWin() {
  const shell = useShell();
  const approvals = shell.live.approvals;
  return (
    <div className="jv-chatwin" data-testid="jv-chat">
      {approvals.length > 0 && (
        <ul className="jv-approvals" data-testid="jv-approvals">
          {approvals.map((a) => (
            <li key={a.id}>
              <b>ONAY BEKLİYOR</b>
              <p>{a.summary}</p>
              <span>
                <button type="button" className="jv-btn primary" onClick={() => void attempt(() => window.fuber.invoke('attention.resolveApproval', { id: a.id, approve: true }))}>
                  <Check size={12} /> ONAYLA
                </button>
                <button type="button" className="jv-btn" onClick={() => void attempt(() => window.fuber.invoke('attention.resolveApproval', { id: a.id, approve: false }))}>
                  <X size={12} /> REDDET
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="jv-chatdock">
        <ChatDock mode="side" />
      </div>
    </div>
  );
}

function PageWin({ kind }: { kind: string }) {
  const def = pages.find((p) => p.id === kind);
  if (!def) return null;
  const Page = def.Component;
  return (
    <PageBoundary page={kind}>
      <Page />
    </PageBoundary>
  );
}

export function HudWindow({ win, onClose, onFocus, onPatch, delay = 0 }: { win: HudWin; onClose: () => void; onFocus: () => void; onPatch: (p: Partial<HudWin>) => void; delay?: number }) {
  const scale = useStageScale();
  const drag = useRef<{ mode: 'move' | 'size'; sx: number; sy: number; x: number; y: number; w: number; h: number } | null>(null);

  const start = (mode: 'move' | 'size') => (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    onFocus();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / scale;
    const dy = (e.clientY - d.sy) / scale;
    if (d.mode === 'move') onPatch({ x: Math.max(-d.w + 120, Math.min(STAGE_W - 120, d.x + dx)), y: Math.max(64, Math.min(STAGE_H - 60, d.y + dy)), maximized: null });
    else onPatch({ w: Math.max(420, Math.min(STAGE_W - d.x, d.w + dx)), h: Math.max(300, Math.min(STAGE_H - d.y - 8, d.h + dy)), maximized: null });
  };
  const end = () => {
    drag.current = null;
  };
  const toggleMax = () => {
    if (win.maximized) onPatch({ ...win.maximized, maximized: null });
    else onPatch({ maximized: { x: win.x, y: win.y, w: win.w, h: win.h }, x: 24, y: 74, w: STAGE_W - 48, h: STAGE_H - 106 });
  };

  const { w, h } = win;
  const outline = `${CUT},0.5 ${w - 0.5},0.5 ${w - 0.5},${h - CUT} ${w - CUT},${h - 0.5} 0.5,${h - 0.5} 0.5,${CUT}`;
  const style = { left: win.x, top: win.y, width: w, height: h, zIndex: win.z, '--d': `${delay}ms`, '--cut': `${CUT}px` } as CSSProperties;
  return (
    <section className={`jv-win ${win.closing ? 'is-closing' : ''}`} style={style} onPointerDown={onFocus} data-testid={`jv-win-${win.kind}`} data-closing={win.closing ? '1' : '0'}>
      <svg className="jv-outline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <polygon points={outline} pathLength={1} />
        <polygon className="jv-runner" points={outline} pathLength={1} />
      </svg>
      <div className="jv-win-scan" aria-hidden />
      <header className="jv-phead jv-win-head" onPointerDown={start('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onDoubleClick={toggleMax}>
        <span className="jv-ptag">MOD</span>
        <span className="jv-ptitle">
          <Type text={win.title} delay={delay + 150} speed={22} />
        </span>
        <button type="button" className="jv-wbtn" onClick={toggleMax} aria-label="Büyüt" title="Büyüt / eski boyut">
          ▢
        </button>
        <button type="button" className="jv-wbtn" onClick={onClose} aria-label="Kapat" data-testid={`jv-win-close-${win.kind}`}>
          ✕
        </button>
      </header>
      <div className="jv-win-body">{win.kind === 'chat' ? <ChatWin /> : <PageWin kind={win.kind} />}</div>
      <div className="jv-win-grip" onPointerDown={start('size')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-label="Boyutlandır" />
    </section>
  );
}

// ───────── komut halkası ─────────

export function Launcher({ items, onPick, onClose }: { items: LaunchItem[]; onPick: (kind: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const needle = q.trim().toLocaleLowerCase('tr');
  const matches = (it: LaunchItem) => !needle || it.label.toLocaleLowerCase('tr').includes(needle);
  const n = items.length;
  const inner = Math.min(8, n);
  const pos = (i: number): { x: number; y: number } => {
    const ring = i < inner ? 0 : 1;
    const count = ring === 0 ? inner : n - inner;
    const k = ring === 0 ? i : i - inner;
    const r = ring === 0 ? 150 : 238;
    const a = (k / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2 + (ring === 1 ? Math.PI / Math.max(1, count) : 0);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  };
  const firstMatch = items.find(matches);
  return (
    <div className="jv-launcher" role="dialog" aria-label="Komut halkası" data-testid="jv-launcher" onClick={onClose}>
      <div className="jv-ring-stage" onClick={(e) => e.stopPropagation()}>
        <svg className="jv-ring-art" viewBox="-300 -300 600 600" aria-hidden>
          <circle r="150" pathLength={1} />
          <circle r="238" pathLength={1} className="o" />
          <circle r="58" pathLength={1} className="c" />
        </svg>
        <div className="jv-ring-center">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && firstMatch) onPick(firstMatch.kind);
            }}
            placeholder="KOMUT"
            aria-label="Komut ara"
            data-testid="jv-launcher-input"
          />
        </div>
        {items.map((it, i) => {
          const p = pos(i);
          const dim = !matches(it);
          return (
            <button
              key={it.kind}
              type="button"
              className={`jv-ring-item ${dim ? 'is-dim' : ''}`}
              style={{ ['--x' as string]: `${p.x}px`, ['--y' as string]: `${p.y}px`, ['--i' as string]: i } as CSSProperties}
              onClick={() => onPick(it.kind)}
              data-testid={`jv-launch-${it.kind}`}
            >
              <span>
                <it.Icon size={22} />
              </span>
              <em>{it.label}</em>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ───────── arka plan: yavaş akan veri parçacıkları ─────────

export function DataField() {
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = useStageScale();
  const reduced = useReduced();
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1) * scale;
    cv.width = Math.round(STAGE_W * dpr);
    cv.height = Math.round(STAGE_H * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const style = getComputedStyle(cv);
    type P = { x: number; y: number; vx: number; vy: number; r: number; a: number; txt?: string };
    const mk = (i: number): P => {
      const glyph = i % 9 === 0;
      return { x: Math.random() * STAGE_W, y: Math.random() * STAGE_H, vx: (Math.random() - 0.5) * 6, vy: -(4 + Math.random() * 12), r: 0.6 + Math.random() * 1.4, a: 0.1 + Math.random() * 0.22, ...(glyph ? { txt: (Math.floor(Math.random() * 0xffff)).toString(16).toUpperCase().padStart(4, '0') } : {}) };
    };
    const ps = Array.from({ length: 90 }, (_, i) => mk(i));
    let last = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const accent = style.getPropertyValue('--jv-accent').trim() || '#34d8f4';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, STAGE_W, STAGE_H);
      ctx.fillStyle = accent;
      ctx.font = '9px monospace';
      for (const p of ps) {
        if (!reduced) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
        }
        if (p.y < -10 || p.x < -20 || p.x > STAGE_W + 20) {
          p.y = STAGE_H + 10;
          p.x = Math.random() * STAGE_W;
        }
        ctx.globalAlpha = p.a;
        if (p.txt) ctx.fillText(p.txt, p.x, p.y);
        else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [scale, reduced]);
  return <canvas ref={ref} className="jv-datafield" style={{ width: STAGE_W, height: STAGE_H }} aria-hidden />;
}
