import { describe, expect, it } from 'vitest';
import type { TtsDevice } from '@fuber/shared';
import { hostNoticeAction } from './tts-settings';

type Phase = 'off' | 'starting' | 'ready' | 'failed';
const st = (phase: Phase, device: TtsDevice | null, attempts: number, missingFiles = false) => ({
  phase,
  device,
  attempts: Array.from({ length: attempts }, (_, i) => ({ i })),
  missingFiles,
});

// Görülen belirti: "ses modelleri kayıyor" + bu düşüşün her çırpınmada yüksek sesle duyurulması. Burada düşüş
// bildiriminin kuralı doğrulanır: BİR KEZ bildir, aynı düşüşü yineleme, seçilen cihaza dönüşü her seferinde duyurma.
describe('ses konağı düşüş bildirimi: hostNoticeAction', () => {
  it('ekran kartı cihazından işlemciye ilk düşüş: bir kez bildirilir', () => {
    const action = hostNoticeAction({ phase: 'starting' }, st('ready', 'cpu', 1), null);
    expect(action).toEqual({ kind: 'notify', key: 'cpu', messageKey: 'tts.fallback.toCpu' });
  });

  it('aynı düşüş (işlemci) yinelenince yeniden bildirilmez', () => {
    const action = hostNoticeAction({ phase: 'starting' }, st('ready', 'cpu', 1), 'cpu');
    expect(action).toEqual({ kind: 'none' });
  });

  it('CUDA başarısız, DirectML ile hazır: ekran kartında kaldığı bir kez bildirilir', () => {
    const action = hostNoticeAction({ phase: 'starting' }, st('ready', 'directml', 1), null);
    expect(action).toEqual({ kind: 'notify', key: 'directml', messageKey: 'tts.fallback.toDirectml' });
  });

  it('hiçbir cihazda açılamadı (failed): Piper bir kez bildirilir; dosyalar eksikse bildirilmez', () => {
    expect(hostNoticeAction(null, st('failed', null, 2), null)).toEqual({ kind: 'notify', key: 'failed', messageKey: 'tts.fallback.toPiper' });
    expect(hostNoticeAction(null, st('failed', null, 0, true), null)).toEqual({ kind: 'none' });
    expect(hostNoticeAction(null, st('failed', null, 2), 'failed')).toEqual({ kind: 'none' });
  });

  it('seçilen ekran kartı cihazına temiz dönüş: duyurulmaz; kilidi açmak için say (recover)', () => {
    // Düşüş bildirilmişti (lastKey='cpu'): CUDA'ya temiz dönüşte duyuru YOK, yalnız kararlılık sayımı başlar.
    expect(hostNoticeAction({ phase: 'starting' }, st('ready', 'cuda', 0), 'cpu')).toEqual({ kind: 'recover' });
    // Hiç düşüş yoksa (ilk açılış, temiz): yapılacak bir şey yok.
    expect(hostNoticeAction({ phase: 'starting' }, st('ready', 'cuda', 0), null)).toEqual({ kind: 'none' });
  });

  it('seçim ekran kartı sesi ve ilk cihaz CPU ise (gpu değil) temiz hazır bir düşüş sayılmaz', () => {
    // Zaten en alttayız: ne bildirim ne recover.
    expect(hostNoticeAction({ phase: 'starting' }, st('ready', 'cpu', 0), null)).toEqual({ kind: 'none' });
  });

  it('zaten hazırken gelen durum güncellemesi (before de ready) düşüş saymaz', () => {
    expect(hostNoticeAction({ phase: 'ready' }, st('ready', 'cpu', 1), null)).toEqual({ kind: 'none' });
  });
});
