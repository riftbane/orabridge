// Modello del diagramma dell'editor a nodi.
//
// Uno snapshot (vedi diff/snapshot.js) è indicizzato per nome, e confrontarne
// due accoppia gli oggetti per nome: rinominare una tabella apparirebbe come
// «elimina la vecchia + crea la nuova», cioè una perdita di dati silenziosa.
// Il diagramma è quindi indicizzato per id stabile, e ogni oggetto ricorda con
// quale nome è stato letto dal dizionario (`base`, null se è nuovo).
//
// Dallo stesso accorgimento arriva la propagazione automatica: un vincolo
// punta all'id di una colonna, non al suo nome, quindi rinominare la colonna
// aggiorna da sé ogni chiave, ogni FK e ogni indice che la usano. I nomi si
// risolvono una volta sola, al momento della proiezione.
//
// Le due funzioni sono pure e devono soddisfare
//
//     projectDraft(importSnapshot(snap)) ≡ snap
//
// altrimenti aprire un diagramma e applicarlo senza toccare niente
// produrrebbe delle modifiche (vedi test/graphModel.test.js).
//
// Invariante sui nomi: nel draft i nomi sono sempre già in forma da dizionario
// (`CLIENTI`, non `clienti`), normalizzati in ingresso dalla UI. Chi legge il
// draft non deve mai chiedersi se maiuscolizzare.

let counter = 0;

