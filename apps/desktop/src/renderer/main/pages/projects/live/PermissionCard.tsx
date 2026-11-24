// İzin kartı (v1 `IzinKarti.tsx`): Claude Code bir araç için izin istiyor. İzin ver / bu oturumda hep izin ver / reddet (neden
// yazılabilir); AskUserQuestion soruları (tek/çoklu seçim + "Diğer" serbest metin); ExitPlanMode planı okunur gösterilir.
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@fuber/shared';
import { Button, Input, cn } from '@fuber/ui';
import { Check, ChatCircleDots, PaperPlaneRight, ShieldWarning, X } from '@phosphor-icons/react';
import type { AskQuestion, LiveOpResult, LivePermissionAnswer, PermissionRequestEvent } from '../../../../../main/modules/projects/claude/types';
import { Markdown } from '../../chat/markdown';
import { errorText, fuber } from '../shared';
import { FoldedText } from './controls';
import { toolDiff } from './diff';
import { DiffView } from './DiffView';
import { inputText, permissionTitle, relativePath } from './format';

type Answer = (answer: LivePermissionAnswer) => Promise<LiveOpResult>;
const openLink = (url: string) => void fuber().invoke('app.openExternal', { url }).catch(() => {});

function Preview({ request, cwd }: { request: PermissionRequestEvent; cwd: string }) {
  const diff = useMemo(() => (request.kind === 'edit' ? toolDiff(request.tool, request.input) : null), [request]);
  const file = inputText(request.input, 'file_path') || inputText(request.input, 'notebook_path');
  if (request.kind === 'plan') {
    const plan = inputText(request.input, 'plan');
    return plan ? (
      <div className="max-h-[40vh] overflow-auto rounded-sm bg-surface-2 px-4 py-3">
        <Markdown text={plan} onLink={openLink} className="text-sm" />
      </div>
    ) : null;
  }
  if (diff) {
    return (
      <div className="flex flex-col gap-1.5">
        {file && (
          <span className="font-mono text-xs break-all text-fg-muted" data-selectable>
            {relativePath(file, cwd)}
          </span>
        )}
        <div className="max-h-[26vh] overflow-auto rounded-sm">
          <DiffView lines={diff.lines} limit={24} />
        </div>
      </div>
    );
  }
  if (request.kind === 'shell') {
    const command = inputText(request.input, 'command');
    const note = inputText(request.input, 'description');
    return (
      <div className="flex flex-col gap-1.5">
        {note && <span className="text-xs text-fg-muted">{note}</span>}
        <FoldedText text={command || request.summary} limit={8} />
      </div>
    );
  }
  return request.summary ? (
    <p className="font-mono text-xs break-all text-fg-muted" data-selectable>
      {request.summary}
    </p>
  ) : null;
}

function Hints({ request }: { request: PermissionRequestEvent }) {
  // Claude Code'un kendi cümlesi (İngilizce olabilir) ve nedeni yalnız ipucu olarak.
  // Kendi izin cümlesi ("Claude Write kullanmak istiyor") kartın başlığını yineler: yazılmaz.
  const lines = [request.description, request.reason].filter((line): line is string => Boolean(line));
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5 text-xs text-fg-faint" data-selectable>
      {lines.map((line, index) => (
        <span key={index}>{line}</span>
      ))}
    </div>
  );
}

export function PermissionCard({ request, cwd, onAnswer }: { request: PermissionRequestEvent; cwd: string; onAnswer: Answer }) {
  if (request.kind === 'question' && request.questions?.length) return <QuestionCard request={request} onAnswer={onAnswer} />;
  return <ToolPermissionCard request={request} cwd={cwd} onAnswer={onAnswer} />;
}

