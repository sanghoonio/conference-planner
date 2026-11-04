import type { HashState } from '../lib/hash.ts';
import type { Model, Presentation } from '../lib/model.ts';
import type { Stars } from '../lib/stars.ts';
import { Check } from './icons.tsx';

export type ViewProps = {
  model: Model;
  stars: Stars;
  hash: HashState;
  setHash: (patch: Record<string, string | null | undefined>) => void;
  onClose: () => void;
  suggested: SuggestedToggle;
};

export type SuggestedToggle = { available: boolean; show: boolean; toggle: () => void };

export const SEP = '|';
export const splitSet = (v: string | undefined) => new Set(v ? v.split(SEP) : []);
export const joinSet = (s: Set<string>) => (s.size ? [...s].join(SEP) : null);
export function toggled(set: Set<string>, v: string) {
  const n = new Set(set);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
}

/** Sidebar checkbox option, reference style (`.opt` with `.box` / `.lbl` / `.n`). */
export function Opt({ label, count, on, onClick, className = '', title }: { label: string; count?: number; on: boolean; onClick: () => void; className?: string; title?: string }) {
  return (
    <div className={`opt${on ? ' on' : ''}${className ? ` ${className}` : ''}`} onClick={onClick} role="checkbox" aria-checked={on} title={title ?? label}>
      {!className.includes('pnav') && (
        <span className="box">
          <Check />
        </span>
      )}
      <span className="lbl">{label}</span>
      {count !== undefined && <span className="n">{count}</span>}
    </div>
  );
}

/** A filter group; options with zero matches are hidden unless active, like the reference. */
export function SideGroup({
  title,
  options,
  selected,
  onToggle,
  onClear,
  suggested = false,
}: {
  suggested?: boolean;
  title: string;
  options: { value: string; label: string; count: number }[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  const shown = options.filter((o) => o.count > 0 || selected.has(o.value));
  if (!options.length) return null;
  return (
    <div className={`side-sec${selected.size ? ' has-active' : ''}${suggested ? ' sugg' : ''}`}>
      <div className="side-head">
        <span>{title}</span>
        <button className="clr" onClick={onClear}>
          Clear
        </button>
      </div>
      {shown.map((o) => (
        <Opt key={o.value} label={o.label} count={o.count} on={selected.has(o.value)} onClick={() => onToggle(o.value)} />
      ))}
    </div>
  );
}

/** Natural sort for codes/board numbers like "42", "P-7", "5004W". */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const naturalCompare = (a: string, b: string) => collator.compare(a, b);

export const presenterName = (p: Presentation) => p.speakers[0]?.name ?? p.authors?.split(',')[0]?.trim() ?? '';

/** Scroll an element into view and flash it, like the reference's jump-to-item. */
export function flashEl(el: Element | null, block: ScrollLogicalPosition = 'center') {
  if (!el) return;
  el.scrollIntoView?.({ behavior: 'smooth', block });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1500);
}