// Id per gli oggetti creati nella UI. Quelli importati usano una numerazione
// progressiva (deterministica, comoda nei test); questi portano anche un
// pezzo casuale, così non possono collidere con essa né fra sessioni diverse.
export const newId = (prefix) =>
  `${prefix}n${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const key = (table, column) => `${table}\u0000${column}`;

// Una voce di colonna di un indice è "NOME" oppure "espressione", con un
// " DESC" facoltativo in coda (vedi snapshot.js).
const splitIndexColumn = (entry) => {
  const m = /^(.*?)( DESC)?$/.exec(String(entry ?? ''));
  return { expr: m[1], desc: !!m[2] };
};

/* ---------------------------------------------------------------- import -- */

export function importSnapshot(snap) {
  let n = 0;
  const id = (prefix) => `${prefix}${++n}`;

  const tables = {};
  const uidOfTable = new Map(); // nome → uid
  const uidOfColumn = new Map(); // "tabella\0colonna" → uid

  // Primo giro: tabelle e colonne. I vincoli arrivano dopo, quando ogni
  // colonna di ogni tabella ha già il suo id (una FK cita un'altra tabella).
  for (const t of Object.values(snap.tables || {})) {
    const uid = id('t');
    uidOfTable.set(t.name, uid);
    const columns = (t.columns || []).map((c) => {
      const cuid = id('c');
      uidOfColumn.set(key(t.name, c.name), cuid);
      return {
        uid: cuid,
        base: c.name,
        name: c.name,
        deleted: false,
        // `id` è il column_id del dizionario: nessuno lo confronta, ma va
        // riportato tale e quale perché la proiezione sia identica.
        id: c.id ?? null,
        type: c.type,
        notNull: !!c.notNull,
        default: c.default ?? null,
        identity: c.identity ?? null,
        virtual: !!c.virtual,
        comment: c.comment ?? null,
      };
    });
    tables[uid] = {
      uid,
      base: t.name,
      name: t.name,
      deleted: false,
      comment: t.comment ?? null,
      temporary: !!t.temporary,
      onCommit: t.onCommit ?? null,
      columns,
      constraints: [],
      indexes: [],
    };
  }

  // Riferimento a una colonna: per id se la colonna esiste, altrimenti per
  // nome — succede con le tabelle di altri schemi e con quelle escluse dal
  // filtro, e il nome va conservato per poterlo riprodurre.
  const colRef = (tableName, columnName) => {
    const uid = uidOfColumn.get(key(tableName, columnName));
    return uid ? { columnUid: uid } : { name: columnName };
  };

  for (const t of Object.values(snap.tables || {})) {
    const draft = tables[uidOfTable.get(t.name)];

    draft.constraints = (t.constraints || []).map((c) => {
      const refTableUid =
        c.type === 'R' && c.refOwner === snap.owner ? uidOfTable.get(c.refTable) ?? null : null;
      return {
        uid: id('k'),
        base: c.name,
        name: c.name,
        deleted: false,
        type: c.type,
        columns: (c.columns || []).map((col) => colRef(t.name, col)),
        condition: c.condition ?? null,
        refOwner: c.refOwner ?? null,
        refTableUid,
        // Conservati comunque: se la tabella riferita non è nel diagramma
        // sono l'unica cosa che permette di riprodurre il vincolo.
        refTable: c.refTable ?? null,
        refColumns: (c.refColumns || []).map((col) =>
          refTableUid ? colRef(c.refTable, col) : { name: col }
        ),
        deleteRule: c.deleteRule ?? null,
        disabled: !!c.disabled,
        generated: !!c.generated,
      };
    });

    draft.indexes = (t.indexes || []).map((i) => ({
      uid: id('x'),
      base: i.name,
      name: i.name,
      deleted: false,
      unique: !!i.unique,
      type: i.type ?? null,
      columns: (i.columns || []).map((entry) => {
        const { expr, desc } = splitIndexColumn(entry);
        const uid = uidOfColumn.get(key(t.name, expr));
        // Un indice funzionale ha per «colonna» un'espressione: non c'è
        // nessun id a cui agganciarla, resta il testo.
        return uid ? { columnUid: uid, desc } : { expr, desc };
      }),
      generated: !!i.generated,
      unusable: !!i.unusable,
    }));
  }

  const sequences = {};
  for (const s of Object.values(snap.sequences || {})) {
    const uid = id('s');
    sequences[uid] = { uid, base: s.name, name: s.name, deleted: false, ...omitName(s) };
  }

  return {
    owner: snap.owner,
    tables,
    sequences,
    // Le famiglie che l'editor non modifica viaggiano intatte: servono a
    // rendere la proiezione uno snapshot completo, così il confronto non le
    // segnala come mancanti.
    rest: {
      views: snap.views || {},
      mviews: snap.mviews || {},
      synonyms: snap.synonyms || {},
      triggers: snap.triggers || {},
      sources: snap.sources || {},
    },
  };
}

const omitName = ({ name, ...rest }) => rest;

/* --------------------------------------------------------------- project -- */

export function projectDraft(draft) {
  // Solo le colonne che esisteranno davvero: una colonna eliminata (o dentro
  // una tabella eliminata) non è più risolvibile, e i vincoli e gli indici che
  // la citano vengono saltati — sta alla UI proporre CASCADE CONSTRAINTS o
  // l'eliminazione esplicita del vincolo.
  const liveColumn = new Map(); // uid → nome corrente
  for (const t of Object.values(draft.tables)) {
    if (t.deleted) continue;
    for (const c of t.columns) if (!c.deleted) liveColumn.set(c.uid, c.name);
  }

  const refName = (ref) =>
    ref.columnUid ? liveColumn.get(ref.columnUid) ?? null : ref.name ?? null;

  // null se anche una sola colonna non è più risolvibile.
  const refNames = (refs) => {
    const out = [];
    for (const r of refs) {
      const n = refName(r);
      if (n == null) return null;
      out.push(n);
    }
    return out;
  };

  const tables = {};
  for (const t of Object.values(draft.tables)) {
    if (t.deleted) continue;

    const constraints = [];
    for (const c of t.constraints) {
      if (c.deleted) continue;
      const columns = refNames(c.columns);
      if (columns == null) continue;
      const refTable = c.refTableUid ? draft.tables[c.refTableUid] : null;
      if (c.refTableUid && (!refTable || refTable.deleted)) continue;
      const refColumns = refNames(c.refColumns);
      if (refColumns == null) continue;
      constraints.push({
        name: c.name,
        type: c.type,
        columns,
        condition: c.condition,
        refOwner: c.refOwner,
        refTable: refTable ? refTable.name : c.refTable,
        refColumns,
        deleteRule: c.deleteRule,
        disabled: c.disabled,
        generated: c.generated,
      });
    }

    const indexes = [];
    for (const i of t.indexes) {
      if (i.deleted) continue;
      const columns = [];
      let broken = false;
      for (const entry of i.columns) {
        const base = entry.expr != null ? entry.expr : refName(entry);
        if (base == null) {
          broken = true;
          break;
        }
        columns.push(base + (entry.desc ? ' DESC' : ''));
      }
      if (broken) continue;
      indexes.push({
        name: i.name,
        unique: i.unique,
        type: i.type,
        columns,
        generated: i.generated,
        unusable: i.unusable,
      });
    }

    tables[t.name] = {
      name: t.name,
      comment: t.comment,
      temporary: t.temporary,
      onCommit: t.onCommit,
      columns: t.columns
        .filter((c) => !c.deleted)
        .map((c) => ({
          name: c.name,
          id: c.id,
          type: c.type,
          notNull: c.notNull,
          default: c.default,
          identity: c.identity,
          virtual: c.virtual,
          comment: c.comment,
        })),
      constraints,
      indexes,
    };
  }

  const sequences = {};
  for (const s of Object.values(draft.sequences || {})) {
    if (s.deleted) continue;
    const { uid, base, deleted, ...rest } = s;
    sequences[s.name] = { ...rest, name: s.name };
  }

  return {
    owner: draft.owner,
    tables,
    views: draft.rest?.views || {},
    mviews: draft.rest?.mviews || {},
    sequences,
    synonyms: draft.rest?.synonyms || {},
    triggers: draft.rest?.triggers || {},
    sources: draft.rest?.sources || {},
  };
}
