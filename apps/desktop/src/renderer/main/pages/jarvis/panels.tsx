// GENEL sekmesinin panelleri. Her sayı gerçek kaynaktan gelir; kaynak yoksa "BAĞLI DEĞİL" yazılır (sahte sayı yok).
import type { HudSnapshot } from '../../../../main/modules/jarvis/types';
import { Num, Off, Panel, Segs, Spark, Type } from './widgets';

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const countdown = (sec: number) => `T-${pad2(Math.floor(sec / 3600))}:${pad2(Math.floor((sec % 3600) / 60))}:${pad2(sec % 60)}`;
const up = (s: string) => s.toLocaleUpperCase('tr');
const fmtCoord = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)} ${v >= 0 ? pos : neg}`;
export const fmtPrice = (v: number, cur: string): string => {
  const d = v >= 1000 ? 2 : v >= 10 ? 2 : 4;
  return `${v.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d })}${cur === 'USD' || cur === 'TRY' ? '' : ' ' + cur}`;
};
export const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')}%`;

export const levelTone = (l: number) => (l >= 3 ? 'bad' : l === 2 ? 'warn' : 'ok');

// ───────── ENV ─────────
export function EnvBody({ s, big = false }: { s: HudSnapshot; big?: boolean }) {
  const e = s.env;
  if (e.status === 'off') return <Off sub="KONUM YA DA AĞ YOK">HAVA VERİSİ YOK</Off>;
  return (
    <div className={`jv-env ${big ? 'is-big' : ''}`}>
      <div className="jv-env-top">
        <div className="jv-temp">
          <Num value={e.tempC} digits={1} />
          <sup>°C</sup>
        </div>
        <div className="jv-env-place">
          <b>{up(e.place)}</b>
          <span>
            {fmtCoord(e.lat, 'K', 'G')} / {fmtCoord(e.lon, 'D', 'B')}
          </span>
          <em>{up(e.condition)}</em>
          {e.feelsC !== undefined && <span>HİSSEDİLEN {e.feelsC}°</span>}
        </div>
      </div>
      <dl className="jv-stats4">
        <div>
          <dt>RÜZGÂR</dt>
          <dd>
            <Num value={e.windKmh} /> KM/S {e.windDir}
          </dd>
        </div>
        <div>
          <dt>NEM</dt>
          <dd>
            %<Num value={e.humidity} />
          </dd>
        </div>
        <div>
          <dt>{e.uv !== undefined ? 'UV' : 'YAĞIŞ'}</dt>
          <dd>{e.uv !== undefined ? e.uv.toFixed(1) : e.rainPct !== undefined ? `%${e.rainPct}` : '—'}</dd>
        </div>
        <div>
          <dt>GÖRÜŞ</dt>
          <dd>
            <Num value={e.visibilityKm} digits={0} /> KM
          </dd>
        </div>
      </dl>
      <div className="jv-hours">
        {e.hourly.map((h) => (
          <div key={h.time}>
            <span>{h.time}</span>
            <b>{h.tempC}°</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EnvPanel({ s, ...pos }: { s: HudSnapshot; x: number; y: number; w: number; h: number; delay: number }) {
  const e = s.env;
  return (
    <Panel tag="ENV.06" title="YEREL KOŞULLAR" badge={e.status === 'off' ? 'BAĞLI DEĞİL' : e.status === 'stale' ? 'BAYAT' : up(e.condition).slice(0, 16)} badgeTone={e.status === 'ok' ? 'ok' : 'warn'} testId="jv-env" {...pos}>
      <EnvBody s={s} />
    </Panel>
  );
}

// ───────── CAL ─────────
export function CalBody({ s, max = 6, onOpen }: { s: HudSnapshot; max?: number; onOpen?: (ref: string) => void }) {
  const c = s.cal;
  if (c.status === 'off') return <Off sub="PLANLAYICI MODÜLÜ KAPALI">TAKVİM YOK</Off>;
  return (
    <div className="jv-cal">
      <div className="jv-next">
        <span>SIRADAKİ OLAY</span>
        <b>{c.nextInSec === null ? '—' : countdown(c.nextInSec)}</b>
      </div>
      {(c.eventCount ?? c.items.length) === 0 && <div className="jv-empty is-none">BUGÜN PLANLANMIŞ OLAY YOK</div>}
      {c.items.length > 0 && (
        <ul>
          {c.items.slice(0, max).map((i) => (
            <li key={i.ref} className={`${i.current ? 'is-now' : ''} k-${i.kind ?? 'event'}`} onClick={() => onOpen?.(i.ref)}>
              <time>{i.time}</time>
              <span>{i.title}</span>
              <em>{i.place}</em>
            </li>
          ))}
        </ul>
      )}
      {c.hint && <p className="jv-hint">{c.hint}</p>}
    </div>
  );
}

export function CalPanel({ s, ...pos }: { s: HudSnapshot; x: number; y: number; w: number; h: number; delay: number }) {
  const c = s.cal;
  return (
    <Panel tag="TKV.02" title="BUGÜN / PROGRAM" badge={c.status === 'off' ? 'KAPALI' : (c.eventCount ?? 0) > 0 ? `${c.eventCount} OLAY` : c.items.length ? `${c.items.length} GÖREV` : 'BOŞ'} badgeTone={c.status === 'off' ? 'warn' : 'ok'} testId="jv-cal" {...pos}>
      <CalBody s={s} />
    </Panel>
  );
}

// ───────── FIN ─────────
export function FinBody({ s, onFocus, all = false }: { s: HudSnapshot; onFocus: (sym: string) => void; all?: boolean }) {
  const f = s.fin;
  if (f.status === 'off' || f.items.length === 0) return <Off sub="AĞ YA DA KAYNAK ERİŞİLEMİYOR">PİYASA VERİSİ YOK</Off>;
  const focus = f.items.find((i) => i.sym === f.focus) ?? f.items[0]!;
  const rest = f.items.filter((i) => i !== focus);
  const down = focus.changePct < 0;
  return (
    <div className="jv-fin">
      <div className="jv-fin-top">
        <div>
          <div className={`jv-price ${down ? 'is-down' : ''}`}>
            <Num value={focus.price} digits={focus.price >= 100 ? 2 : 4} />
            <em>{fmtPct(focus.changePct)}</em>
          </div>
          <span className="jv-fin-name">
            {focus.sym} · {up(focus.name)}
          </span>
        </div>
        <Spark series={focus.series} width={all ? 360 : 178} height={all ? 74 : 50} up={!down} />
      </div>
      <div className={`jv-tickers ${all ? 'is-all' : ''}`}>
        {rest.map((i) => (
          <button key={i.sym} type="button" onClick={() => onFocus(i.sym)} className={i.changePct < 0 ? 'is-down' : ''}>
            <span>{i.sym}</span>
            <b>{fmtPct(i.changePct)}</b>
            {all && <Spark series={i.series} width={120} height={22} up={i.changePct >= 0} />}
            {all && <small>{fmtPrice(i.price, i.currency)}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FinPanel({ s, onFocus, ...pos }: { s: HudSnapshot; onFocus: (sym: string) => void; x: number; y: number; w: number; h: number; delay: number }) {
  const f = s.fin;
  const badge = f.status === 'off' ? 'BAĞLI DEĞİL' : f.status === 'stale' ? 'BAYAT' : f.marketOpen ? 'PİYASA AÇIK' : 'PİYASA KAPALI';
  return (
    <Panel tag="FİN.03" title="PORTFÖY / PİYASA" badge={badge} badgeTone={f.status === 'ok' && f.marketOpen ? 'ok' : 'warn'} testId="jv-fin" {...pos}>
      <FinBody s={s} onFocus={onFocus} />
    </Panel>
  );
}

// ───────── LINKS ─────────
export function LinksBody({ s, rows }: { s: HudSnapshot; rows?: number }) {
  const items = s.links.items.slice(0, rows ?? 99);
  return (
    <ul className="jv-links">
      {items.map((l) => (
        <li key={l.id} className={l.up ? '' : 'is-down'}>
          <b>{l.name}</b>
          <span>{l.detail}</span>
          <Segs value={l.quality} count={14} tone={l.up ? '' : 'dead'} />
          <em>{l.up ? (l.latencyMs === null ? 'BAĞLI' : `${l.latencyMs}MS`) : 'YOK'}</em>
        </li>
      ))}
    </ul>
  );
}

export function LinksPanel({ s, ...pos }: { s: HudSnapshot; x: number; y: number; w: number; h: number; delay: number }) {
  const l = s.links;
  return (
    <Panel tag="BAĞ.07" title="BAĞLANTILAR" badge={`${l.linked}/${l.total} BAĞLI`} badgeTone={l.linked === l.total ? 'ok' : 'warn'} testId="jv-links" {...pos}>
      <LinksBody s={s} rows={7} />
    </Panel>
  );
}

// ───────── LOG ─────────
export function LogBody({ s, max = 5, full = false, onOpen }: { s: HudSnapshot; max?: number; full?: boolean; onOpen?: (ref: string) => void }) {
  if (s.log.length === 0) return <div className="jv-empty">HENÜZ OLAY YOK</div>;
  return (
    <ul className={`jv-log ${full ? 'is-full' : ''}`}>
      {s.log.slice(0, max).map((e, i) => (
        <li key={`${e.ts}-${i}-${e.text}`} onClick={() => e.ref && onOpen?.(e.ref)}>
          <time>{e.ts}</time>
          <b className={`t-${e.tag}`}>{e.tag}</b>
          <span>{e.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function LogPanel({ s, ...pos }: { s: HudSnapshot; x: number; y: number; w: number; h: number; delay: number }) {
  return (
    <Panel tag="İLT.04" title="ASİSTAN GÜNLÜĞÜ" badge="DİNLİYOR" badgeTone="ok" testId="jv-log" {...pos}>
      <LogBody s={s} max={5} />
    </Panel>
  );
}