function ToolPermissionCard({ request, cwd, onAnswer }: { request: PermissionRequestEvent; cwd: string; onAnswer: Answer }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState('');
  const allowRef = useRef<HTMLButtonElement | null>(null);
  const denyRef = useRef<HTMLButtonElement | null>(null);

  // Tek tuşla onaylanmasın isteniyorsa odak "Reddet"te açılır.
  useEffect(() => {
    (request.defaultNo ? denyRef : allowRef).current?.focus({ preventScroll: true });
  }, [request.requestId, request.defaultNo]);

  const answer = async (payload: LivePermissionAnswer) => {
    setBusy(true);
    setError('');
    try {
      const result = await onAnswer(payload);
      if (!result.ok) {
        setError(result.error ?? '');
        setBusy(false);
      }
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  };

  return (
    <section
      data-testid={`live-permission-${request.requestId}`}
      data-permission-tool={request.tool}
      aria-label={t('projects.live.permission.label')}
      // Dikkat kartı (ortak dil): kehribar kıl payı çerçeve, üstten hafif ışık ve kalkan simgesi; kalın kenar çizgisi yok.
      data-attention=""
      className="ui-card flex flex-col gap-3 rounded-md border border-line bg-surface-1 px-5 py-4"
    >
      <header className="flex items-center gap-2 text-sm">
        <ShieldWarning weight="fill" className="size-4 shrink-0 text-warning" aria-hidden />
        <span className="font-medium text-fg">{permissionTitle(request)}</span>
        {request.agentId && <span className="ml-auto truncate text-xs text-fg-faint">{t('projects.live.permission.fromAgent', { agent: request.agentId })}</span>}
      </header>
      <Preview request={request} cwd={cwd} />
      {request.truncated && <p className="text-xs text-fg-faint">{t('projects.live.tool.inputTruncated')}</p>}
      <Hints request={request} />
      {reasonOpen && (
        <Input
          size="sm"
          autoFocus
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void answer({ decision: 'deny', ...(reason.trim() ? { reason: reason.trim() } : {}) });
          }}
          placeholder={t('projects.live.permission.reasonPlaceholder')}
          aria-label={t('projects.live.permission.reasonPlaceholder')}
          data-testid="live-deny-reason"
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {/* Sıra: "İzin ver" (beyaz hap), "Reddet" (koyu hap) ve ona bağlı "Neden yaz"; "Bu oturumda hep izin ver" sağda ayrı durur. */}
        <Button ref={allowRef} size="sm" variant="primary" icon={<Check />} disabled={busy} data-testid="live-allow" onClick={() => void answer({ decision: 'allow' })}>
          {request.kind === 'plan' ? t('projects.live.permission.approvePlan') : t('projects.live.permission.allow')}
        </Button>
        <Button
          ref={denyRef}
          size="sm"
          variant="secondary"
          icon={<X />}
          disabled={busy}
          data-testid="live-deny"
          onClick={() => void answer({ decision: 'deny', ...(reason.trim() ? { reason: reason.trim() } : {}) })}
        >
          {t('projects.live.permission.deny')}
        </Button>
        {!reasonOpen && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReasonOpen(true)}>
            {t('projects.live.permission.addReason')}
          </Button>
        )}
        {request.canAlways && (
          <Button size="sm" variant="secondary" className="ml-auto" disabled={busy} data-testid="live-always" onClick={() => void answer({ decision: 'always' })}>
            {t('projects.live.permission.always')}
          </Button>
        )}
      </div>
    </section>
  );
}

/** Yarım kalan seçimler oturum değiştirilip dönülünce kaybolmasın. */
const questionDrafts = new Map<string, { picked: Record<string, string[]>; free: Record<string, string>; other: string[] }>();

