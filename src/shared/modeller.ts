// Sağlayıcı başına varsayılan modeller (ana süreç geri düşmesi ve Ayarlar'da sağlayıcı değiştirme aynı tabloyu kullanır).
import type { ModelRolu, SaglayiciAdi } from './tipler';

export const VARSAYILAN_MODEL: Record<SaglayiciAdi, Record<ModelRolu, string>> = {
  anthropic: { ana: 'claude-opus-5-5', yardimci: 'claude-haiku-5-5' },
  openai: { ana: 'gpt-5.5', yardimci: 'gpt-5.5-mini' },
  openrouter: { ana: 'anthropic/claude-opus-5.5', yardimci: 'anthropic/claude-haiku-5.5' },
};
