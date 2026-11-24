// JARVIS ayarı: hava şehri ve piyasa izleme listesi (kalıcı; ana süreçte `jarvis_state`).
import { useState } from 'react';
import type { FinWatch, JarvisConfig } from '../../../../main/modules/jarvis/types';

export function JarvisSettings({ config, onSave, onClose }: { config: JarvisConfig; onSave: (patch: { city: string | null; watchlist: FinWatch[]; focus: string }) => void; onClose: () => void }) {
  const [city, setCity] = useState(config.city ?? '');
  const [rows, setRows] = useState<FinWatch[]>(config.watchlist);
  const set = (i: number, patch: Partial<FinWatch>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  return (
    <div className="jv-modal" role="dialog" aria-label="JARVIS ayarı" data-testid="jv-settings">
      <div className="jv-modal-card">
        <header>
          <b>AYAR</b>
          <button type="button" onClick={onClose} className="jv-btn">
            KAPAT
          </button>
        </header>
        <label className="jv-field">
          <span>HAVA ŞEHRİ (BOŞ: UYGULAMA AYARI, O DA YOKSA IP KONUMU)</span>
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="İstanbul" maxLength={80} />
        </label>
        <div className="jv-field">
          <span>PİYASA İZLEME LİSTESİ (EN ÇOK 12)</span>
          <div className="jv-wl">
            {rows.map((w, i) => (
              <div key={i} className="jv-wl-row">
                <input value={w.sym} onChange={(e) => set(i, { sym: e.target.value.toUpperCase(), name: e.target.value.toUpperCase() })} aria-label="Kısa ad" maxLength={16} />
                <input value={w.ticker} onChange={(e) => set(i, { ticker: e.target.value })} aria-label="Sembol" maxLength={24} />
                <select value={w.source} onChange={(e) => set(i, { source: e.target.value as FinWatch['source'] })} aria-label="Kaynak">
                  <option value="yahoo">YAHOO</option>
                  <option value="binance">BINANCE</option>
                </select>
                <input value={w.currency} onChange={(e) => set(i, { currency: e.target.value.toUpperCase() })} aria-label="Para birimi" maxLength={6} />
                <button type="button" className="jv-btn" onClick={() => setRows((r) => r.filter((_, k) => k !== i))} aria-label="Sil">
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="jv-btn" disabled={rows.length >= 12} onClick={() => setRows((r) => [...r, { sym: 'YENİ', name: 'YENİ', source: 'yahoo', ticker: '', currency: 'USD' }])}>
            + EKLE
          </button>
        </div>
        <footer>
          <button
            type="button"
            className="jv-btn primary"
            onClick={() => {
              const clean = rows.filter((w) => w.sym.trim() && w.ticker.trim());
              onSave({
                city: city.trim() || null,
                watchlist: clean,
                focus: clean.some((w) => w.sym === config.focus) ? config.focus : (clean[0]?.sym ?? 'BTC'),
              });
              onClose();
            }}
          >
            KAYDET
          </button>
        </footer>
      </div>
    </div>
  );
}
