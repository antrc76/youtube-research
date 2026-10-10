import React from 'react';

function escRx(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hl(text: string, query?: string): React.ReactNode {
  if (!query || !text) return text;
  const parts = text.split(new RegExp(`(${escRx(query)})`, 'gi'));
  if (parts.length === 1) return text;
  return parts.map((p, i) =>
    p.toLowerCase() === query.toLowerCase()
      ? <mark key={i} style={{ background: '#ffd70033', color: 'var(--gold)', borderRadius: 2, padding: '0 1px' }}>{p}</mark>
      : p
  );
}

function renderInline(text: string, highlight?: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g);
  return (
    <>
      {parts.map((seg, i) => {
        if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4)
          return <strong key={i} style={{ fontWeight: 700, color: 'inherit' }}>{hl(seg.slice(2, -2), highlight)}</strong>;
        if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2)
          return <code key={i} className="font-mono text-[0.875em] px-1.5 py-0.5 rounded" style={{ background: '#0a1a2e', color: '#00f5ff', border: '1px solid #0d2540' }}>{seg.slice(1, -1)}</code>;
        if (seg.startsWith('*') && seg.endsWith('*') && seg.length > 2)
          return <em key={i} style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>{hl(seg.slice(1, -1), highlight)}</em>;
        return <span key={i}>{hl(seg, highlight)}</span>;
      })}
    </>
  );
}

interface Props {
  content: string;
  highlight?: string;
  prose?: boolean;
}

export default function MarkdownBlock({ content, highlight, prose }: Props) {
  const cleaned = content.replace(/<!--[\s\S]*?-->/g, '').trim();
  const lines   = cleaned.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw  = lines[i];
    const line = raw.trim();

    if (line === '') {
      nodes.push(<div key={i} className="h-2" />);
      i++; continue;
    }

    if (/^-{3,}$/.test(line)) {
      nodes.push(
        <div key={i} className="my-3 h-px" style={{ background: 'linear-gradient(to right, #00f5ff22, #c084fc11, transparent)' }} />
      );
      i++; continue;
    }

    if (line.startsWith('# ')) {
      nodes.push(
        <h1 key={i} className="text-lg font-bold tracking-wide uppercase mt-5 mb-2"
          style={{ color: 'var(--gold)', textShadow: '0 0 12px #ffd70044' }}>
          {renderInline(line.slice(2), highlight)}
        </h1>
      );
      i++; continue;
    }

    if (line.startsWith('## ')) {
      nodes.push(
        <h2 key={i} className="text-sm font-bold tracking-widest uppercase mt-5 mb-2" style={{ color: 'var(--cyan)' }}>
          {renderInline(line.slice(3), highlight)}
        </h2>
      );
      i++; continue;
    }

    if (line.startsWith('### ')) {
      nodes.push(
        <h3 key={i} className="text-sm font-bold tracking-wider mt-4 mb-1.5" style={{ color: '#c084fc' }}>
          {renderInline(line.slice(4), highlight)}
        </h3>
      );
      i++; continue;
    }

    if (line.startsWith('#### ')) {
      nodes.push(
        <h4 key={i} className="text-xs font-bold tracking-wider uppercase mt-3 mb-1" style={{ color: 'var(--text-muted)' }}>
          {renderInline(line.slice(5), highlight)}
        </h4>
      );
      i++; continue;
    }

    // Collect consecutive list items
    if (/^(\s*)(-|\*|\d+\.)\s/.test(raw)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^(\s*)(-|\*|\d+\.)\s/.test(lines[i])) {
        const itemRaw  = lines[i];
        const indent   = (itemRaw.match(/^(\s*)/)?.[1].length ?? 0);
        const checkM   = itemRaw.match(/^\s*-\s*\[([ xX])\]\s*(.*)/);
        if (checkM) {
          const done = checkM[1].toLowerCase() === 'x';
          items.push(
            <div key={i} className="flex items-start gap-2.5 py-0.5">
              <div className="mt-0.5 w-3.5 h-3.5 flex-none rounded-sm border flex items-center justify-center text-[13px] font-bold"
                style={{ borderColor: done ? 'var(--green)' : '#2a4060', background: done ? '#00ff8822' : 'transparent', color: 'var(--green)' }}>
                {done ? '✓' : ''}
              </div>
              <span className="text-sm leading-relaxed" style={{ color: done ? 'var(--text-dim)' : 'var(--text-muted)', textDecoration: done ? 'line-through' : 'none' }}>
                {renderInline(checkM[2], highlight)}
              </span>
            </div>
          );
        } else {
          const textM = itemRaw.match(/^\s*(?:-|\*|\d+\.)\s+(.*)/);
          const text  = textM ? textM[1] : itemRaw;
          items.push(
            <div key={i} className="flex items-start gap-2 py-0.5" style={{ paddingLeft: indent * 6 }}>
              <span className="mt-1.5 text-[13px] flex-none" style={{ color: '#00f5ff55' }}>▸</span>
              <span className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {renderInline(text, highlight)}
              </span>
            </div>
          );
        }
        i++;
      }
      nodes.push(<div key={`list-${i}`} className="flex flex-col gap-0.5 my-1">{items}</div>);
      continue;
    }

    // Regular paragraph
    nodes.push(
      <p key={i} className={`text-sm leading-relaxed my-0.5 ${prose ? 'italic' : ''}`}
        style={{ color: prose ? 'var(--text-dim)' : 'var(--text-muted)' }}>
        {renderInline(line, highlight)}
      </p>
    );
    i++;
  }

  return <div className="space-y-0.5">{nodes}</div>;
}
