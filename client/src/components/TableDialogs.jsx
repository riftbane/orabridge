import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Undo2, X } from 'lucide-react';
import { api } from '../api.js';
import DdlModal, { ColumnPicker } from './DdlModal.jsx';
import { TablesDatalist } from './ObjectDialogs.jsx';
import {
  ident,
  dictName,
  qual,
  lit,
  COL_TYPES,
  colTypeSql,
  colDefSql,
  parseTypeString,
  buildAddConstraintSql,
} from '../ddl.js';

const emptyCol = () => ({
  key: `new-${Math.random().toString(36).slice(2)}`,
  origName: null,
  name: '',
  type: 'VARCHAR2',
  size: '',
  scale: '',
  def: '',
  notNull: false,
  pk: false,
  origPk: false,
  comment: '',
  deleted: false,
});

function TypeSelect({ value, onChange, disabled }) {
  const known = COL_TYPES.some((t) => t.name === value);
  return (
    <select value={value} onChange={onChange} disabled={disabled}>
      {!known && <option value={value}>{value}</option>}
      {COL_TYPES.map((t) => (
        <option key={t.name} value={t.name}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

// Multi-select chips over an in-memory list of column names (as opposed to
// DdlModal's ColumnPicker, which always re-fetches from the live dictionary —
// here we also want to offer columns just added/renamed in this same dialog).
function ChipPicker({ options, value, onChange }) {
  if (!options.length) return <div className="tree-info">Nessuna colonna disponibile</div>;
  const toggle = (c) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  return (
    <div className="col-picker">
      {options.map((c) => {
        const idx = value.indexOf(c);
        return (
          <button
            key={c}
            type="button"
            className={`col-chip ${idx >= 0 ? 'on' : ''}`}
            onClick={() => toggle(c)}
          >
            {idx >= 0 && <span className="ord">{idx + 1}</span>}
            {c}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Colonne ---------- */

function ColumnsPane({ cols, setCols, cascadeDrop, setCascadeDrop }) {
  const setCol = (key, patch) => setCols((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const toggleDrop = (key) => setCols((cs) => cs.map((c) => (c.key === key ? { ...c, deleted: !c.deleted } : c)));
  const removeNew = (key) => setCols((cs) => cs.filter((c) => c.key !== key));
  const hasDeleted = cols.some((c) => c.origName != null && c.deleted);

  return (
    <div>
      <div className="coldef-grid tedit-cols-grid">
        {['PK', 'Nome', 'Tipo', 'Dim.', 'Scala', 'NN', 'Predefinito', 'Commento', ''].map((h, i) => (
          <span key={i} className="hd">
            {h}
          </span>
        ))}
        {cols.map((c) => {
          const spec = COL_TYPES.find((s) => s.name === c.type);
          const dis = c.deleted;
          return (
            <React.Fragment key={c.key}>
              <input
                type="checkbox"
                checked={c.pk}
                disabled={dis}
                onChange={(e) => setCol(c.key, { pk: e.target.checked, notNull: e.target.checked || c.notNull })}
              />
              <input value={c.name} disabled={dis} onChange={(e) => setCol(c.key, { name: e.target.value })} />
              <TypeSelect value={c.type} disabled={dis} onChange={(e) => setCol(c.key, { type: e.target.value })} />
              <input
                value={c.size}
                disabled={dis || (!spec?.size && !spec?.prec)}
                onChange={(e) => setCol(c.key, { size: e.target.value.replace(/\D/g, '') })}
              />
              <input
                value={c.scale}
                disabled={dis || !spec?.prec}
                onChange={(e) => setCol(c.key, { scale: e.target.value.replace(/\D/g, '') })}
              />
              <input
                type="checkbox"
                checked={c.notNull}
                disabled={dis || c.pk}
                onChange={(e) => setCol(c.key, { notNull: e.target.checked })}
              />
              <input
                value={c.def}
                placeholder="es. SYSDATE"
                disabled={dis}
                onChange={(e) => setCol(c.key, { def: e.target.value })}
              />
              <input value={c.comment} disabled={dis} onChange={(e) => setCol(c.key, { comment: e.target.value })} />
              {c.origName == null ? (
                <button className="icon-btn danger" title="Rimuovi" onClick={() => removeNew(c.key)}>
                  <X size={13} />
                </button>
              ) : c.deleted ? (
                <button className="icon-btn" title="Annulla eliminazione" onClick={() => toggleDrop(c.key)}>
                  <Undo2 size={13} />
                </button>
              ) : (
                <button className="icon-btn danger" title="Elimina colonna" onClick={() => toggleDrop(c.key)}>
                  <Trash2 size={13} />
                </button>
              )}
            </React.Fragment>
          );
        })}
      </div>
      <div className="tedit-actions">
        <button className="btn" onClick={() => setCols((cs) => [...cs, emptyCol()])}>
          <Plus size={13} /> Aggiungi colonna
        </button>
        {hasDeleted && (
          <label className="check-label">
            <span>CASCADE CONSTRAINTS (elimina anche i vincoli che dipendono dalle colonne rimosse)</span>
            <input type="checkbox" checked={cascadeDrop} onChange={(e) => setCascadeDrop(e.target.checked)} />
          </label>
        )}
      </div>
    </div>
  );
}

/* ---------- Vincoli ---------- */

const CTYPES = [
  ['PK', 'Primary Key'],
  ['UQ', 'Unique'],
  ['FK', 'Foreign Key'],
  ['CK', 'Check'],
];

function ConstraintAddForm({ connId, owner, table, ownCols, onCancel, onAdd }) {
  const [ctype, setCtype] = useState('PK');
  const [name, setName] = useState(`${dictName(table)}_PK`);
  const [touched, setTouched] = useState(false);
  const [cols, setColsSel] = useState([]);
  const [refOwner, setRefOwner] = useState(owner);
  const [refTable, setRefTable] = useState('');
  const [refCols, setRefCols] = useState([]);
  const [onDelete, setOnDelete] = useState('');
  const [condition, setCondition] = useState('');
  const dl = `dl-fk-${connId}`;

  const changeType = (v) => {
    setCtype(v);
    if (!touched) setName(`${dictName(table)}_${v}`);
  };

  const def = { ctype, name: name.trim(), cols, refOwner, refTable, refCols, onDelete, condition };
  const valid =
    !!name.trim() &&
    ((ctype === 'PK' && cols.length > 0) ||
      (ctype === 'UQ' && cols.length > 0) ||
      (ctype === 'FK' && cols.length > 0 && refTable.trim()) ||
      (ctype === 'CK' && condition.trim()));

  return (
    <div className="tedit-add-form">
      <TablesDatalist connId={connId} id={dl} />
      <div className="form-row">
        <label style={{ flex: 1 }}>
          Tipo
          <select value={ctype} onChange={(e) => changeType(e.target.value)}>
            {CTYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: 2 }}>
          Nome vincolo
          <input
            value={name}
            onChange={(e) => {
              setTouched(true);
              setName(e.target.value);
            }}
          />
        </label>
      </div>
      {ctype !== 'CK' && (
        <label>
          Colonne (clicca in ordine)
          <ChipPicker options={ownCols} value={cols} onChange={setColsSel} />
        </label>
      )}
      {ctype === 'FK' && (
        <>
          <div className="form-row">
            <label style={{ flex: 1 }}>
              Schema riferito
              <input value={refOwner} onChange={(e) => setRefOwner(e.target.value)} />
            </label>
            <label style={{ flex: 2 }}>
              Tabella riferita
              <input
                list={dl}
                value={refTable}
                onChange={(e) => {
                  setRefTable(e.target.value);
                  setRefCols([]);
                }}
              />
            </label>
            <label style={{ flex: 1 }}>
              ON DELETE
              <select value={onDelete} onChange={(e) => setOnDelete(e.target.value)}>
                <option value="">(no action)</option>
                <option value="CASCADE">CASCADE</option>
                <option value="SET NULL">SET NULL</option>
              </select>
            </label>
          </div>
          <label>
            Colonne riferite (vuoto = chiave primaria della tabella riferita)
            <ColumnPicker connId={connId} owner={refOwner} table={refTable} value={refCols} onChange={setRefCols} />
          </label>
        </>
      )}
      {ctype === 'CK' && (
        <label>
          Condizione CHECK
          <input value={condition} placeholder="es. STATO IN ('A','B')" onChange={(e) => setCondition(e.target.value)} />
        </label>
      )}
      <div className="tedit-actions">
        <button className="btn" onClick={onCancel}>
          Annulla
        </button>
        <button className="btn primary" disabled={!valid} onClick={() => onAdd(def)}>
          Aggiungi
        </button>
      </div>
    </div>
  );
}

function ConstraintsPane({ connId, owner, table, ownCols, existing, consDrop, setConsDrop, consAdd, setConsAdd, forcedDropNames }) {
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <table className="tedit-list">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Nome</th>
            <th>Colonne</th>
            <th>Dettagli</th>
            <th>Stato</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {existing.map((r) => {
            const forced = forcedDropNames.has(r[0]);
            const manual = consDrop.some((d) => d.name === r[0]);
            const dropping = forced || manual;
            return (
              <tr key={r[0]} className={dropping ? 'pending-drop' : ''}>
                <td>{r[1]}</td>
                <td>{r[0]}</td>
                <td>{r[2]}</td>
                <td>{r[4] || r[3] || ''}</td>
                <td>{r[5]}</td>
                <td>
                  {forced ? (
                    <span className="tedit-note" title="Verrà eliminato: la colonna PK è stata modificata o rimossa">
                      auto
                    </span>
                  ) : manual ? (
                    <button className="icon-btn" title="Annulla eliminazione" onClick={() => setConsDrop((d) => d.filter((x) => x.name !== r[0]))}>
                      <Undo2 size={13} />
                    </button>
                  ) : (
                    <button className="icon-btn danger" title="Elimina vincolo" onClick={() => setConsDrop((d) => [...d, { name: r[0], cascade: r[1] === 'Primary Key' || r[1] === 'Unique' }])}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {consAdd.map((c, i) => (
            <tr key={`new-${i}`} className="pending-add">
              <td>{CTYPES.find(([v]) => v === c.ctype)?.[1] || c.ctype}</td>
              <td>{c.name}</td>
              <td>{(c.cols || []).join(', ')}</td>
              <td>{c.ctype === 'FK' ? qual(c.refOwner, c.refTable) : c.condition || ''}</td>
              <td>—</td>
              <td>
                <button className="icon-btn danger" title="Rimuovi" onClick={() => setConsAdd((a) => a.filter((_, j) => j !== i))}>
                  <X size={13} />
                </button>
              </td>
            </tr>
          ))}
          {!existing.length && !consAdd.length && (
            <tr>
              <td colSpan={6} className="tree-info">
                Nessun vincolo
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {!adding ? (
        <button className="btn" onClick={() => setAdding(true)}>
          <Plus size={13} /> Aggiungi vincolo
        </button>
      ) : (
        <ConstraintAddForm
          connId={connId}
          owner={owner}
          table={table}
          ownCols={ownCols}
          onCancel={() => setAdding(false)}
          onAdd={(def) => {
            setConsAdd((a) => [...a, def]);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Indici ---------- */

function IndexAddForm({ ownCols, onCancel, onAdd }) {
  const [name, setName] = useState('');
  const [unique, setUnique] = useState(false);
  const [cols, setColsSel] = useState([]);
  const valid = !!name.trim() && cols.length > 0;

  return (
    <div className="tedit-add-form">
      <div className="form-row">
        <label style={{ flex: 2 }}>
          Nome indice
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="check-label" style={{ flex: 1 }}>
          <span>Univoco</span>
          <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} />
        </label>
      </div>
      <label>
        Colonne (clicca in ordine)
        <ChipPicker options={ownCols} value={cols} onChange={setColsSel} />
      </label>
      <div className="tedit-actions">
        <button className="btn" onClick={onCancel}>
          Annulla
        </button>
        <button className="btn primary" disabled={!valid} onClick={() => onAdd({ name: name.trim(), unique, cols })}>
          Aggiungi
        </button>
      </div>
    </div>
  );
}

function IndexesPane({ ownCols, existing, idxDrop, setIdxDrop, idxAdd, setIdxAdd }) {
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <table className="tedit-list">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Univoco</th>
            <th>Tipo</th>
            <th>Colonne</th>
            <th>Stato</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {existing.map((r) => {
            const dropping = idxDrop.some((d) => d.name === r[0]);
            return (
              <tr key={r[0]} className={dropping ? 'pending-drop' : ''}>
                <td>{r[0]}</td>
                <td>{r[2]}</td>
                <td>{r[3]}</td>
                <td>{r[4]}</td>
                <td>{r[5]}</td>
                <td>
                  {dropping ? (
                    <button className="icon-btn" title="Annulla eliminazione" onClick={() => setIdxDrop((d) => d.filter((x) => x.name !== r[0]))}>
                      <Undo2 size={13} />
                    </button>
                  ) : (
                    <button className="icon-btn danger" title="Elimina indice" onClick={() => setIdxDrop((d) => [...d, { name: r[0], owner: r[1] }])}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {idxAdd.map((d, i) => (
            <tr key={`new-${i}`} className="pending-add">
              <td>{d.name}</td>
              <td>{d.unique ? 'UNIQUE' : ''}</td>
              <td>—</td>
              <td>{d.cols.join(', ')}</td>
              <td>—</td>
              <td>
                <button className="icon-btn danger" title="Rimuovi" onClick={() => setIdxAdd((a) => a.filter((_, j) => j !== i))}>
                  <X size={13} />
                </button>
              </td>
            </tr>
          ))}
          {!existing.length && !idxAdd.length && (
            <tr>
              <td colSpan={6} className="tree-info">
                Nessun indice
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="tree-info">
        Nota: gli indici che supportano un vincolo (PK/UNIQUE) si eliminano rimuovendo il vincolo, nella scheda Vincoli.
      </div>
      {!adding ? (
        <button className="btn" onClick={() => setAdding(true)}>
          <Plus size={13} /> Aggiungi indice
        </button>
      ) : (
        <IndexAddForm
          ownCols={ownCols}
          onCancel={() => setAdding(false)}
          onAdd={(def) => {
            setIdxAdd((a) => [...a, def]);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Commento ---------- */

function CommentPane({ comment, setComment }) {
  return (
    <label>
      Commento sulla tabella
      <textarea className="sql-textarea" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} />
    </label>
  );
}

/* ---------- dialogo principale ---------- */

const NAV = [
  ['cols', 'Colonne'],
  ['cons', 'Vincoli'],
  ['idx', 'Indici'],
  ['cmt', 'Commento'],
];

export default function TableEditDialog({ connId, owner, table, onClose, onDone }) {
  const [loaded, setLoaded] = useState(null); // { cols, existingCons, existingIdx, origComment, origMap, pkConstraintName }
  const [nav, setNav] = useState('cols');
  const [newName, setNewName] = useState(table);
  const [cols, setCols] = useState([]);
  const [cascadeDrop, setCascadeDrop] = useState(false);
  const [consDrop, setConsDrop] = useState([]);
  const [consAdd, setConsAdd] = useState([]);
  const [idxDrop, setIdxDrop] = useState([]);
  const [idxAdd, setIdxAdd] = useState([]);
  const [comment, setComment] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.tableColumns(connId, owner, table),
      api.tableConstraints(connId, owner, table),
      api.tableIndexes(connId, owner, table),
      api.tableComment(connId, owner, table).catch(() => ({ comment: '' })),
    ]).then(([colsR, consR, idxR, cmtR]) => {
      if (!alive) return;
      const origMap = new Map();
      const parsedCols = (colsR.rows || []).map((row) => {
        const t = parseTypeString(row[2]);
        const isPk = row[4] === 'PK';
        const parsed = {
          key: row[1],
          origName: row[1],
          name: row[1],
          type: t.type,
          size: t.size,
          scale: t.scale,
          notNull: row[3] === 'NOT NULL',
          def: String(row[5] ?? '').trim(),
          comment: row[6] ?? '',
          pk: isPk,
          origPk: isPk,
          deleted: false,
        };
        origMap.set(row[1], parsed);
        return parsed;
      });
      const existingCons = consR.rows || [];
      const pkRow = existingCons.find((r) => r[1] === 'Primary Key');
      setCols(parsedCols);
      setNewName(table);
      setComment(cmtR.comment || '');
      setLoaded({
        origMap,
        existingCons,
        existingIdx: idxR.rows || [],
        origComment: cmtR.comment || '',
        pkConstraintName: pkRow?.[0] || null,
      });
    });
    return () => {
      alive = false;
    };
  }, [connId, owner, table]);

  const t = qual(owner, table);
  const ownCols = cols.filter((c) => !c.deleted).map((c) => c.name).filter(Boolean);

  const statements = useMemo(() => {
    if (!loaded) return [];
    const adds = [];
    const mods = [];
    const comments = [];
    const drops = [];
    for (const c of cols) {
      if (c.origName == null) {
        if (!c.name.trim()) continue;
        adds.push(`ALTER TABLE ${t} ADD (${colDefSql(c)})`);
        if (c.comment.trim()) comments.push(`COMMENT ON COLUMN ${t}.${ident(c.name)} IS ${lit(c.comment.trim())}`);
        continue;
      }
      if (c.deleted) {
        drops.push(`ALTER TABLE ${t} DROP COLUMN ${ident(c.origName)}${cascadeDrop ? ' CASCADE CONSTRAINTS' : ''}`);
        continue;
      }
      const orig = loaded.origMap.get(c.origName);
      const m = [];
      if (c.type !== orig.type || String(c.size) !== String(orig.size) || String(c.scale) !== String(orig.scale))
        m.push(colTypeSql(c));
      if ((c.def || '').trim() !== (orig.def || '').trim()) m.push(`DEFAULT ${c.def.trim() || 'NULL'}`);
      if (c.notNull !== orig.notNull) m.push(c.notNull ? 'NOT NULL' : 'NULL');
      if (m.length) mods.push(`ALTER TABLE ${t} MODIFY (${ident(c.origName)} ${m.join(' ')})`);
      if (dictName(c.name) !== dictName(c.origName)) mods.push(`ALTER TABLE ${t} RENAME COLUMN ${ident(c.origName)} TO ${ident(c.name)}`);
      if ((c.comment || '') !== (orig.comment || '')) comments.push(`COMMENT ON COLUMN ${t}.${ident(c.name)} IS ${lit(c.comment || '')}`);
    }

    // PK checkbox (Colonne) is a shortcut over the underlying PK constraint:
    // any change to the set of PK-flagged columns replaces it wholesale.
    const dropMap = new Map();
    const consAddSql = [];
    const origPk = cols.filter((c) => c.origPk).map((c) => dictName(c.origName)).sort();
    const newPk = cols.filter((c) => c.pk && !c.deleted).map((c) => dictName(c.name)).sort();
    if (JSON.stringify(origPk) !== JSON.stringify(newPk)) {
      if (origPk.length && loaded.pkConstraintName) dropMap.set(loaded.pkConstraintName, true);
      if (newPk.length)
        consAddSql.push(`ALTER TABLE ${t} ADD CONSTRAINT ${ident(dictName(table) + '_PK')} PRIMARY KEY (${newPk.map(ident).join(', ')})`);
    }
    for (const d of consDrop) dropMap.set(d.name, dropMap.get(d.name) || d.cascade);
    for (const def of consAdd) {
      const sql = buildAddConstraintSql(owner, table, def);
      if (sql) consAddSql.push(sql);
    }
    const consDropSql = [...dropMap.entries()].map(([name, cascade]) => `ALTER TABLE ${t} DROP CONSTRAINT ${ident(name)}${cascade ? ' CASCADE' : ''}`);

    const idxDropSql = idxDrop.map((d) => `DROP INDEX ${qual(d.owner, d.name)}`);
    const idxAddSql = idxAdd.map((d) => `CREATE ${d.unique ? 'UNIQUE ' : ''}INDEX ${qual(owner, d.name)} ON ${t} (${d.cols.map(ident).join(', ')})`);

    const commentSql = comment !== loaded.origComment ? [`COMMENT ON TABLE ${t} IS ${lit(comment)}`] : [];
    const renameSql =
      newName.trim() && dictName(newName) !== dictName(table) ? [`ALTER TABLE ${t} RENAME TO ${ident(newName)}`] : [];

    return [
      ...adds,
      ...mods,
      ...comments,
      ...consDropSql,
      ...consAddSql,
      ...drops,
      ...idxDropSql,
      ...idxAddSql,
      ...commentSql,
      ...renameSql,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, cols, cascadeDrop, consDrop, consAdd, idxDrop, idxAdd, comment, newName, owner, table, t]);

  const forcedDropNames = useMemo(() => {
    if (!loaded) return new Set();
    const origPk = cols.filter((c) => c.origPk).map((c) => dictName(c.origName)).sort();
    const newPk = cols.filter((c) => c.pk && !c.deleted).map((c) => dictName(c.name)).sort();
    const set = new Set();
    if (JSON.stringify(origPk) !== JSON.stringify(newPk) && origPk.length && loaded.pkConstraintName) set.add(loaded.pkConstraintName);
    return set;
  }, [loaded, cols]);

  const rename = dictName(newName) !== dictName(table) ? dictName(newName) : null;

  return (
    <DdlModal
      title={`Modifica tabella — ${owner}.${table}`}
      connId={connId}
      statements={statements}
      valid={statements.length > 0}
      execLabel="Applica"
      wide
      extraClass="tedit-modal"
      onClose={onClose}
      onDone={() => onDone(rename)}
    >
      <label>
        Nome
        <input value={newName} onChange={(e) => setNewName(e.target.value)} />
      </label>
      {!loaded ? (
        <div className="tree-info">Caricamento…</div>
      ) : (
        <div className="tedit">
          <div className="tedit-nav">
            {NAV.map(([key, label]) => (
              <button key={key} className={nav === key ? 'on' : ''} onClick={() => setNav(key)}>
                {label}
              </button>
            ))}
          </div>
          <div className="tedit-content">
            {nav === 'cols' && (
              <ColumnsPane cols={cols} setCols={setCols} cascadeDrop={cascadeDrop} setCascadeDrop={setCascadeDrop} />
            )}
            {nav === 'cons' && (
              <ConstraintsPane
                connId={connId}
                owner={owner}
                table={table}
                ownCols={ownCols}
                existing={loaded.existingCons}
                consDrop={consDrop}
                setConsDrop={setConsDrop}
                consAdd={consAdd}
                setConsAdd={setConsAdd}
                forcedDropNames={forcedDropNames}
              />
            )}
            {nav === 'idx' && (
              <IndexesPane ownCols={ownCols} existing={loaded.existingIdx} idxDrop={idxDrop} setIdxDrop={setIdxDrop} idxAdd={idxAdd} setIdxAdd={setIdxAdd} />
            )}
            {nav === 'cmt' && <CommentPane comment={comment} setComment={setComment} />}
          </div>
        </div>
      )}
    </DdlModal>
  );
}
