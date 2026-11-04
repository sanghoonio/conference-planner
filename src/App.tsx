import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Issue } from '../schema/conference.ts';
import { getConference, getLast, removeConference, requestPersistentStorage, saveConference, setLast } from './lib/cache.ts';
import { parseConferenceFile } from './lib/load.ts';
import { buildModel, type Model } from './lib/model.ts';
import { resetUrl, useUrlState } from './lib/url.ts';
import { useStars } from './lib/stars.ts';
import { StartScreen } from './views/StartScreen.tsx';
import { ProgramView } from './views/ProgramView.tsx';
import { PostersView } from './views/PostersView.tsx';
import { CalendarView } from './views/CalendarView.tsx';

type State =
  | { status: 'booting' }
  | { status: 'start'; issues?: Issue[]; fileName?: string }
  | { status: 'loading'; fileName: string }
  | { status: 'ready'; model: Model; warnings: Issue[] };

export function App() {
  const [state, setState] = useState<State>({ status: 'booting' });

  useEffect(() => {
    const last = getLast();
    if (!last) return setState({ status: 'start' });
    getConference(last)
      .then((entry) => {
        if (!entry) return setState({ status: 'start' });
        setState({ status: 'ready', model: buildModel(entry.data), warnings: [] });
      })
      .catch(() => setState({ status: 'start' }));
  }, []);

  const openFile = useCallback(async (file: Blob, fileName: string) => {
    setState({ status: 'loading', fileName });
    const r = await parseConferenceFile(file);
    if (!r.ok) return setState({ status: 'start', issues: r.issues, fileName });
    requestPersistentStorage();
    await saveConference(r.data).catch(() => {}); // still usable this session if storage is unavailable
    resetUrl();
    setState({ status: 'ready', model: buildModel(r.data), warnings: r.issues });
  }, []);

  const openCached = useCallback(async (id: string) => {
    const entry = await getConference(id);
    if (!entry) return;
    setLast(id);
    resetUrl();
    setState({ status: 'ready', model: buildModel(entry.data), warnings: [] });
  }, []);

  const close = useCallback(() => {
    setLast(null);
    resetUrl();
    setState({ status: 'start' });
  }, []);

  // With no conference open, deep links like /posters?q=… have nothing to show: send them to the root.
  useEffect(() => {
    if (state.status === 'start' && (location.pathname !== import.meta.env.BASE_URL || location.search)) resetUrl();
  }, [state.status]);

  if (state.status === 'booting') return null;
  if (state.status === 'ready') return <Planner key={state.model.meta.id} model={state.model} warnings={state.warnings} onClose={close} />;
  return (
    <StartScreen
      loading={state.status === 'loading'}
      fileName={state.fileName}
      issues={state.status === 'start' ? state.issues : undefined}
      onFile={openFile}
      onOpenCached={openCached}
      onRemoveCached={removeConference}
    />
  );
}

const SUGGESTED_KEY = 'cp:suggested';

export function Planner({ model, warnings, onClose }: { model: Model; warnings: Issue[]; onClose: () => void }) {
  const stars = useStars(model.meta.id);
  const [url, setUrl] = useUrlState();
  const [dismissed, setDismissed] = useState(false);
  const view = url.view === 'posters' && model.hasPosters ? 'posters' : url.view === 'calendar' ? 'calendar' : 'program';

  useEffect(() => {
    document.title = `${model.meta.shortName ?? model.meta.name} · Program Planner`;
  }, [model.meta]);

  // Suggested (agent-inferred) categories can be hidden; the choice is remembered per browser.
  const [showSuggested, setShowSuggested] = useState(() => localStorage.getItem(SUGGESTED_KEY) !== '0');
  const toggleSuggested = useCallback(() => {
    setShowSuggested((v) => {
      localStorage.setItem(SUGGESTED_KEY, v ? '0' : '1');
      return !v;
    });
  }, []);
  const viewModel = useMemo(() => (showSuggested ? model : { ...model, facets: model.facets.filter((f) => !f.suggested) }), [model, showSuggested]);
  const suggested = { available: model.hasSuggested, show: showSuggested, toggle: toggleSuggested };

  const props = { model: viewModel, stars, url, setUrl, onClose, suggested };
  return (
    <>
      {warnings.length > 0 && !dismissed && (
        <details className="warn-banner">
          <summary>
            Loaded with {warnings.length} warning{warnings.length > 1 ? 's' : ''}
            <button
              onClick={(e) => {
                e.preventDefault();
                setDismissed(true);
              }}
            >
              Dismiss
            </button>
          </summary>
          <ul className="issues">
            {warnings.map((w, i) => (
              <li key={i}>
                <code>{w.path}</code> {w.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      {view === 'program' && <ProgramView {...props} />}
      {view === 'posters' && <PostersView {...props} />}
      {view === 'calendar' && <CalendarView {...props} />}
    </>
  );
}
