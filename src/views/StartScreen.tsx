import { Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Issue } from '../../schema/conference.ts';
import { listConferences, type CachedSummary } from '../lib/cache.ts';
import { formatShortRange } from '../lib/time.ts';

type Props = {
  loading: boolean;
  fileName?: string;
  issues?: Issue[];
  onFile: (file: Blob, name: string) => void;
  onOpenCached: (id: string) => void;
  onRemoveCached: (id: string) => Promise<void>;
};

const base = import.meta.env.BASE_URL;

export function StartScreen({ loading, fileName, issues, onFile, onOpenCached, onRemoveCached }: Props) {
  const [recent, setRecent] = useState<CachedSummary[]>([]);
  const [drag, setDrag] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const refresh = () => listConferences().then(setRecent).catch(() => setRecent([]));
  useEffect(() => {
    refresh();
  }, []);

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onFile(f, f.name);
  };

  const loadDemo = async () => {
    const res = await fetch(`${base}demo.conference.json`);
    onFile(await res.blob(), 'demo.conference.json');
  };

  const errors = issues?.filter((i) => i.level === 'error') ?? [];

  return (
    <div className="start">
      <div className="start-card">
        <h1 className="start-brand">Program Planner</h1>
        <p className="start-sub">
          Open a conference file to browse the program, star sessions, talks and posters, and see your schedule.
        </p>

        <div
          className={`drop${drag ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            pick(e.dataTransfer.files);
          }}
          onClick={() => input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        >
          {loading ? (
            <span>Reading {fileName}…</span>
          ) : (
            <>
              <strong>Drop a conference file here</strong>
              <span>.conference.json or .json.gz</span>
            </>
          )}
          <input ref={input} type="file" accept=".json,.gz,application/json,application/gzip" hidden onChange={(e) => pick(e.target.files)} />
        </div>

        {errors.length > 0 && (
          <div className="error-box">
            <strong>{fileName} isn’t a valid conference file</strong>
            <ul className="issues">
              {errors.slice(0, 50).map((i, k) => (
                <li key={k}>
                  <code>{i.path}</code> {i.message}
                </li>
              ))}
              {errors.length > 50 && <li>…and {errors.length - 50} more</li>}
            </ul>
          </div>
        )}

        {recent.length > 0 && (
          <div className="recent">
            <div className="side-head">
              <span>Open again</span>
            </div>
            {recent.map((c) => (
              <div key={c.id} className="recent-row">
                <button className="recent-open" onClick={() => onOpenCached(c.id)}>
                  <span className="recent-name">{c.name}</span>
                  <span className="recent-date">{c.start ? (c.end ? formatShortRange(c.start, c.end) : formatShortRange(c.start, c.start)) + `, ${c.start.slice(0, 4)}` : ''}</span>
                </button>
                <button
                  className="recent-remove"
                  title="Remove from this browser (stars are kept)"
                  aria-label={`Remove ${c.name} from this browser`}
                  onClick={async () => {
                    await onRemoveCached(c.id);
                    refresh();
                  }}
                >
                  <Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="start-links">
          <button className="btn-black" onClick={loadDemo}>
            Try demo
          </button>
          <button className="btn-black" onClick={() => setAgentOpen(true)}>
            Create a conference file
          </button>
        </div>
      </div>
      {agentOpen && <AgentModal onClose={() => setAgentOpen(false)} />}
    </div>
  );
}

const PROMPT = 'Follow AGENTS.md to make a Conference Planner file for <conference name and year> from <program URL, API, or PDF>.';

/** AGENTS.md as served, with the JSON Schema appended, so it works without access to this site. */
async function buildAgentsMd(): Promise<string> {
  const [md, schema] = await Promise.all([
    fetch(`${base}AGENTS.md`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.statusText)))),
    fetch(`${base}conference.schema.json`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.statusText)))),
  ]);
  return `${md.trim()}\n\n---\n\n## Appendix: conference.schema.json\n\nSave this as \`conference.schema.json\` and validate against it.\n\n\`\`\`json\n${schema.trim()}\n\`\`\`\n`;
}

/** For pasting: the prompt first, then the whole of AGENTS.md, clearly delimited. */
const pasteText = (agentsMd: string) => `${PROMPT}\n\n<AGENTS.md>\n${agentsMd}</AGENTS.md>\n`;

function AgentModal({ onClose }: { onClose: () => void }) {
  const [agentsMd, setAgentsMd] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState<'all' | 'prompt' | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    buildAgentsMd().then(setAgentsMd, () => setFailed(true));
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = (what: 'all' | 'prompt') => {
    const t = what === 'all' ? agentsMd && pasteText(agentsMd) : PROMPT;
    if (!t) return;
    navigator.clipboard?.writeText(t).then(
      () => {
        setCopied(what);
        setTimeout(() => setCopied(null), 1500);
      },
      () => {},
    );
  };
  const download = () => {
    if (!agentsMd) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([agentsMd], { type: 'text/markdown' }));
    a.download = 'AGENTS.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="agent-modal-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="agent-modal-title">Create a conference file</h2>
          <button ref={closeRef} className="modal-close" aria-label="Close" onClick={onClose}>
            <X size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        <p>
          A coding agent turns the official program (its web app, an export, or the PDF abstract book) into a conference file, following{' '}
          <b>AGENTS.md</b>: the format guide, with the JSON Schema at the end{agentsMd ? ` (${Math.round(agentsMd.length / 1000)} KB)` : ''}. Give
          your agent AGENTS.md and this prompt, with the placeholders filled in:
        </p>
        <pre>{PROMPT}</pre>
        <div className="modal-actions">
          <button className="btn-black" disabled={!agentsMd} onClick={() => copy('all')}>
            {copied === 'all' ? 'Copied' : 'Copy prompt + AGENTS.md'}
          </button>
          <button className="btn-quiet" disabled={!agentsMd} onClick={download}>
            Download AGENTS.md
          </button>
          <button className="btn-quiet" onClick={() => copy('prompt')}>
            {copied === 'prompt' ? 'Copied' : 'Copy prompt'}
          </button>
          {failed && <span className="modal-error">Couldn’t load AGENTS.md from this site.</span>}
        </div>
      </div>
    </div>
  );
}
