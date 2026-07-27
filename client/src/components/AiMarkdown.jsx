import React from 'react';
import { Copy, FileCode2 } from 'lucide-react';

// Renderer Markdown minimale: quel tanto che serve alle risposte del modello
// (titoli, elenchi, grassetto, codice inline e blocchi di codice), senza
// aggiungere una dipendenza al progetto.

function inline(text, keyBase) {
  const out = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|_[^_]+_)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const key = `${keyBase}-${i++}`;
    if (t.startsWith('`')) out.push(<code key={key}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) out.push(<strong key={key}>{t.slice(2, -2)}</strong>);
    else out.push(<em key={key}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Prose({ text, keyBase }) {
  const blocks = [];
  const lines = text.split('\n');
  let list = null;
  const flush = () => {
    if (list) {
      blocks.push(<ul key={`${keyBase}-ul-${blocks.length}`}>{list}</ul>);
      list = null;
    }
  };
  lines.forEach((line, i) => {
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (heading) {
      flush();
      blocks.push(
        <p key={`${keyBase}-h-${i}`} className="md-h">
          {inline(heading[2], `${keyBase}-h-${i}`)}
        </p>
      );
    } else if (bullet || numbered) {
      const content = (bullet || numbered)[1];
      list = list || [];
      list.push(<li key={`${keyBase}-li-${i}`}>{inline(content, `${keyBase}-li-${i}`)}</li>);
    } else if (!line.trim()) {
      flush();
    } else {
      flush();
      blocks.push(<p key={`${keyBase}-p-${i}`}>{inline(line, `${keyBase}-p-${i}`)}</p>);
    }
  });
  flush();
  return <>{blocks}</>;
}

function CodeBlock({ lang, code, onOpenSql }) {
  const isSql = /^(sql|plsql|oracle)$/i.test(lang || '');
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang || 'testo'}</span>
        <button
          className="mini-btn"
          onClick={() => navigator.clipboard?.writeText(code)}
          title="Copia negli appunti"
        >
          <Copy size={11} /> Copia
        </button>
        {isSql && onOpenSql && (
          <button className="mini-btn" onClick={() => onOpenSql(code)} title="Apri in un foglio SQL">
            <FileCode2 size={11} /> Apri nel foglio
          </button>
        )}
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function AiMarkdown({ text, onOpenSql }) {
  const parts = [];
  const re = /```([\w+-]*)\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) {
      parts.push(<Prose key={`t${i}`} keyBase={`t${i}`} text={text.slice(last, m.index)} />);
    }
    parts.push(
      <CodeBlock key={`c${i}`} lang={m[1]} code={m[2].replace(/\n$/, '')} onOpenSql={onOpenSql} />
    );
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) {
    parts.push(<Prose key={`t${i}`} keyBase={`t${i}`} text={text.slice(last)} />);
  }
  return <div className="md">{parts}</div>;
}
