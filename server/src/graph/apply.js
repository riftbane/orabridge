// Dallo stato del diagramma allo script DDL.
//
// Il grosso del lavoro è già fatto dal motore del confronto fra database: qui
// si mettono in fila i pezzi.
//
//   draft ──project()──► snapshot del disegno ─┐
//                                              ├─ compareSnapshots ─► voci
//   base ──renamePass()──► base ribasata ──────┘        │
//                                                       ▼
//                                              buildSyncScript ─► DDL
//
// Il verso conta: `buildSyncScript(src, tgt)` porta `tgt` allo stato di `src` e
// crea in `tgt.owner`. Quindi `src` è il disegno e `tgt` è il database — lo
// schema in cui si scrive resta quello vero, e la rimappatura degli schemi
// interna a script.js è un'operazione a vuoto perché i due owner coincidono.
//
// Puro: niente query, niente esecuzione. Lo script si legge e si lancia a
// mano, esattamente come quello del DB Diff.

import { compareSnapshots } from '../diff/compare.js';
import { buildSyncScript } from '../diff/script.js';
import { projectDraft } from './model.js';
import { renamePass } from './rename.js';

const RULE = '-'.repeat(72);

const pad2 = (n) => String(n).padStart(2, '0');
const stamp = (d) =>
  `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ` +
  `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// buildSyncScript apre con un blocco di intestazione separato dal resto da una
// riga vuota. Qui l'intestazione la scriviamo noi — l'origine non è un
// database, è un disegno — quindi la sua si toglie.
function stripHeader(sql) {
  const i = sql.indexOf('\n\n');
  if (i === -1) return sql;
  return /^-- Script di sincronizzazione/.test(sql.slice(0, i)) ? sql.slice(i + 2) : sql;
}

/**
 * @param draft   il diagramma (vedi model.js)
 * @param base    lo snapshot letto dal database all'apertura
 * @param options { includeDrops, schemaLabel, ...opzioni di confronto }
 * @returns { sql, statements, items, warnings, errors, stats }
 *          `statements` sono le sole rinomine: il resto dello script si
 *          rilegge e si esegue come uno script, non istruzione per istruzione.
 */
export function buildApplyPlan(draft, base, options = {}) {
  // Nell'editor a nodi ogni eliminazione è un atto esplicito dell'utente, non
  // «roba che si trova nella destinazione» come nel DB Diff: qui il valore
  // predefinito è quindi acceso. La sicurezza sta nella conferma, non
  // nell'ignorare l'intenzione.
  const includeDrops = options.includeDrops !== false;

  const { statements: renames, rebased, warnings, errors } = renamePass(draft, base);
  const empty = {
    sql: '',
    statements: [],
    items: [],
    warnings,
    errors,
    stats: { renames: 0, statements: 0, created: 0, dropped: 0, skippedDrops: 0 },
  };
  if (errors.length) return empty;

  const draftSnap = projectDraft(draft);
  const { items } = compareSnapshots(draftSnap, rebased, options);
  const changed = items.filter((it) => it.status !== 'same');

  if (!renames.length && !changed.length) return { ...empty, items };

  const { sql: syncSql, stats } = buildSyncScript(draftSnap, rebased, changed, {
    ...options,
    includeDrops,
  });

  const head = [
    `-- Modifiche del diagramma, generate da Orabridge`,
    `-- Schema ......... ${options.schemaLabel || base.owner}`,
    `-- Generato ....... ${stamp(options.now || new Date())}`,
    `--`,
    `-- Da rileggere prima di eseguirlo: nessuna istruzione parte in automatico.`,
  ];
  if (renames.length)
    head.push(
      `-- Le rinomine vanno per prime: tutto il resto le dà per fatte.`
    );
  if (stats.skippedDrops)
    head.push(
      `-- ${stats.skippedDrops} eliminazioni richieste nel diagramma NON vengono applicate`,
      `-- (attiva "applica anche le eliminazioni" per generarle).`
    );
  for (const w of warnings) head.push(`-- Avviso: ${w}`);

  const out = [head.join('\n')];
  if (renames.length) {
    out.push(`${RULE}\n-- RINOMINE\n${RULE}`);
    for (const s of renames) out.push(`${s};`);
  }
  const body = stripHeader(syncSql).trim();
  if (body) out.push(body);

  return {
    sql: out.join('\n\n') + '\n',
    statements: renames,
    items,
    warnings,
    errors,
    stats: { ...stats, renames: renames.length, statements: stats.statements + renames.length },
  };
}
