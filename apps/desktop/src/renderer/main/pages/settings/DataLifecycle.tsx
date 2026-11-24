// Ayarlar › Gizlilik › Verileriniz: yedek al, yedekten geri yükle, yeni başla, verilerimi sil, bu bilgisayardan kaldır.
// v1'in kurgusu (Ayarlar → Veri): onay kipli pencere değil, satırın YERİNDE açılır; silinecekler tek tek yazılır;
// "Bunun geri alınamayacağını biliyorum" işaretlenmeden yıkıcı düğme kapalıdır; ilk odak "Vazgeç"te; Esc kapatır.
// "Verilerimi sil" ayrıca onay sözcüğünün yazılmasını ister. Kaldırmada veriyi saklama/silme seçilir, ardından veda ekranı.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Archive, ArrowCounterClockwise, ArrowsClockwise, Check, Trash, UploadSimple } from '@phosphor-icons/react';
import { t, WIPE_CONFIRM_WORD, type DataSummary, type RestartResult, type UninstallResult } from '@fuber/shared';
import { Button, Checkbox, cn, Input, spring, toast, useReducedMotion } from '@fuber/ui';
import { useShell } from '../../shell/context';
import { attempt, useEvent } from '../../shell/live';
import { Farewell } from '../../shell/Lifecycle';
import { Group, PathText, SettingRow } from './kit';

/** Kaldırma satırı: özel kaldırıcı gelene dek kapalı (yukarıdaki not). */
const UNINSTALL_ROW = false;

type Open = 'restore' | 'startOver' | 'wipe' | 'uninstall' | null;

