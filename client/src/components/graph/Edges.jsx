import React from 'react';
import { routeEdges } from '../../graph/routing.js';

// Strato degli archi: un solo <svg> per tutto il diagramma, un <path> per
// arco. Sotto ogni percorso visibile ne corre uno trasparente e spesso: è
// quello che intercetta i clic, perché una linea da un pixel non si prende.

export default function Edges({ edges, layout, view, selected, onSelect, onOpen, linking, box }) {
  const routed = routeEdges(edges, layout, view);

  return (
    <svg className="gedges" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
      <defs>
        <marker id="g-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 7 4 L 0 7 z" fill="currentColor" />
        </marker>
      </defs>
      <g transform={`translate(${-box.x}, ${-box.y})`}>
        {routed.map((e) => {
          const on = selected === e.uid;
          const composite = e.fromColumnUids.length > 1;
          return (
            <g key={e.uid} className={`gedge ${on ? 'on' : ''}`}>
              <path
                className="gedge-hit"
                d={e.d}
                onPointerDown={(ev) => {
                  ev.stopPropagation();
                  onSelect(e.uid);
                }}
                onDoubleClick={(ev) => {
                  ev.stopPropagation();
                  onOpen(e.uid);
                }}
              />
              <path className="gedge-line" d={e.d} markerEnd="url(#g-arrow)" />
              {composite && (
                <text className="gedge-badge" x={(e.a.x + e.b.x) / 2} y={(e.a.y + e.b.y) / 2 - 6}>
                  ×{e.fromColumnUids.length}
                </text>
              )}
            </g>
          );
        })}
        {linking?.to && (
          <path
            className="gedge-line linking"
            d={`M ${linking.from.x} ${linking.from.y} L ${linking.to.x} ${linking.to.y}`}
          />
        )}
      </g>
    </svg>
  );
}
