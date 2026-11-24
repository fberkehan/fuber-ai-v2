// Küçük, güvenli Markdown işleyicisi: paragraf, başlık (kalın satır), liste, kod bloğu, satır içi kod,
// kalın/eğik, bağlantı. HTML hiç basılmaz (React metni kaçırır); bağlantı yalnız http(s) ise düğme olur ve
// ana süreçteki `app.openExternal` ile varsayılan tarayıcıda açılır.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { cn } from '@fuber/ui';

export type Block =
  | { type: 'p'; text: string }
  | { type: 'h'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[]; start: number }
  | { type: 'code'; lang: string; code: string }
  | { type: 'quote'; text: string };

/** Metni bloklara böler. Akış sırasında kapanmamış kod bloğu da kod bloğu sayılır (yarım haliyle görünür). */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) code.push(lines[i++]!);
      i++;
      blocks.push({ type: 'code', lang: fence[1] ?? '', code: code.join('\n') });
      continue;
    }
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'h', text: heading[1]!.trim() });
      i++;
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*[-*•]\s+/, ''));
      blocks.push({ type: 'ul', items });
      continue;
    }
    const ordered = /^\s*(\d{1,3})[.)]\s+/.exec(line);
    if (ordered) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d{1,3}[.)]\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*\d{1,3}[.)]\s+/, ''));
      blocks.push({ type: 'ol', items, start: Number(ordered[1]) });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', text: quote.join(' ') });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]!) &&
      !/^\s*```/.test(lines[i]!) &&
      !/^\s*[-*•]\s+/.test(lines[i]!) &&
      !/^\s*\d{1,3}[.)]\s+/.test(lines[i]!) &&
      !/^\s{0,3}#{1,6}\s+/.test(lines[i]!)
    ) {
      para.push(lines[i++]!);
    }
    blocks.push({ type: 'p', text: para.join('\n') });
  }
  return blocks;
}

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'link'; text: string; url: string };

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|((?<![\w*])\*[^*\s][^*\n]*\*(?![\w*]))/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ type: 'text', text: text.slice(last, index) });
    const [all, code, strong, link, linkUrl, bare, em] = match;
    if (code) out.push({ type: 'code', text: code.slice(1, -1) });
    else if (strong) out.push({ type: 'strong', children: parseInline(strong.slice(2, -2)) });
    else if (link && linkUrl) out.push({ type: 'link', text: link.slice(1, link.indexOf('](')), url: linkUrl });
    else if (bare) out.push({ type: 'link', text: bare, url: bare });
    else if (em) out.push({ type: 'em', children: parseInline(em.slice(1, -1)) });
    last = index + all.length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/**
 * Akan yanıtta yeni sözcükler yumuşakça belirir: sözcükler sırayla sayılır, `fadeFrom`'dan sonrakiler
 * tek seferlik saydamlık animasyonu alır. Var olan sözcüklerin anahtarı değişmez, yeniden oynamaz.
 */
interface Counter {
  n: number;
  fadeFrom: number;
}

function words(text: string, counter: Counter): ReactNode[] {
  return text.split(/(\s+)/).map((part, index) => {
    if (part === '' || /^\s+$/.test(part)) return <Fragment key={`s${index}`}>{part}</Fragment>;
    const n = counter.n++;
    return (
      <span key={`w${n}`} className={n >= counter.fadeFrom ? 'fuber-word-in' : undefined}>
        {part}
      </span>
    );
  });
}

function renderInline(nodes: Inline[], counter: Counter, onLink: (url: string) => void): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={index}>{words(node.text, counter)}</Fragment>;
      case 'code':
        return (
          <code key={index} className="rounded-xs bg-surface-4 px-1.5 py-px font-mono text-[0.9em] text-fg">
            {node.text}
          </code>
        );
      case 'strong':
        return (
          <strong key={index} className="font-semibold text-fg">
            {renderInline(node.children, counter, onLink)}
          </strong>
        );
      case 'em':
        return (
          <em key={index} className="italic">
            {renderInline(node.children, counter, onLink)}
          </em>
        );
      case 'link':
        return (
          <button
            key={index}
            type="button"
            onClick={() => onLink(node.url)}
            title={node.url}
            className="cursor-pointer text-accent-fg underline decoration-accent-fg/40 underline-offset-[3px] transition-colors duration-(--duration-fast) hover:decoration-accent-fg"
          >
            {words(node.text, counter)}
          </button>
        );
    }
  });
}

/** Kod bloğu: üstte dil ve kopyala düğmesi; gövde yatayda kayar, satır kırılmaz. */
function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <div className="chat-code" data-testid="msg-code">
      <div className="chat-code-head">
        <span className="font-mono">{lang || t('chat.code')}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-xs px-2 text-xs text-fg-muted transition-colors duration-(--duration-fast) hover:bg-surface-4 hover:text-fg active:scale-[0.97]"
        >
          {copied ? <Check className="size-3.5 text-success" weight="bold" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? t('common.copied') : t('common.copy')}
        </button>
      </div>
      <pre className="font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** `Markdown`'ın saydığı sözcük sayısı (aynı kural): akışta bir sonraki parçanın belirmeye başladığı yer. */
export function countWords(text: string): number {
  const inline = (nodes: Inline[]): number =>
    nodes.reduce((sum, node) => {
      if (node.type === 'text' || node.type === 'link') return sum + node.text.split(/\s+/).filter(Boolean).length;
      if (node.type === 'strong' || node.type === 'em') return sum + inline(node.children);
      return sum;
    }, 0);
  return parseBlocks(text).reduce((sum, block) => {
    if (block.type === 'code') return sum;
    if (block.type === 'ul' || block.type === 'ol') return sum + block.items.reduce((s, item) => s + inline(parseInline(item)), 0);
    return sum + inline(parseInline(block.text));
  }, 0);
}

export function Markdown({
  text,
  fadeFrom = Number.POSITIVE_INFINITY,
  onLink,
  className,
}: {
  text: string;
  /** Bu sıradaki sözcükten sonrakiler belirerek gelir (akış). */
  fadeFrom?: number;
  onLink: (url: string) => void;
  className?: string;
}) {
  const counter: Counter = { n: 0, fadeFrom };
  const blocks = parseBlocks(text);
  return (
    <div className={cn('flex flex-col gap-3 text-fg', className)} data-selectable>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'p':
            return (
              <p key={index} className="whitespace-pre-wrap">
                {renderInline(parseInline(block.text), counter, onLink)}
              </p>
            );
          case 'h':
            return (
              <p key={index} className="font-semibold text-fg">
                {renderInline(parseInline(block.text), counter, onLink)}
              </p>
            );
          case 'quote':
            return (
              <p key={index} className="border-l-2 border-line-strong pl-3 text-fg-muted">
                {renderInline(parseInline(block.text), counter, onLink)}
              </p>
            );
          case 'ul':
          case 'ol': {
            const Tag = block.type === 'ul' ? 'ul' : 'ol';
            return (
              <Tag
                key={index}
                start={block.type === 'ol' ? block.start : undefined}
                className={cn('flex flex-col gap-1.5 pl-6', block.type === 'ul' ? 'list-disc' : 'list-decimal', 'marker:text-fg-faint')}
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="pl-1">
                    {renderInline(parseInline(item), counter, onLink)}
                  </li>
                ))}
              </Tag>
            );
          }
          case 'code':
            return <CodeBlock key={index} lang={block.lang} code={block.code} />;
        }
      })}
    </div>
  );
}