const bytesText = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} GB` : `${Math.max(1, Math.round(bytes / 1e6)).toLocaleString('tr-TR')} MB`;

/** Satırın yerinde açılan onay kutusu. */
function Confirm({
  kind,
  title,
  items,
  children,
  action,
  danger,
  ready,
  busy,
  status,
  onConfirm,
  onCancel,
  openerSelector,
}: {
  kind: Exclude<Open, null>;
  title: string;
  items: string[];
  children?: ReactNode;
  action: string;
  danger?: boolean;
  ready: boolean;
  busy: boolean;
  status: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  openerSelector: string;
}) {
  const cancel = useRef<HTMLButtonElement | null>(null);
  const reduce = useReducedMotion() ?? false;
  useEffect(() => cancel.current?.focus(), []);
  const close = () => {
    if (busy) return;
    onCancel();
    requestAnimationFrame(() => document.querySelector<HTMLElement>(openerSelector)?.focus());
  };
  return (
    <motion.div
      role="group"
      aria-label={title}
      data-testid={`data-confirm-${kind}`}
      className={cn('mt-1 flex w-full flex-col gap-3.5 rounded-md bg-surface-2 px-5 py-4 shadow-raise', danger && 'shadow-[inset_0_0_0_1px_rgba(255,77,77,0.22)]')}
      initial={reduce ? { opacity: 0 } : { opacity: 0, transform: 'translateY(-4px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      transition={spring.smooth}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <b className="text-base font-medium text-fg">{title}</b>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-sm text-fg-muted">
            <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', danger ? 'bg-danger' : 'bg-fg-faint')} aria-hidden />
            {item}
          </li>
        ))}
      </ul>
      {children}
      {status && (
        <p className="text-sm text-fg-muted" role="status" data-testid="data-status">
          {status}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={danger ? 'danger' : 'primary'}
          size="sm"
          disabled={!ready}
          loading={busy}
          icon={danger ? <Trash weight="bold" /> : <Check weight="bold" />}
          onClick={onConfirm}
          data-testid={`data-confirm-${kind}-go`}
        >
          {action}
        </Button>
        <Button ref={cancel} variant="secondary" size="sm" disabled={busy} onClick={close} data-testid={`data-confirm-${kind}-cancel`}>
          {t('lifecycle.close.cancel')}
        </Button>
      </div>
    </motion.div>
  );
}

function Option({ selected, onSelect, title, hint, testId }: { selected: boolean; onSelect: () => void; title: string; hint: string; testId: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      data-testid={testId}
      className={cn(
        'flex flex-1 items-start gap-3 rounded-sm px-3.5 py-3 text-left outline-none transition-[background-color,box-shadow] duration-(--duration-fast) ease-out',
        'focus-visible:shadow-[0_0_0_2px_var(--color-accent-fg)]',
        selected ? 'bg-surface-4 shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'bg-surface-3 hover:bg-surface-4',
      )}
    >
      <span className={cn('mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full border', selected ? 'border-transparent bg-primary' : 'border-line-strong')} aria-hidden>
        {selected && <span className="size-1.5 rounded-full bg-on-primary" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="mt-0.5 block text-sm text-fg-muted">{hint}</span>
      </span>
    </button>
  );
}

export function DataLifecycle() {
  const shell = useShell();
  const [summary, setSummary] = useState<(DataSummary & { dataDir: string }) | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState<Open | 'backup'>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [word, setWord] = useState('');
  const [models, setModels] = useState(false);
  const [keepData, setKeepData] = useState(true);
  const [bye, setBye] = useState<UninstallResult | null>(null);

  const refresh = () => void window.fuber.invoke('lifecycle.summary').then(setSummary, () => {});
  useEffect(refresh, []);
  useEvent('memory.changed', refresh);

  const toggle = (next: Exclude<Open, null>) => {
    setOpen(open === next ? null : next);
    setAck(false);
    setWord('');
    setModels(false);
    setKeepData(true);
    setStatus(null);
  };
  const restartNote = (result: RestartResult) => setStatus(result.restart === 'auto' ? t('lifecycle.data.restarting') : t('lifecycle.data.manual'));
  const run = async <T,>(kind: Exclude<Open, null> | 'backup', work: () => Promise<T>): Promise<T | null> => {
    setBusy(kind);
    const result = await attempt(work);
    setBusy(null);
    return result;
  };

  const backup = async () => {
    const result = await run('backup', () => window.fuber.invoke('lifecycle.backup', {}));
    if (result) {
      setLastBackup(result.path);
      toast.success(t('lifecycle.data.backup.done'));
    }
  };
  const restore = async () => {
    const result = await run('restore', () => window.fuber.invoke('lifecycle.restore', {}));
    if (result) restartNote(result);
  };
  const startOver = async () => {
    const result = await run('startOver', () => window.fuber.invoke('lifecycle.startOver'));
    if (result) restartNote(result);
  };
  const wipe = async () => {
    const result = await run('wipe', () => window.fuber.invoke('lifecycle.wipe', { confirm: word, includeModels: models }));
    if (result) restartNote(result);
  };
  const uninstall = async () => {
    const result = await run('uninstall', () => window.fuber.invoke('lifecycle.uninstall', { keepData }));
    if (result) setBye(result);
  };

  const wordOk = word.trim().toLocaleUpperCase('tr-TR') === WIPE_CONFIRM_WORD;
  const facts: Array<[string, string]> = summary
    ? [
        [t('lifecycle.welcome.chats'), summary.chats.toLocaleString('tr-TR')],
        [t('lifecycle.welcome.memory'), summary.memory.toLocaleString('tr-TR')],
        ['fuber.db', bytesText(summary.dbBytes)],
      ]
    : [];

  return (
    <Group title={t('lifecycle.data.title')} description={t('lifecycle.data.hint')} keywords="yedek geri yükle sil kaldır sıfırla veri" testId="settings-data-lifecycle">
      {summary && (
        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-sm bg-line" data-testid="data-summary">
          {facts.map(([label, value]) => (
            <div key={label} className="bg-surface-2 px-4 py-3">
              <dt className="text-sm text-fg-faint">{label}</dt>
              <dd className="mt-0.5 text-lg tabular-nums text-fg">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <SettingRow
        label={t('lifecycle.data.backup')}
        description={t('lifecycle.data.backupHint')}
        note={lastBackup ? <PathText path={lastBackup} className="block text-fg" /> : undefined}
        noteTone="success"
        testId="data-row-backup"
      >
        <Button size="sm" icon={<Archive weight="bold" />} loading={busy === 'backup'} onClick={() => void backup()} data-testid="data-backup">
          {t('lifecycle.data.backup')}
        </Button>
      </SettingRow>
      <SettingRow
        label={t('lifecycle.data.restore')}
        description={t('lifecycle.data.restoreHint')}
        testId="data-row-restore"
        extra={
          open === 'restore' && (
            <Confirm
              kind="restore"
              title={t('lifecycle.data.restore.title')}
              items={[t('lifecycle.data.restore.l1'), t('lifecycle.data.restore.l2'), t('lifecycle.data.restore.l3')]}
              action={t('lifecycle.data.restore.action')}
              ready
              busy={busy === 'restore'}
              status={status}
              onConfirm={() => void restore()}
              onCancel={() => setOpen(null)}
              openerSelector="[data-testid=data-restore]"
            />
          )
        }
      >
        {open !== 'restore' && (
          <Button size="sm" icon={<UploadSimple weight="bold" />} onClick={() => toggle('restore')} data-testid="data-restore">
            {t('lifecycle.data.restore.button')}
          </Button>
        )}
      </SettingRow>
      <SettingRow
        label={t('lifecycle.data.startOver')}
        description={t('lifecycle.data.startOverHint')}
        testId="data-row-start-over"
        extra={
          open === 'startOver' && (
            <Confirm
              kind="startOver"
              title={t('lifecycle.data.startOver.title')}
              items={[t('lifecycle.data.startOver.l1'), t('lifecycle.data.startOver.l2'), t('lifecycle.data.startOver.l3'), t('lifecycle.data.startOver.l4')]}
              action={t('lifecycle.data.startOver.action')}
              ready
              busy={busy === 'startOver'}
              status={status}
              onConfirm={() => void startOver()}
              onCancel={() => setOpen(null)}
              openerSelector="[data-testid=data-start-over]"
            />
          )
        }
      >
        {open !== 'startOver' && (
          <Button size="sm" icon={<ArrowsClockwise weight="bold" />} onClick={() => toggle('startOver')} data-testid="data-start-over">
            {t('lifecycle.data.startOver')}
          </Button>
        )}
      </SettingRow>
      <SettingRow
        label={t('lifecycle.wipe')}
        description={t('lifecycle.wipeHint')}
        testId="data-row-wipe"
        extra={
          open === 'wipe' && (
            <Confirm
              kind="wipe"
              danger
              title={t('lifecycle.wipe.title')}
              items={[t('lifecycle.wipe.l1'), t('lifecycle.wipe.l2'), t('lifecycle.wipe.l3'), t('lifecycle.wipe.l4')]}
              action={t('lifecycle.wipe.action')}
              ready={ack && wordOk}
              busy={busy === 'wipe'}
              status={status}
              onConfirm={() => void wipe()}
              onCancel={() => setOpen(null)}
              openerSelector="[data-testid=data-wipe]"
            >
              <p className="text-sm text-fg-faint">{t('lifecycle.data.docsKept')}</p>
              <Checkbox checked={models} onCheckedChange={setModels} label={t('lifecycle.wipe.models')} data-testid="data-wipe-models" />
              <Checkbox checked={ack} onCheckedChange={setAck} label={t('lifecycle.data.ack')} data-testid="data-wipe-ack" />
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-fg-muted">{t('lifecycle.wipe.type', { word: WIPE_CONFIRM_WORD })}</span>
                <Input
                  size="sm"
                  value={word}
                  onChange={(event) => setWord(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  invalid={word.length > 0 && !wordOk}
                  frameClassName="w-44"
                  className="font-mono tracking-[0.2em]"
                  data-testid="data-wipe-word"
                />
              </label>
            </Confirm>
          )
        }
      >
        {open !== 'wipe' && (
          <Button size="sm" variant="danger" icon={<Trash weight="bold" />} onClick={() => toggle('wipe')} data-testid="data-wipe">
            {t('lifecycle.wipe')}
          </Button>
        )}
      </SettingRow>
      {/* Kaldırma satırı GİZLİ (demo.4): "verilerimi de sil" seçeneği özel kaldırıcının (`--verileri-sil`) işiydi; özel
          kurulum/kaldırma programı bu sürüme alınmadı, standart NSIS kaldırıcısı o bayrağı tanımaz. Windows'un "Uygulamalar"
          listesinden kaldırma çalışır. */}
      {UNINSTALL_ROW && (
      <SettingRow
        label={t('lifecycle.uninstall')}
        description={t('lifecycle.uninstallHint')}
        testId="data-row-uninstall"
        extra={
          open === 'uninstall' && (
            <Confirm
              kind="uninstall"
              danger
              title={t('lifecycle.uninstall.title')}
              items={[]}
              action={t('lifecycle.uninstall.action')}
              ready={ack}
              busy={busy === 'uninstall'}
              status={status}
              onConfirm={() => void uninstall()}
              onCancel={() => setOpen(null)}
              openerSelector="[data-testid=data-uninstall]"
            >
              <div role="radiogroup" aria-label={t('lifecycle.uninstall.title')} className="flex flex-col gap-2 sm:flex-row">
                <Option selected={keepData} onSelect={() => setKeepData(true)} title={t('lifecycle.uninstall.keep')} hint={t('lifecycle.uninstall.keepHint')} testId="data-uninstall-keep" />
                <Option selected={!keepData} onSelect={() => setKeepData(false)} title={t('lifecycle.uninstall.delete')} hint={t('lifecycle.uninstall.deleteHint')} testId="data-uninstall-delete" />
              </div>
              <p className="text-sm text-fg-faint">{t('lifecycle.data.docsKept')}</p>
              <Checkbox checked={ack} onCheckedChange={setAck} label={t('lifecycle.data.ack')} data-testid="data-uninstall-ack" />
            </Confirm>
          )
        }
      >
        {open !== 'uninstall' && (
          <Button size="sm" variant="danger" icon={<Trash weight="bold" />} onClick={() => toggle('uninstall')} data-testid="data-uninstall">
            {t('lifecycle.uninstall.button')}
          </Button>
        )}
      </SettingRow>
      )}
      {createPortal(
      <AnimatePresence>
        {bye && (
          <Farewell
            ms={600}
            dim={0.6}
            testId="uninstall-bye"
            title={shell.address ? t('lifecycle.uninstall.byeTitle', { address: shell.address }) : t('lifecycle.uninstall.byeTitlePlain')}
          >
            <p className="mt-3 max-w-[460px] text-center text-base text-fg-muted">
              {keepData ? t('lifecycle.uninstall.byeKeep', { name: shell.name }) : t('lifecycle.uninstall.byeDelete')}
            </p>
            {!bye.executed && (
              <div className="mt-10 flex max-w-[620px] flex-col items-center gap-3 rounded-md bg-surface-1 px-5 py-4 text-center shadow-raise" data-testid="uninstall-dev">
                <span className="text-sm text-fg-faint">{t('lifecycle.uninstall.dev')}</span>
                <code className="font-mono text-sm break-all text-fg" data-selectable data-testid="uninstall-command">
                  "{bye.command}" {bye.args.join(' ')}
                </code>
                <Button size="sm" icon={<ArrowCounterClockwise weight="bold" />} onClick={() => setBye(null)} data-testid="uninstall-dev-close">
                  {t('lifecycle.close.cancel')}
                </Button>
              </div>
            )}
          </Farewell>
        )}
      </AnimatePresence>,
      document.body,
      )}
    </Group>
  );
}
