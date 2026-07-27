import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';

// Tiene il menu dentro la finestra: se non ci sta a destra/in basso lo sposta.
function fit(x, y, el) {
  if (!el) return { left: x, top: y };
  const { width, height } = el.getBoundingClientRect();
  return {
    left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
    top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
  };
}

function Submenu({ items, anchor, onClose, onEnter }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: anchor.right, top: anchor.top, visibility: 'hidden' });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width } = el.getBoundingClientRect();
    // Si apre a sinistra della voce se a destra non c'è spazio.
    const x = anchor.right + width + 4 > window.innerWidth ? anchor.left - width : anchor.right;
    setPos({ ...fit(x, anchor.top - 4, el), visibility: 'visible' });
  }, [anchor]);

  return (
    <div className="ctx-menu ctx-sub" ref={ref} style={pos} onMouseEnter={onEnter}>
      <MenuItems items={items} onClose={onClose} />
    </div>
  );
}

function MenuItems({ items, onClose }) {
  const [openSub, setOpenSub] = useState(null); // { index, rect }
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const hover = (e, item, index) => {
    clearTimeout(timer.current);
    if (!item.submenu) {
      // Piccolo ritardo: dà il tempo di raggiungere il sottomenu in diagonale.
      timer.current = setTimeout(() => setOpenSub(null), 250);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    setOpenSub({ index, rect: { left: r.left, right: r.right, top: r.top } });
  };

  return (
    <>
      {items.map((item, i) => {
        if (item.separator) return <div key={`sep-${i}`} className="ctx-sep" />;
        if (item.input) {
          return <ContextInput key={`input-${i}`} item={item} onClose={onClose} />;
        }
        return (
          <React.Fragment key={item.label}>
            <button
              type="button"
              className={`${item.danger ? 'danger' : ''} ${item.checked ? 'checked' : ''} ${
                openSub?.index === i ? 'sub-open' : ''
              }`}
              disabled={item.disabled}
              onMouseEnter={(e) => hover(e, item, i)}
              onClick={(e) => {
                if (item.submenu) {
                  const r = e.currentTarget.getBoundingClientRect();
                  setOpenSub((s) => (s?.index === i ? null : { index: i, rect: { left: r.left, right: r.right, top: r.top } }));
                  return;
                }
                item.onClick?.();
                onClose();
              }}
            >
              <span className="ctx-label">{item.label}</span>
              {item.hint && <span className="ctx-hint">{item.hint}</span>}
              {item.submenu && <ChevronRight size={13} className="ctx-arrow" />}
            </button>
            {openSub?.index === i && item.submenu && (
              <Submenu
                items={item.submenu}
                anchor={openSub.rect}
                onClose={onClose}
                onEnter={() => clearTimeout(timer.current)}
              />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

function ContextInput({ item, onClose }) {
  const [value, setValue] = useState('');
  return (
    <input
      className="ctx-input"
      placeholder={item.placeholder}
      value={value}
      autoFocus={item.autoFocus}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && value.trim()) {
          item.onSubmit(value.trim());
          onClose();
        } else if (e.key === 'Escape') {
          onClose();
        }
      }}
    />
  );
}

// Menu contestuale a più livelli: le voci con `submenu` aprono un pannello
// laterale al passaggio del mouse, senza finestre modali.
export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y, visibility: 'hidden' });

  useLayoutEffect(() => {
    setPos({ ...fit(x, y, ref.current), visibility: 'visible' });
  }, [x, y]);

  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  return (
    <div
      className="ctx-overlay"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="ctx-menu" ref={ref} style={pos} onClick={(e) => e.stopPropagation()}>
        <MenuItems items={items} onClose={onClose} />
      </div>
    </div>
  );
}
