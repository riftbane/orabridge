// Rinomine del diagramma, e ribasatura dello snapshot letto dal database.
//
// `compareSnapshots` accoppia gli oggetti per nome: se il confronto vedesse
// direttamente il disegno, una tabella rinominata risulterebbe «eliminata e
// ricreata». Questo passaggio toglie di mezzo il problema prima del confronto:
// emette le istruzioni di rinomina — che vanno in cima allo script — e
// restituisce una copia della base in cui quei nomi sono già cambiati. Da lì in
// poi il confronto vede solo le differenze vere.
//
// Tutto puro: nessuna query, nessuno stato.

import { isGeneratedName } from '../diff/snapshot.js';

// Gli identificatori arrivano dal dizionario o dalla UI, che li normalizza già
// in forma da dizionario: si citano sempre, come fa diff/script.js.
const ident = (n) => '"' + String(n ?? '').replace(/"/g, '""') + '"';
const qual = (owner, name) => `${ident(owner)}.${ident(name)}`;

const key = (table, column) => `${table} ${column}`;

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Il nome compare nel testo come parola a sé (quotato o no)? Serve solo per
// avvisare: il testo non viene mai riscritto.
const mentions = (text, name) =>
  !!text && new RegExp(`(^|[^A-Za-z0-9_$#])"?${escapeRx(name)}"?($|[^A-Za-z0-9_$#])`, 'i').test(text);

/**
 * Ordina le rinomine in modo che un nome venga liberato prima di essere
 * riusato: `A→B` è sicuro solo quando nessuno si chiama ancora B. Con
 * `A→B` e `B→C` basta invertire l'ordine; con `A→B` e `B→A` nessun ordine
 * funziona e serve un passaggio intermedio, che non inventiamo noi.
 */
function orderRenames(renames) {
  const byFrom = new Map(renames.map((r) => [r.from, r]));
  const state = new Map(); // from → 'corso' | 'fatto'
  const out = [];
  let cycle = null;

  const visit = (r, stack) => {
    const s = state.get(r.from);
    if (s === 'fatto') return true;
    if (s === 'corso') {
      cycle = [...stack.slice(stack.indexOf(r.from)), r.from];
      return false;
    }
    state.set(r.from, 'corso');
    // Chi occupa il nome di arrivo deve liberarlo prima.
    const blocker = byFrom.get(r.to);
    if (blocker && blocker !== r && !visit(blocker, [...stack, r.from])) return false;
    state.set(r.from, 'fatto');
    out.push(r);
    return true;
  };

  for (const r of renames) if (!visit(r, [])) return { ordered: null, cycle };
  return { ordered: out, cycle: null };
}

// Rinomine di uno stesso ambito (le tabelle di uno schema, le colonne di una
// tabella, i vincoli, gli indici): controlla le collisioni e le ordina.
function planScope(renames, existing, label, errors) {
  if (!renames.length) return [];

  const seen = new Map();
  for (const r of renames) {
    if (seen.has(r.to)) {
      errors.push(`${label}: due oggetti verrebbero a chiamarsi ${r.to} (${seen.get(r.to)} e ${r.from})`);
      return [];
    }
    seen.set(r.to, r.from);
    // Un nome già occupato va bene solo se chi lo occupa se ne va a sua volta.
    if (existing.has(r.to) && !renames.some((x) => x.from === r.to)) {
      errors.push(`${label}: ${r.from} non può chiamarsi ${r.to}, il nome è già occupato`);
      return [];
    }
  }

  const { ordered, cycle } = orderRenames(renames);
  if (!ordered) {
    errors.push(
      `${label}: scambio di nomi non supportato (${cycle.join(' → ')}) — applica in due passaggi`
    );
    return [];
  }
  return ordered;
}

const renamedFrom = (o) => o.base != null && !o.deleted && o.base !== o.name;

/**
 * @param draft il diagramma (vedi model.js)
 * @param base  lo snapshot letto dal database all'apertura
 * @returns { statements, rebased, warnings, errors }
 */
export function renamePass(draft, base) {
  const owner = base.owner;
  const errors = [];
  const warnings = [];

  // ---- raccolta ----
  const tableRenames = [];
  const columnRenames = new Map(); // nome vecchio della tabella → [rinomine]
  const consRenames = []; // i nomi dei vincoli sono unici nello schema
  const idxRenames = []; // idem per gli indici

  for (const t of Object.values(draft.tables)) {
    if (t.base == null || t.deleted) continue;
    const from = base.tables[t.base];
    if (!from) {
      errors.push(
        `La tabella ${t.base} non esiste più nel database: rileggi lo schema prima di applicare`
      );
      continue;
    }
    if (renamedFrom(t)) tableRenames.push({ from: t.base, to: t.name, table: t });

    const cols = t.columns.filter(renamedFrom).map((c) => ({ from: c.base, to: c.name }));
    if (cols.length) columnRenames.set(t.base, cols);

    for (const c of t.constraints) {
      if (!renamedFrom(c)) continue;
      // Un SYS_C… non si rinomina: viene creato senza nome, quindi il nome
      // scelto nella UI si ottiene rifacendo il vincolo (ci pensa il confronto).
      if (isGeneratedName(c.base)) continue;
      consRenames.push({ from: c.base, to: c.name, table: t });
    }
    for (const i of t.indexes) {
      if (!renamedFrom(i) || isGeneratedName(i.base)) continue;
      idxRenames.push({ from: i.base, to: i.name });
    }
  }

  // ---- pianificazione, ambito per ambito ----
  const allNames = (pick) => {
    const s = new Set();
    for (const t of Object.values(base.tables)) for (const x of pick(t)) s.add(x.name);
    return s;
  };

  const tablePlan = planScope(tableRenames, new Set(Object.keys(base.tables)), 'Tabelle', errors);
  const consPlan = planScope(consRenames, allNames((t) => t.constraints), 'Vincoli', errors);
  const idxPlan = planScope(idxRenames, allNames((t) => t.indexes), 'Indici', errors);

  const columnPlans = new Map();
  for (const [tableName, renames] of columnRenames) {
    const existing = new Set((base.tables[tableName]?.columns || []).map((c) => c.name));
    columnPlans.set(tableName, planScope(renames, existing, `Colonne di ${tableName}`, errors));
  }

  if (errors.length) return { statements: [], rebased: base, warnings, errors };

  // ---- mappe di traduzione ----
  const tableTo = new Map(tablePlan.map((r) => [r.from, r.to]));
  const consTo = new Map(consPlan.map((r) => [r.from, r.to]));
  const idxTo = new Map(idxPlan.map((r) => [r.from, r.to]));
  const columnTo = new Map(); // "tabella vecchia\0colonna vecchia" → nome nuovo
  for (const [tableName, plan] of columnPlans)
    for (const r of plan) columnTo.set(key(tableName, r.from), r.to);

  // Nome con cui la tabella si chiamerà quando toccherà a colonne e vincoli:
  // le rinomine di tabella vengono prima di tutto il resto.
  const current = (oldName) => tableTo.get(oldName) ?? oldName;

  // ---- istruzioni ----
  const statements = [];
  for (const r of tablePlan) statements.push(`ALTER TABLE ${qual(owner, r.from)} RENAME TO ${ident(r.to)}`);
  for (const [tableName, plan] of columnPlans)
    for (const r of plan)
      statements.push(
        `ALTER TABLE ${qual(owner, current(tableName))} RENAME COLUMN ${ident(r.from)} TO ${ident(r.to)}`
      );
  for (const r of consPlan)
    statements.push(
      `ALTER TABLE ${qual(owner, current(r.table.base))} RENAME CONSTRAINT ${ident(r.from)} TO ${ident(r.to)}`
    );
  for (const r of idxPlan) statements.push(`ALTER INDEX ${qual(owner, r.from)} RENAME TO ${ident(r.to)}`);

  // ---- avvisi ----
  // Le espressioni SQL che citano una colonna rinominata non vengono
  // riscritte: farlo con una regex è fragile, e sbagliare in questa direzione
  // è innocuo — al massimo il confronto propone di rifare il vincolo.
  for (const t of Object.values(base.tables)) {
    const plan = columnPlans.get(t.name);
    if (!plan?.length) continue;
    const names = plan.map((r) => r.from);
    const cites = (text) => names.filter((n) => mentions(text, n));
    for (const c of t.constraints) {
      if (c.type !== 'C') continue;
      for (const n of cites(c.condition))
        warnings.push(`${t.name}: il vincolo CHECK ${c.name} cita ${n}, rinominata — verificane la condizione`);
    }
    for (const c of t.columns)
      for (const n of cites(c.default))
        warnings.push(`${t.name}.${c.name}: il DEFAULT cita ${n}, rinominata — verificalo`);
    for (const i of t.indexes)
      for (const entry of i.columns) {
        const expr = entry.replace(/ DESC$/, '');
        if (/^[A-Za-z][A-Za-z0-9_$#]*$/.test(expr)) continue; // colonna semplice: già gestita
        for (const n of cites(expr))
          warnings.push(`${t.name}: l'indice funzionale ${i.name} cita ${n}, rinominata — verificalo`);
      }
  }

  // ---- ribasatura ----
  // La base riscritta com'è il database *dopo* le rinomine. Oltre ai nomi
  // degli oggetti vanno seguiti i riferimenti: una FK di un'altra tabella che
  // punta a una tabella o a una colonna rinominata, in Oracle, segue da sé.
  const colName = (tableName, columnName) => columnTo.get(key(tableName, columnName)) ?? columnName;

  const rebasedTables = {};
  for (const [tableName, t] of Object.entries(base.tables)) {
    const name = current(tableName);
    rebasedTables[name] = {
      ...t,
      name,
      columns: t.columns.map((c) => ({ ...c, name: colName(tableName, c.name) })),
      constraints: t.constraints.map((c) => {
        const foreign = c.type === 'R' && c.refOwner === owner && c.refTable;
        return {
          ...c,
          name: consTo.get(c.name) ?? c.name,
          columns: c.columns.map((col) => colName(tableName, col)),
          refTable: foreign ? current(c.refTable) : c.refTable,
          refColumns: foreign ? c.refColumns.map((col) => colName(c.refTable, col)) : c.refColumns,
        };
      }),
      indexes: t.indexes.map((i) => ({
        ...i,
        name: idxTo.get(i.name) ?? i.name,
        columns: i.columns.map((entry) => {
          const m = /^(.*?)( DESC)?$/.exec(entry);
          return colName(tableName, m[1]) + (m[2] || '');
        }),
      })),
    };
  }

  return { statements, rebased: { ...base, tables: rebasedTables }, warnings, errors };
}
