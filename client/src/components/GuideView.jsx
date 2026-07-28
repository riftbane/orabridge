import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Code2,
  Database,
  Download,
  FileCode2,
  GitCompare,
  History,
  Keyboard,
  LifeBuoy,
  ListTree,
  Maximize2,
  Search,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Table2,
  X,
} from 'lucide-react';
import { buildGuide, searchGuide } from '../guide.js';
import { useReleases } from '../releases.js';
import { APP_VERSION, IS_DESKTOP } from '../appInfo.js';
import { useStore } from '../store.js';
import AiMarkdown from './AiMarkdown.jsx';

// La guida dell'app: indice a sinistra, sezione a destra. Lo stesso componente
// serve la scheda «Guida» (a tutta area) e le impostazioni (`compact`), così il
// testo sta in un posto solo — vedi `guide.js`.

const ICONS = {
  intro: BookOpen,
  connessioni: Database,
  albero: ListTree,
  foglio: FileCode2,
  editor: Code2,
  griglia: Table2,
  oggetti: SquarePen,
  diff: GitCompare,
  ai: Sparkles,
  cronologia: History,
  aggiornamenti: Download,
  dati: ShieldCheck,
  problemi: LifeBuoy,
  scorciatoie: Keyboard,
};

export default function GuideView({ compact = false, onOpenFull }) {
  const sectionId = useStore((s) => s.guideSection);
  const setGuideSection = useStore((s) => s.setGuideSection);
  const [query, setQuery] = useState('');
  const bodyRef = useRef(null);

  // Le novità arrivano da GitHub: finché non rispondono, la sezione
  // «Aggiornamenti» mostra quelle incluse nel bundle.
  const releases = useReleases();
  const sections = useMemo(
    () => buildGuide({ version: APP_VERSION, desktop: IS_DESKTOP, releases }),
    [releases]
  );
  const matches = useMemo(() => searchGuide(sections, query), [sections, query]);
  // Cercando, la sezione mostrata è la prima che corrisponde: quella scelta
  // prima potrebbe essere sparita dall'indice.
  const current = matches.find((s) => s.id === sectionId) || matches[0] || null;
  const index = sections.findIndex((s) => s.id === current?.id);

  const go = (id) => {
    if (!sections.some((s) => s.id === id)) return;
    setQuery('');
    setGuideSection(id);
  };

  // Cambiando sezione si riparte dall'inizio del testo, non da metà pagina.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [current?.id]);

  return (
    <div className={`guide ${compact ? 'compact' : ''}`}>
      <div className="guide-nav">
        <div className="guide-search">
          <Search size={12} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca nella guida…"
          />
          {query && (
            <button className="icon-btn" title="Azzera la ricerca" onClick={() => setQuery('')}>
              <X size={12} />
            </button>
          )}
        </div>
        <nav>
          {matches.map((s) => {
            const Icon = ICONS[s.id] || BookOpen;
            return (
              <button
                key={s.id}
                className={s.id === current?.id ? 'on' : ''}
                title={s.summary}
                onClick={() => (query ? setGuideSection(s.id) : go(s.id))}
              >
                <Icon size={13} />
                <span>{s.title}</span>
              </button>
            );
          })}
        </nav>
        {query && (
          <div className="guide-nomatch">
            {matches.length
              ? `${matches.length} ${matches.length === 1 ? 'sezione' : 'sezioni'} con «${query}»`
              : `Nessuna sezione con «${query}»`}
          </div>
        )}
      </div>

      <div className="guide-body" ref={bodyRef}>
        {current ? (
          <>
            <div className="guide-head">
              <div>
                <h2>{current.title}</h2>
                <p>{current.summary}</p>
              </div>
              {compact ? (
                <button
                  className="btn"
                  title="Apri la guida in una scheda, con più spazio"
                  onClick={() => onOpenFull?.(current.id)}
                >
                  <Maximize2 size={13} /> Apri in una scheda
                </button>
              ) : (
                <span className="guide-version">
                  Orabridge {APP_VERSION || '—'}
                  {IS_DESKTOP ? ' · desktop' : ' · web'}
                </span>
              )}
            </div>

            <AiMarkdown className="md guide-md" text={current.md} onInternalLink={go} softBreaks />

            <div className="guide-foot">
              {index > 0 ? (
                <button className="btn" onClick={() => go(sections[index - 1].id)}>
                  <ChevronLeft size={13} /> {sections[index - 1].title}
                </button>
              ) : (
                <span />
              )}
              {index >= 0 && index < sections.length - 1 && (
                <button className="btn" onClick={() => go(sections[index + 1].id)}>
                  {sections[index + 1].title} <ChevronRight size={13} />
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="grid-empty">Nessuna sezione trovata.</div>
        )}
      </div>
    </div>
  );
}
