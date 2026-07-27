import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUp, Plus, X } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';
import DdlModal, { ColumnPicker } from './DdlModal.jsx';
import { ident, dictName, qual, lit, COL_TYPES, colDefSql, buildDrop } from '../ddl.js';

// Datalist with the tables of the current schema (for trigger/index/synonym forms).
export function TablesDatalist({ connId, id }) {
  const schema = useStore((s) => s.autocomplete[connId]);
  return (
    <datalist id={id}>
      {Object.keys(schema || {}).map((t) => (
        <option key={t} value={t} />
      ))}
    </datalist>
  );
}

const emptyCol = () => ({
  name: '',
  type: 'VARCHAR2',
  size: '',
  scale: '',
  def: '',
  notNull: false,
  pk: false,
  comment: '',
});

function TypeSelect({ value, onChange }) {
  const known = COL_TYPES.some((t) => t.name === value);
  return (
    <select value={value} onChange={onChange}>
      {!known && <option value={value}>{value}</option>}
      {COL_TYPES.map((t) => (
        <option key={t.name} value={t.name}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

/* ---------- CREATE TABLE (column designer) ---------- */

function TableForm({ connId, owner, onClose, onDone }) {
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [cols, setCols] = useState([emptyCol()]);

  const setCol = (i, patch) =>
    setCols((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i, d) =>
    setCols((cs) => {
      const j = i + d;
      if (j < 0 || j >= cs.length) return cs;
      const copy = [...cs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const filled = cols.filter((c) => c.name.trim());
  const valid = !!name.trim() && filled.length > 0;

  const statements = useMemo(() => {
    if (!valid) return [];
    const t = qual(owner, name);
    const lines = filled.map(colDefSql);
    const pk = filled.filter((c) => c.pk);
    if (pk.length)
      lines.push(
        `CONSTRAINT ${ident(dictName(name) + '_PK')} PRIMARY KEY (${pk.map((c) => ident(c.name)).join(', ')})`
      );
    const out = [`CREATE TABLE ${t} (\n  ${lines.join(',\n  ')}\n)`];
    if (comment.trim()) out.push(`COMMENT ON TABLE ${t} IS ${lit(comment.trim())}`);
    for (const c of filled)
      if (c.comment.trim())
        out.push(`COMMENT ON COLUMN ${t}.${ident(c.name)} IS ${lit(c.comment.trim())}`);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, name, comment, cols]);

  return (
    <DdlModal
      title={`Nuova tabella — ${owner}`}
      connId={connId}
      statements={statements}
      valid={valid}
      execLabel="Crea tabella"
      wide
      onClose={onClose}
      onDone={() => onDone(dictName(name))}
    >
      <div className="form-row">
        <label style={{ flex: 1 }}>
          Nome tabella
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label style={{ flex: 2 }}>
          Commento
          <input value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
      </div>
      <div className="coldef-grid">
        {['Colonna', 'Tipo', 'Dim.', 'Scala', 'Default', 'NN', 'PK', 'Commento', '', ''].map(
          (h, i) => (
            <span key={i} className="hd">
              {h}
            </span>
          )
        )}
        {cols.map((c, i) => {
          const spec = COL_TYPES.find((s) => s.name === c.type);
          return (
            <React.Fragment key={i}>
              <input value={c.name} onChange={(e) => setCol(i, { name: e.target.value })} />
              <TypeSelect value={c.type} onChange={(e) => setCol(i, { type: e.target.value })} />
              <input
                value={c.size}
                disabled={!spec?.size && !spec?.prec}
                onChange={(e) => setCol(i, { size: e.target.value.replace(/\D/g, '') })}
              />
              <input
                value={c.scale}
                disabled={!spec?.prec}
                onChange={(e) => setCol(i, { scale: e.target.value.replace(/\D/g, '') })}
              />
              <input
                value={c.def}
                placeholder="es. SYSDATE"
                onChange={(e) => setCol(i, { def: e.target.value })}
              />
              <input
                type="checkbox"
                checked={c.notNull}
                onChange={(e) => setCol(i, { notNull: e.target.checked })}
              />
              <input
                type="checkbox"
                checked={c.pk}
                onChange={(e) => setCol(i, { pk: e.target.checked, notNull: e.target.checked || c.notNull })}
              />
              <input value={c.comment} onChange={(e) => setCol(i, { comment: e.target.value })} />
              <button className="icon-btn" title="Sposta su" onClick={() => move(i, -1)}>
                <ArrowUp size={13} />
              </button>
              <button
                className="icon-btn danger"
                title="Rimuovi colonna"
                onClick={() => setCols((cs) => (cs.length > 1 ? cs.filter((_, j) => j !== i) : cs))}
              >
                <X size={13} />
              </button>
            </React.Fragment>
          );
        })}
      </div>
      <div>
        <button className="btn" onClick={() => setCols((cs) => [...cs, emptyCol()])}>
          <Plus size={13} /> Aggiungi colonna
        </button>
      </div>
    </DdlModal>
  );
}

/* ---------- SEQUENCE (create / alter) ---------- */

function SequenceForm({ connId, owner, mode, name: fixedName, onClose, onDone }) {
  const alter = mode === 'alter';
  const [name, setName] = useState(fixedName || '');
  const [f, setF] = useState({ start: '1', increment: '1', min: '', max: '', cache: '20', cycle: false });
  const [orig, setOrig] = useState(null);
  const [last, setLast] = useState(null);
  const set = (k) => (e) =>
    setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  useEffect(() => {
    if (!alter) return;
    api
      .sequenceDetails(connId, owner, fixedName)
      .then((r) => {
        const row = r.rows?.[0];
        if (!row) return;
        // [Nome, Min, Max, Incremento, Ciclo, Ordine, Cache, Ultimo valore]
        const vals = {
          increment: String(row[3] ?? '1'),
          min: Number(row[1]) === 1 ? '1' : String(row[1] ?? ''),
          max: Number(row[2]) >= 1e27 ? '' : String(row[2] ?? ''),
          cache: String(row[6] ?? '0'),
          cycle: row[4] === 'Y',
        };
        setF((s) => ({ ...s, ...vals }));
        setOrig(vals);
        setLast(row[7]);
      })
      .catch(() => {});
  }, [alter, connId, owner, fixedName]);

  const clauses = useMemo(() => {
    const out = [];
    const changed = (k) => !alter || !orig || orig[k] !== (typeof f[k] === 'boolean' ? f[k] : String(f[k]));
    if (!alter && f.start) out.push(`START WITH ${f.start}`);
    if (f.increment && changed('increment')) out.push(`INCREMENT BY ${f.increment}`);
    if (changed('min')) out.push(f.min !== '' ? `MINVALUE ${f.min}` : 'NOMINVALUE');
    if (changed('max')) out.push(f.max !== '' ? `MAXVALUE ${f.max}` : 'NOMAXVALUE');
    if (changed('cycle')) out.push(f.cycle ? 'CYCLE' : 'NOCYCLE');
    if (changed('cache')) out.push(Number(f.cache) > 1 ? `CACHE ${f.cache}` : 'NOCACHE');
    return out;
  }, [f, alter, orig]);

  const valid = !!name.trim() && (!alter || clauses.length > 0);
  const statements = useMemo(() => {
    if (!name.trim() || (alter && (!orig || !clauses.length))) return [];
    return [`${alter ? 'ALTER' : 'CREATE'} SEQUENCE ${qual(owner, name)}\n  ${clauses.join('\n  ')}`];
  }, [alter, orig, owner, name, clauses]);

  return (
    <DdlModal
      title={alter ? `Modifica sequenza — ${owner}.${fixedName}` : `Nuova sequenza — ${owner}`}
      connId={connId}
      statements={statements}
      valid={valid}
      execLabel={alter ? 'Applica' : 'Crea sequenza'}
      onClose={onClose}
      onDone={() => onDone(dictName(name))}
    >
      {!alter && (
        <label>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
      )}
      {alter && last != null && (
        <div className="tree-info">Ultimo valore erogato: {String(last)} (START WITH non è modificabile)</div>
      )}
      <div className="form-row">
        {!alter && (
          <label style={{ flex: 1 }}>
            Start with
            <input value={f.start} onChange={set('start')} />
          </label>
        )}
        <label style={{ flex: 1 }}>
          Incremento
          <input value={f.increment} onChange={set('increment')} />
        </label>
        <label style={{ flex: 1 }}>
          Cache (0 = NOCACHE)
          <input value={f.cache} onChange={set('cache')} />
        </label>
      </div>
      <div className="form-row">
        <label style={{ flex: 1 }}>
          Min (vuoto = nessuno)
          <input value={f.min} onChange={set('min')} />
        </label>
        <label style={{ flex: 1 }}>
          Max (vuoto = nessuno)
          <input value={f.max} onChange={set('max')} />
        </label>
        <label className="check-label" style={{ flex: 1 }}>
          <span>Ciclo</span>
          <input type="checkbox" checked={f.cycle} onChange={set('cycle')} />
        </label>
      </div>
    </DdlModal>
  );
}

/* ---------- VIEW (create / edit) ---------- */

function ViewForm({ connId, owner, mode, name: fixedName, onClose, onDone }) {
  const edit = mode === 'edit';
  const [name, setName] = useState(fixedName || '');
  const [query, setQuery] = useState(edit ? null : 'SELECT\n  *\nFROM ');
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    if (!edit) return;
    api
      .viewText(connId, owner, fixedName)
      .then((r) => setQuery(r.text || ''))
      .catch((err) => {
        toast(err.message, 'error');
        setQuery('');
      });
  }, [edit, connId, owner, fixedName, toast]);

  const valid = !!name.trim() && !!query?.trim();
  const statements = valid
    ? [`CREATE OR REPLACE VIEW ${qual(owner, name)} AS\n${query.trim().replace(/;\s*$/, '')}`]
    : [];

  return (
    <DdlModal
      title={edit ? `Modifica vista — ${owner}.${fixedName}` : `Nuova vista — ${owner}`}
      connId={connId}
      statements={statements}
      valid={valid}
      execLabel={edit ? 'Applica' : 'Crea vista'}
      wide
      onClose={onClose}
      onDone={() => onDone(dictName(name))}
    >
      <label>
        Nome
        <input value={name} disabled={edit} onChange={(e) => setName(e.target.value)} autoFocus={!edit} />
      </label>
      <label>
        Query (SELECT)
        {query == null ? (
          <div className="tree-info">Caricamento…</div>
        ) : (
          <textarea
            className="sql-textarea"
            rows={10}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
        )}
      </label>
    </DdlModal>
  );
}

/* ---------- SYNONYM ---------- */

function SynonymForm({ connId, owner, onClose, onDone }) {
  const [name, setName] = useState('');
  const [tOwner, setTOwner] = useState(owner);
  const [tName, setTName] = useState('');
  const [replace, setReplace] = useState(false);
  const dl = `dl-syn-${connId}`;

  const valid = !!name.trim() && !!tOwner.trim() && !!tName.trim();
  const statements = valid
    ? [`CREATE ${replace ? 'OR REPLACE ' : ''}SYNONYM ${qual(owner, name)} FOR ${qual(tOwner, tName)}`]
    : [];

  return (
    <DdlModal
      title={`Nuovo sinonimo — ${owner}`}
      connId={connId}
      statements={statements}
      valid={valid}
      execLabel="Crea sinonimo"
      onClose={onClose}
      onDone={() => onDone(dictName(name))}
    >
      <TablesDatalist connId={connId} id={dl} />
      <label>
        Nome sinonimo
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <div className="form-row">
        <label style={{ flex: 1 }}>
          Schema oggetto
          <input value={tOwner} onChange={(e) => setTOwner(e.target.value)} />
        </label>
        <label style={{ flex: 2 }}>
          Oggetto di destinazione
          <input list={dl} value={tName} onChange={(e) => setTName(e.target.value)} />
        </label>
      </div>
      <label className="check-label">
        <span>Sostituisci se esiste (OR REPLACE)</span>
        <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
      </label>
    </DdlModal>
  );
}

/* ---------- INDEX ---------- */

function IndexForm({ connId, owner, initialTable, onClose, onDone }) {
  const [table, setTable] = useState(initialTable || '');
  const [name, setName] = useState(initialTable ? `${dictName(initialTable)}_IX` : '');
  const [touched, setTouched] = useState(false);
  const [unique, setUnique] = useState(false);
  const [cols, setColsSel] = useState([]);
  const dl = `dl-idx-${connId}`;

  const onTable = (v) => {
    setTable(v);
    setColsSel([]);
    if (!touched) setName(v.trim() ? `${dictName(v)}_IX` : '');
  };

  const valid = !!name.trim() && !!table.trim() && cols.length > 0;
  const statements = valid
    ? [
        `CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${qual(owner, name)} ON ${qual(owner, table)} (${cols
          .map(ident)
          .join(', ')})`,
      ]
    : [];

  return (
    <DdlModal
      title={`Nuovo indice — ${owner}`}
      connId={connId}
      statements={statements}
      valid={valid}
      execLabel="Crea indice"
      onClose={onClose}
      onDone={() => onDone(dictName(name))}
    >
      <TablesDatalist connId={connId} id={dl} />
      <div className="form-row">
        <label style={{ flex: 1 }}>
          Tabella
          <input
            list={dl}
            value={table}
            disabled={!!initialTable}
            onChange={(e) => onTable(e.target.value)}
            autoFocus={!initialTable}
          />
        </label>
        <label style={{ flex: 1 }}>
          Nome indice
          <input
            value={name}
            onChange={(e) => {
              setTouched(true);
              setName(e.target.value);
            }}
          />
        </label>
      </div>
      <label className="check-label">
        <span>Univoco (UNIQUE)</span>
        <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} />
      </label>
      <label>
        Colonne (clicca in ordine)
        <ColumnPicker connId={connId} owner={owner} table={table} value={cols} onChange={setColsSel} />
      </label>
    </DdlModal>
  );
}

/* ---------- PL/SQL skeletons (procedure/function/package/trigger/type) ---------- */

function PlsqlForm({ connId, owner, type, onClose, onDone }) {
  const [name, setName] = useState('');
  const [returns, setReturns] = useState('NUMBER');
  const [withBody, setWithBody] = useState(true);
  const [table, setTable] = useState('');
  const [timing, setTiming] = useState('BEFORE');
  const [events, setEvents] = useState({ INSERT: true, UPDATE: false, DELETE: false });
  const [forEachRow, setForEachRow] = useState(true);
  const dl = `dl-trg-${connId}`;

  const labels = {
    PROCEDURE: 'procedura',
    FUNCTION: 'funzione',
    PACKAGE: 'package',
    TRIGGER: 'trigger',
    TYPE: 'tipo',
  };

  const evtList = Object.keys(events).filter((e) => events[e]);
  const valid =
    !!name.trim() && (type !== 'TRIGGER' || (!!table.trim() && evtList.length > 0));

  const statements = useMemo(() => {
    if (!valid) return [];
    const n = ident(name);
    const q = qual(owner, name);
    switch (type) {
      case 'PROCEDURE':
        return [`CREATE OR REPLACE PROCEDURE ${q} AS\nBEGIN\n  NULL; -- implementazione\nEND ${n};`];
      case 'FUNCTION':
        return [
          `CREATE OR REPLACE FUNCTION ${q}\n  RETURN ${returns.trim() || 'NUMBER'} AS\nBEGIN\n  RETURN NULL; -- implementazione\nEND ${n};`,
        ];
      case 'PACKAGE': {
        const out = [`CREATE OR REPLACE PACKAGE ${q} AS\n  -- dichiarazioni pubbliche\nEND ${n};`];
        if (withBody)
          out.push(`CREATE OR REPLACE PACKAGE BODY ${q} AS\n  -- implementazione\nEND ${n};`);
        return out;
      }
      case 'TRIGGER':
        return [
          `CREATE OR REPLACE TRIGGER ${q}\n${timing} ${evtList.join(' OR ')} ON ${qual(owner, table)}\n${
            forEachRow ? 'FOR EACH ROW\n' : ''
          }BEGIN\n  NULL; -- implementazione\nEND ${n};`,
        ];
      case 'TYPE':
        return [`CREATE OR REPLACE TYPE ${q} AS OBJECT (\n  attributo1 NUMBER\n);`];
      default:
        return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, type, owner, name, returns, withBody, table, timing, events, forEachRow]);

  return (
    <DdlModal
      title={`Nuova ${labels[type] || type.toLowerCase()} — ${owner}`}
      connId={connId}
      statements={statements}
      valid={valid}
      execLabel="Crea"
      onClose={onClose}
      onDone={() => onDone(dictName(name))}
    >
      <TablesDatalist connId={connId} id={dl} />
      <label>
        Nome
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      {type === 'FUNCTION' && (
        <label>
          Tipo di ritorno
          <input value={returns} onChange={(e) => setReturns(e.target.value)} />
        </label>
      )}
      {type === 'PACKAGE' && (
        <label className="check-label">
          <span>Crea anche il package body</span>
          <input type="checkbox" checked={withBody} onChange={(e) => setWithBody(e.target.checked)} />
        </label>
      )}
      {type === 'TRIGGER' && (
        <>
          <div className="form-row">
            <label style={{ flex: 2 }}>
              Tabella
              <input list={dl} value={table} onChange={(e) => setTable(e.target.value)} />
            </label>
            <label style={{ flex: 1 }}>
              Momento
              <select value={timing} onChange={(e) => setTiming(e.target.value)}>
                <option>BEFORE</option>
                <option>AFTER</option>
              </select>
            </label>
          </div>
          <div className="form-row">
            {['INSERT', 'UPDATE', 'DELETE'].map((ev) => (
              <label key={ev} className="check-label" style={{ flex: 1 }}>
                <span>{ev}</span>
                <input
                  type="checkbox"
                  checked={events[ev]}
                  onChange={(e) => setEvents((s) => ({ ...s, [ev]: e.target.checked }))}
                />
              </label>
            ))}
            <label className="check-label" style={{ flex: 1 }}>
              <span>FOR EACH ROW</span>
              <input
                type="checkbox"
                checked={forEachRow}
                onChange={(e) => setForEachRow(e.target.checked)}
              />
            </label>
          </div>
        </>
      )}
      {(type === 'PROCEDURE' || type === 'FUNCTION' || type === 'PACKAGE' || type === 'TYPE') && (
        <div className="tree-info">
          Viene creato uno scheletro minimale: il corpo si modifica poi nella scheda «Sorgente»
          dell'oggetto.
        </div>
      )}
    </DdlModal>
  );
}

/* ---------- dispatcher ---------- */

// mode: 'create' (default) | 'alter' (SEQUENCE) | 'edit' (VIEW)
export default function ObjectCreateDialog({
  connId,
  owner,
  type,
  mode = 'create',
  name = null,
  initialTable = null,
  onClose,
  onDone,
}) {
  const common = { connId, owner, mode, name, onClose, onDone };
  switch (type) {
    case 'TABLE':
      return <TableForm {...common} />;
    case 'SEQUENCE':
      return <SequenceForm {...common} />;
    case 'VIEW':
      return <ViewForm {...common} />;
    case 'SYNONYM':
      return <SynonymForm {...common} />;
    case 'INDEX':
      return <IndexForm {...common} initialTable={initialTable} />;
    case 'PROCEDURE':
    case 'FUNCTION':
    case 'PACKAGE':
    case 'TRIGGER':
    case 'TYPE':
      return <PlsqlForm {...common} type={type} />;
    default:
      return null;
  }
}

/* ---------- DROP ---------- */

export function DropDialog({ connId, owner, name, type, onClose, onDone }) {
  const [cascade, setCascade] = useState(false);
  const statements = [buildDrop(type, owner, name, { cascade })];
  return (
    <DdlModal
      title={`Elimina ${type}`}
      connId={connId}
      statements={statements}
      execLabel="Elimina definitivamente"
      danger
      onClose={onClose}
      onDone={onDone}
    >
      <div>
        Stai per eliminare <b>{owner}.{name}</b> ({type}). L'operazione non è reversibile.
      </div>
      {type === 'TABLE' && (
        <label className="check-label">
          <span>CASCADE CONSTRAINTS (elimina anche le FK che la referenziano)</span>
          <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />
        </label>
      )}
    </DdlModal>
  );
}
