import React, { useCallback, useEffect, useRef, useState } from 'react';

// Maniglia di ridimensionamento fra due pannelli.
//
// `direction`:
//   'left'  la maniglia sta a destra del pannello  (trascinare a destra allarga)
//   'right' la maniglia sta a sinistra del pannello (trascinare a sinistra allarga)
//   'up'    la maniglia sta sopra il pannello       (trascinare in alto alza)
//
// Il valore corrente arriva da fuori (`value`) e viene rilanciato a ogni
// movimento con `onChange`: chi la usa decide dove salvarlo.
export default function Resizer({ direction, value, onChange, min = 120, max = 1200, onReset }) {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ pos: 0, value: 0 });
  const vertical = direction === 'up' || direction === 'down';

  const onPointerDown = (e) => {
    e.preventDefault();
    start.current = { pos: vertical ? e.clientY : e.clientX, value };
    setDragging(true);
  };

  const clamp = useCallback((v) => Math.min(max, Math.max(min, v)), [min, max]);

  useEffect(() => {
    if (!dragging) return undefined;
    const move = (e) => {
      const delta = (vertical ? e.clientY : e.clientX) - start.current.pos;
      const sign = direction === 'left' || direction === 'down' ? 1 : -1;
      onChange(Math.round(clamp(start.current.value + delta * sign)));
    };
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    // Durante il trascinamento il cursore non deve cambiare passando sopra
    // altri elementi, e il testo non deve selezionarsi.
    const prev = document.body.style.cursor;
    document.body.style.cursor = vertical ? 'row-resize' : 'col-resize';
    document.body.classList.add('resizing');
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = prev;
      document.body.classList.remove('resizing');
    };
  }, [dragging, direction, vertical, onChange, clamp]);

  return (
    <div
      className={`resizer ${vertical ? 'horizontal' : 'vertical'} ${dragging ? 'on' : ''}`}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      title="Trascina per ridimensionare (doppio clic per il valore predefinito)"
    />
  );
}
