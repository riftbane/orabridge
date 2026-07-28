import React, { useMemo, useState } from 'react';
import { Check, Copy, FileCode2 } from 'lucide-react';
import { parseMarkdown } from '../markdown.js';
import { tokenizeCode } from '../codeTokens.js';

// Rendering delle risposte dell'assistente: l'albero prodotto da
// `parseMarkdown` diventa elementi React (niente HTML grezzo), con i blocchi di
// codice colorati, copiabili e — se sono SQL — apribili in un foglio.

function Inline({ nodes }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (typeof n === 'string') return <React.Fragment key={i}>{n}</React.Fragment>;
        if (n.type === 'br') return <br key={i} />;
        if (n.type === 'code') return <code key={i}>{n.text}</code>;
        if (n.type === 'link') {
          return (
            <a key={i} href={n.href} target="_blank" rel="noreferrer noopener">
              <Inline nodes={n.children} />
            </a>
          );
        }
        const Tag = n.type === 'strong' ? 'strong' : n.type === 'em' ? 'em' : 'del';
        return (
          <Tag key={i}>
            <Inline nodes={n.children} />
          </Tag>
        );
      })}
    </>
  );
}

function CodeBlock({ lang, code, onOpenSql }) {
  const [copied, setCopied] = useState(false);
  const tokens = useMemo(() => tokenizeCode(code, lang), [code, lang]);
  const isSql = /^(sql|plsql|pl\/sql|oracle|oraclesql)$/i.test(lang || '');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* appunti non disponibili (browser senza permesso) */
    }
  };

  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang || 'testo'}</span>
        <button className="mini-btn" onClick={copy} title="Copia negli appunti">
          {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copiato' : 'Copia'}
        </button>
        {isSql && onOpenSql && (
          <button className="mini-btn" onClick={() => onOpenSql(code)} title="Apri in un foglio SQL">
            <FileCode2 size={11} /> Apri nel foglio
          </button>
        )}
      </div>
      <pre>
        <code>
          {tokens.map((t, i) =>
            t.kind === 'plain' ? (
              <React.Fragment key={i}>{t.text}</React.Fragment>
            ) : (
              <span key={i} className={`tok-${t.kind}`}>
                {t.text}
              </span>
            )
          )}
        </code>
      </pre>
    </div>
  );
}

function Blocks({ blocks, onOpenSql }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'code':
            return <CodeBlock key={i} lang={b.lang} code={b.code} onOpenSql={onOpenSql} />;
          case 'heading': {
            const Tag = `h${Math.min(b.level + 2, 6)}`;
            return (
              <Tag key={i} className={`md-h md-h${b.level}`}>
                <Inline nodes={b.inline} />
              </Tag>
            );
          }
          case 'hr':
            return <hr key={i} />;
          case 'quote':
            return (
              <blockquote key={i}>
                <Blocks blocks={b.blocks} onOpenSql={onOpenSql} />
              </blockquote>
            );
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag key={i} start={b.ordered && b.start !== 1 ? b.start : undefined}>
                {b.items.map((it, j) => (
                  <li key={j} className={it.task === null ? undefined : 'md-task'}>
                    {it.task !== null && (
                      <input type="checkbox" checked={it.task} readOnly tabIndex={-1} />
                    )}
                    {/* Punto di una riga sola: niente <p> attorno, altrimenti
                        l'elenco risulta più spaziato del necessario. */}
                    {it.blocks.length === 1 && it.blocks[0].type === 'para' ? (
                      <Inline nodes={it.blocks[0].inline} />
                    ) : (
                      <Blocks blocks={it.blocks} onOpenSql={onOpenSql} />
                    )}
                  </li>
                ))}
              </Tag>
            );
          }
          case 'table':
            return (
              <div key={i} className="md-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {b.head.map((cell, j) => (
                        <th key={j} style={b.align[j] ? { textAlign: b.align[j] } : undefined}>
                          <Inline nodes={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((cell, k) => (
                          <td key={k} style={b.align[k] ? { textAlign: b.align[k] } : undefined}>
                            <Inline nodes={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return (
              <p key={i}>
                <Inline nodes={b.inline} />
              </p>
            );
        }
      })}
    </>
  );
}

export default function AiMarkdown({ text, onOpenSql }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="md">
      <Blocks blocks={blocks} onOpenSql={onOpenSql} />
    </div>
  );
}
