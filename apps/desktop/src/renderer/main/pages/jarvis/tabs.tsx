// ATÖLYE · İLETİŞİM sekmeleri (GENEL `index.tsx` içindeki yerleşimdir). Aynı gerçek anlık görüntü.
import { useState } from 'react';
import type { HudSnapshot } from '../../../../main/modules/jarvis/types';
import { LogBody } from './panels';
import { MultiLine, Num, Off, Panel, Segs } from './widgets';

type Rect = { x: number; y: number; w: number; h: number; delay: number };
const up = (s: string) => s.toLocaleUpperCase('tr');

function Gauge({ label, value, sub, size = 190 }: { label: string; value: number | null; sub: string; size?: number }) {
  const r = size / 2 - 14;
  const circ = 2 * Math.PI * r;
  const arcLen = circ * 0.75;
  const v = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  const tone = value !== null && value > 90 ? 'bad' : value !== null && value > 75 ? 'warn' : '';
  return (
    <div className={`jv-gauge ${value === null ? 'is-off' : ''} ${tone}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="trk" strokeDasharray={`${arcLen} ${circ}`} transform={`rotate(135 ${size / 2} ${size / 2})`} />
        <circle cx={size / 2} cy={size / 2} r={r} className="val" strokeDasharray={`${arcLen * v} ${circ}`} transform={`rotate(135 ${size / 2} ${size / 2})`} />
        <circle cx={size / 2} cy={size / 2} r={r - 12} className="hair" />
      </svg>
      <div className="g-text">
        <label>{label}</label>
        <b>{value === null ? 'YOK' : <Num value={value} digits={0} suffix="%" />}</b>
        <span>{sub}</span>
      </div>
    </div>
  );
}

export function WorkshopTab({ s, r }: { s: HudSnapshot; r: { gauges: Rect; history: Rect; cores: Rect; jobs: Rect } }) {
  const c = s.core;
  const jobs = s.jobs ?? [];
  const up24 = c.uptimeSec ?? 0;
  return (
    <>
      <Panel tag="ATL.01" title="ÇEKİRDEK / DONANIM" badge={c.gpuName ? up(c.gpuName).slice(0, 22) : 'GPU YOK'} badgeTone={c.gpu === null ? 'warn' : 'ok'} {...r.gauges} testId="jv-gauges">
        <div className="jv-gauges">
          <Gauge label="İŞLEMCİ" value={c.cpu} sub={`${c.cores?.length ?? '—'} MANTIKSAL ÇEKİRDEK`} />
          <Gauge label="EKRAN KARTI" value={c.gpu} sub={c.gpu === null ? 'NVIDIA-SMI YOK' : (c.gpuName ?? '')} />
          <Gauge label="BELLEK" value={c.ram} sub={`${c.ramUsedGb ?? '—'} / ${c.ramTotalGb ?? '—'} GB`} />
          <Gauge label="VRAM" value={c.vram} sub={c.vram === null ? 'OKUNAMADI' : `${c.vramUsedGb} / ${c.vramTotalGb} GB`} />
        </div>
        <div className="jv-hwfoot">
          <div>
            <label>SICAKLIK</label>
            <b>{c.tempC === null ? 'OKUNAMADI' : `${Math.round(c.tempC)} °C`}</b>
            <span>{c.tempSource === 'gpu' ? 'EKRAN KARTI' : c.tempSource === 'cpu' ? 'İŞLEMCİ' : 'SENSÖR YOK'}</span>
          </div>
          <div>
            <label>AÇIK KALMA</label>
            <b>
              {Math.floor(up24 / 86400)}G {Math.floor((up24 % 86400) / 3600)}S {Math.floor((up24 % 3600) / 60)}D
            </b>
            <span>{s.node ?? ''}</span>
          </div>
        </div>
      </Panel>
      <Panel tag="ATL.02" title="YÜK GEÇMİŞİ / SON 60 SN" badge="CANLI" {...r.history} testId="jv-history">
        <MultiLine
          width={r.history.w - 40}
          height={200}
          lines={[
            { series: c.cpuSeries ?? [], cls: 'a' },
            { series: c.gpuSeries ?? [], cls: 'b' },
            { series: c.ramSeries ?? [], cls: 'c' },
          ]}
        />
        <div className="jv-legend">
          <span className="a">İŞLEMCİ</span>
          <span className="b">EKRAN KARTI{c.gpu === null ? ' (YOK)' : ''}</span>
          <span className="c">BELLEK</span>
        </div>
      </Panel>
      <Panel tag="ATL.03" title="ÇEKİRDEK BAŞINA YÜK" badge={`${c.cores?.length ?? 0} ÇEKİRDEK`} {...r.cores} testId="jv-cores">
        <div className="jv-cores">
          {(c.cores ?? []).map((v, i) => (
            <div key={i}>
              <span>{String(i).padStart(2, '0')}</span>
              <Segs value={v / 100} count={18} tone={v > 85 ? 'warn' : ''} />
              <b>{v}%</b>
            </div>
          ))}
        </div>
      </Panel>
      <Panel tag="ATL.04" title="SÜREN İŞLER" badge={jobs.length ? `${jobs.length} İŞ` : 'BOŞ'} badgeTone={jobs.length ? 'ok' : 'dim'} {...r.jobs} testId="jv-jobs">
        {jobs.length === 0 ? (
          <div className="jv-empty">ŞU AN SÜREN İŞ YOK</div>
        ) : (
          <ul className="jv-jobs">
            {jobs.map((j) => (
              <li key={j.id}>
                <i className={j.status} />
                <span>{j.title}</span>
                <em>{j.status === 'queued' ? 'SIRADA' : up(j.moduleId)}</em>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

export function CommsTab({ s, r, onOpen }: { s: HudSnapshot; r: { log: Rect; notices: Rect }; onOpen: (ref: string) => void }) {
  const notices = s.notices ?? [];
  return (
    <>
      <Panel tag="İLT.04" title="ASİSTAN GÜNLÜĞÜ" badge={`${s.log.length} KAYIT`} {...r.log} testId="jv-comms-log">
        <LogBody s={s} max={20} full onOpen={onOpen} />
      </Panel>
      <Panel tag="İLT.05" title="BİLDİRİMLER" badge={`${notices.filter((n) => n.pending).length} BEKLİYOR`} badgeTone={notices.some((n) => n.pending) ? 'warn' : 'ok'} {...r.notices} testId="jv-notices">
        {notices.length === 0 ? (
          <div className="jv-empty">BİLDİRİM YOK</div>
        ) : (
          <ul className="jv-notices">
            {notices.map((n) => (
              <li key={n.ref} className={n.pending ? 'is-pending' : ''} onClick={() => onOpen(n.ref)}>
                <header>
                  <time>{new Date(n.ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</time>
                  <em>{up(n.moduleId)}</em>
                </header>
                <b>{n.title}</b>
                {n.body && <p>{n.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
