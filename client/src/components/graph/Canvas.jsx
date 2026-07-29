import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

// Superficie del diagramma: sposta, ingrandisce, seleziona a rettangolo.
//
// Un solo `transform` sul contenitore, composto dalla GPU: i nodi restano in
// coordinate del grafo e nessuno di loro si ridisegna quando ci si muove.

const MIN_Z = 0.08;
const MAX_Z = 2.2;

const clampZoom = (z) => Math.min(MAX_Z, Math.max(MIN_Z, z));

const Canvas = forwardRef(function Canvas(
  { viewport, onViewport, onRubberBand, onBackgroundDown, onContextMenu, children },
  ref
) {
  const el = useRef(null);
  const [band, setBand] = useState(null);
  const [panning, setPanning] = useState(false);
  // Il trascinamento in corso vive in un ref: aggiornarlo non deve far
  // ridisegnare l'albero a ogni movimento del mouse.
  const drag = useRef(null);

  const area = useCallback(() => el.current?.getBoundingClientRect() ?? null, []);

  // Dal pixel sullo schermo al punto nel grafo.
  const toGraph = useCallback(
    (clientX, clientY) => {
      const box = area();
      if (!box) return { x: 0, y: 0 };
      return {
        x: (clientX - box.left - viewport.x) / viewport.z,
        y: (clientY - box.top - viewport.y) / viewport.z,
      };
    },
    [area, viewport]
  );

  useImperativeHandle(ref, () => ({ toGraph, area, el: () => el.current }), [toGraph, area]);

  // La rotella non deve mai scorrere la pagina sotto: il listener va
  // registrato a mano perché React lo attacca in modalità passiva.
  useEffect(() => {
    const node = el.current;
    if (!node) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const box = node.getBoundingClientRect();
      const cx = e.clientX - box.left;
      const cy = e.clientY - box.top;
      if (e.shiftKey && !e.ctrlKey) {
        onViewport({ ...viewport, x: viewport.x - e.deltaY, y: viewport.y - e.deltaX });
        return;
      }
      const z = clampZoom(viewport.z * Math.exp(-e.deltaY * 0.0015));
      // Il punto sotto il puntatore resta dov'è.
      const gx = (cx - viewport.x) / viewport.z;
      const gy = (cy - viewport.y) / viewport.z;
      onViewport({ z, x: cx - gx * z, y: cy - gy * z });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [viewport, onViewport]);

  const onPointerDown = (e) => {
    if (e.target.closest('.gnode, .gedge-hit')) return;
    const box = area();
    const pan = e.button === 1 || e.altKey || e.button === 2;
    setPanning(pan);
    drag.current = {
      panning: pan,
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...viewport },
      from: { x: e.clientX - box.left, y: e.clientY - box.top },
      additive: e.shiftKey || e.ctrlKey || e.metaKey,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!pan) onBackgroundDown?.(e, drag.current.additive);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    d.moved = true;
    if (d.panning) {
      onViewport({ ...d.origin, x: d.origin.x + dx, y: d.origin.y + dy });
      return;
    }
    const box = area();
    setBand({
      x: Math.min(d.from.x, e.clientX - box.left),
      y: Math.min(d.from.y, e.clientY - box.top),
      w: Math.abs(dx),
      h: Math.abs(dy),
    });
  };

  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    if (band) {
      const box = area();
      // Il rettangolo torna in coordinate del grafo: la selezione ragiona lì.
      onRubberBand?.(
        {
          x: (band.x - viewport.x) / viewport.z,
          y: (band.y - viewport.y) / viewport.z,
          w: band.w / viewport.z,
          h: band.h / viewport.z,
        },
        d?.additive
      );
      setBand(null);
    }
    if (e.currentTarget.hasPointerCapture?.(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      ref={el}
      className={`gcanvas ${panning ? 'panning' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(e);
      }}
    >
      <div
        className="gworld"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.z})`,
        }}
      >
        {children}
      </div>
      {band && (
        <div
          className="gband"
          style={{ left: band.x, top: band.y, width: band.w, height: band.h }}
        />
      )}
    </div>
  );
});

export default Canvas;
