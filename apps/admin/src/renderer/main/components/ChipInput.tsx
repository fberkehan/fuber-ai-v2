import { useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { t } from '@fuber/shared';
import { Chip, Input, enter, useMotionPreset } from '@fuber/ui';

/**
 * Söz listesi: Enter ya da virgülle eklenir, çipin çarpısıyla ya da boş alanda Geri tuşuyla silinir.
 * Uyandırma sözleri küçük harfle saklanır (politika sözleşmesi).
 */
export function ChipInput({
  id,
  values,
  onChange,
  placeholder,
  invalid,
}: {
  id?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [text, setText] = useState('');
  const preset = useMotionPreset(enter.pop);

  const commit = () => {
    const value = text.trim().toLocaleLowerCase('tr');
    setText('');
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && text === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('admin.brain.wake.listLabel')}>
          <AnimatePresence initial={false}>
            {values.map((value, index) => (
              <motion.li key={value} layout="position" {...preset}>
                <Chip
                  onRemove={() => onChange(values.filter((v) => v !== value))}
                  removeLabel={t('admin.brain.wake.remove', { phrase: value })}
                  title={index === 0 ? t('admin.brain.wake.primary') : undefined}
                >
                  {/* Varsayılan söz: beyaz hap (birincil eylem rengi) yerine nötr çip ve mavi nokta. */}
                  {index === 0 && <span aria-hidden className="mr-1.5 inline-block size-1.5 rounded-full bg-accent align-middle" />}
                  {value}
                </Chip>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <Input
        id={id}
        value={text}
        invalid={invalid}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        data-testid="wake-input"
      />
    </div>
  );
}
