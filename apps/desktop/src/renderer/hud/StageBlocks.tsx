import { CheckCircle, Circle, LinkSimple } from '@phosphor-icons/react';
import { t, type StageBlock } from '@fuber/shared';
import { ProgressBar, cn } from '@fuber/ui';
import { quiet } from './use-hud';

/**
 * Sahne kartının gövde blokları. Tek kart dili: 13 px gövde, ince çizgiyle ayrılan satırlar, sayılar tabular.
 * İşaretli liste (en az bir öğede `checked` alanı varsa) üstte ilerleme çubuğu taşır.
 */
export function StageBlockView({ block }: { block: StageBlock }) {
  switch (block.type) {
    case 'text':
      return <p className="text-sm whitespace-pre-line text-fg-muted" data-selectable>{block.text}</p>;

    case 'keyValue':
      return (
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] text-sm [&_dd]:pl-6" data-block="keyValue">
          {block.rows.map((row, index) => (
            <div key={`${row.label}-${index}`} className="contents">
              <dt className={cn('py-2 text-fg-muted', index > 0 && 'border-t border-line')}>{row.label}</dt>
              <dd className={cn('py-2 text-right font-medium text-fg tabular-nums', index > 0 && 'border-t border-line')} data-selectable>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      );

    case 'list': {
      const checklist = block.items.some((item) => item.checked !== undefined);
      const done = block.items.filter((item) => item.checked).length;
      return (
        <div className="flex flex-col gap-2" data-block={checklist ? 'checklist' : 'list'}>
          {checklist ? (
            <ProgressBar
              value={block.items.length ? done / block.items.length : 0}
              tone={done === block.items.length ? 'success' : 'accent'}
              size="sm"
              label={<span className="text-xs text-fg-muted">{t('hud.stage.progress', { done, total: block.items.length })}</span>}
            />
          ) : null}
          <ul className="flex flex-col">
            {block.items.map((item, index) => (
              <li key={index} className="flex items-start gap-2.5 border-t border-line py-2 text-sm first:border-t-0">
                {checklist ? (
                  <span className={cn('mt-0.5 shrink-0 [&_svg]:size-4', item.checked ? 'text-success' : 'text-fg-faint')} aria-hidden>
                    {item.checked ? <CheckCircle weight="fill" /> : <Circle weight="bold" />}
                  </span>
                ) : (
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-fg-faint" aria-hidden />
                )}
                <span className="flex min-w-0 grow flex-col">
                  <span className={cn('text-fg', item.checked && 'text-fg-muted line-through decoration-fg-faint')}>{item.title}</span>
                  {item.detail ? <span className="text-xs text-fg-muted">{item.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    }

    case 'table':
      return (
        <div className="-mx-1 overflow-x-auto" data-block="table">
          <table className="w-full border-collapse text-sm tabular-nums">
            <thead>
              <tr>
                {block.columns.map((column, index) => (
                  <th key={index} className={cn('px-1 pb-2 text-left text-xs font-medium text-fg-muted', index > 0 && 'text-right')}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-line">
                  {row.map((cell, index) => (
                    <td key={index} className={cn('px-1 py-2 text-fg', index > 0 && 'text-right')} data-selectable>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'image':
      // Yalnız gömülü görüntü: sahne sayfasının içerik politikası dış adresi zaten yüklemez.
      return block.src.startsWith('data:image/') ? (
        <img src={block.src} alt={block.alt} className="max-h-60 w-full rounded-sm object-contain" />
      ) : (
        <p className="text-sm text-fg-muted">{block.alt}</p>
      );

    case 'code':
      return (
        <pre className="max-h-56 overflow-auto rounded-sm bg-surface-1 p-3 font-mono text-xs leading-5 text-fg-muted" data-selectable>
          {block.code}
        </pre>
      );

    case 'link':
      return (
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-xs text-sm text-accent-fg hover:underline [&_svg]:size-4"
          onClick={() => void quiet(window.fuber.invoke('app.openExternal', { url: block.url }))}
          title={block.url}
        >
          <LinkSimple weight="bold" aria-hidden />
          {block.label}
        </button>
      );

    default:
      return null;
  }
}