function QuestionCard({ request, onAnswer }: { request: PermissionRequestEvent; onAnswer: Answer }) {
  const questions: AskQuestion[] = request.questions ?? [];
  const draft = questionDrafts.get(request.requestId);
  const [picked, setPicked] = useState<Record<string, string[]>>(draft?.picked ?? {});
  const [free, setFree] = useState<Record<string, string>>(draft?.free ?? {});
  const [other, setOther] = useState<Set<string>>(new Set(draft?.other ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    questionDrafts.set(request.requestId, { picked, free, other: [...other] });
    while (questionDrafts.size > 20) questionDrafts.delete(questionDrafts.keys().next().value as string);
  }, [request.requestId, picked, free, other]);

  const answered = (item: AskQuestion) => (other.has(item.question) ? Boolean(free[item.question]?.trim()) : (picked[item.question]?.length ?? 0) > 0);
  const ready = questions.every(answered);

  const pick = (item: AskQuestion, label: string) => {
    if (!item.multiSelect && other.has(item.question)) {
      setOther((current) => {
        const next = new Set(current);
        next.delete(item.question);
        return next;
      });
    }
    setPicked((current) => {
      const before = current[item.question] ?? [];
      const next = item.multiSelect ? (before.includes(label) ? before.filter((value) => value !== label) : [...before, label]) : [label];
      return { ...current, [item.question]: next };
    });
  };

  const toggleOther = (item: AskQuestion) => {
    setOther((current) => {
      const next = new Set(current);
      if (next.has(item.question)) next.delete(item.question);
      else next.add(item.question);
      return next;
    });
    if (!item.multiSelect) setPicked((current) => ({ ...current, [item.question]: [] }));
  };

  const send = async (decision: 'allow' | 'deny') => {
    setBusy(true);
    setError('');
    const answers: Record<string, string | string[]> = {};
    for (const item of questions) {
      answers[item.question] = other.has(item.question) ? (free[item.question]?.trim() ?? '') : item.multiSelect ? (picked[item.question] ?? []) : (picked[item.question]?.[0] ?? '');
    }
    try {
      const result = await onAnswer(decision === 'deny' ? { decision: 'deny' } : { decision: 'allow', answers, freeText: [...other] });
      if (!result.ok) {
        setError(result.error ?? '');
        setBusy(false);
      }
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  };

  return (
    <section
      data-testid={`live-permission-${request.requestId}`}
      data-permission-tool={request.tool}
      aria-label={t('projects.live.question.label')}
      className="ui-card flex flex-col gap-3 rounded-md border border-line bg-surface-1 px-5 py-4"
    >
      <header className="flex items-center gap-2 text-sm">
        <ChatCircleDots weight="fill" className="size-4 shrink-0 text-accent-fg" aria-hidden />
        <span className="font-medium text-fg">{t('projects.live.question.label')}</span>
      </header>
      {questions.map((item, index) => {
        const isOther = other.has(item.question);
        return (
          <fieldset key={index} className="flex flex-col gap-2">
            <legend className="flex flex-wrap items-center gap-2 text-sm text-fg">
              {item.header && <span className="rounded-xs bg-surface-4 px-1.5 py-0.5 text-xs text-fg-muted">{item.header}</span>}
              <span className="font-medium">{item.question}</span>
              {item.multiSelect && <span className="text-xs text-fg-faint">{t('projects.live.question.multi')}</span>}
            </legend>
            <div role={item.multiSelect ? 'group' : 'radiogroup'} aria-label={item.question} className="flex flex-col gap-1">
              {item.options.map((option) => {
                const checked = (picked[item.question] ?? []).includes(option.label) && !(isOther && !item.multiSelect);
                return (
                  <OptionButton key={option.label} multi={item.multiSelect} checked={checked} disabled={busy} label={option.label} description={option.description} onClick={() => pick(item, option.label)} />
                );
              })}
              <OptionButton multi={item.multiSelect} checked={isOther} disabled={busy} label={t('projects.live.question.other')} onClick={() => toggleOther(item)} />
            </div>
            {isOther && (
              <Input
                size="sm"
                value={free[item.question] ?? ''}
                disabled={busy}
                onChange={(event) => setFree((current) => ({ ...current, [item.question]: event.target.value }))}
                placeholder={t('projects.live.question.otherPlaceholder')}
                aria-label={t('projects.live.question.otherPlaceholder')}
              />
            )}
          </fieldset>
        );
      })}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" icon={<PaperPlaneRight />} disabled={busy || !ready} data-testid="live-allow" onClick={() => void send('allow')}>
          {t('projects.live.question.answer')}
        </Button>
        <Button size="sm" variant="secondary" icon={<X />} disabled={busy} data-testid="live-deny" onClick={() => void send('deny')}>
          {t('projects.live.question.skip')}
        </Button>
      </div>
    </section>
  );
}

function OptionButton({ multi, checked, disabled, label, description, onClick }: { multi: boolean; checked: boolean; disabled: boolean; label: string; description?: string | undefined; onClick(): void }) {
  return (
    <button
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      data-option={label}
      className={cn(
        'flex items-start gap-2.5 rounded-sm border px-3 py-2 text-left text-sm transition-colors duration-(--duration-fast)',
        checked ? 'border-accent-fg bg-accent-soft text-fg' : 'border-line bg-surface-1 text-fg-muted hover:border-line-strong',
      )}
    >
      <span aria-hidden className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center border border-line-strong', multi ? 'rounded-xs' : 'rounded-full', checked && 'border-accent-fg bg-accent text-fg')}>
        {checked && <Check weight="bold" className="size-3" />}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-medium text-fg">{label}</span>
        {description && <span className="text-xs text-fg-muted">{description}</span>}
      </span>
    </button>
  );
}
