import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

// A small OpenStreetMap tile map with no dependencies (Web Mercator maths).
// - picker: the pin stays in the middle and the map drags under it; letting go
//   reports the new centre through onChange.
// - markers: driver pins. "live" is a dot, "base" a soft ~2 km circle
//   ("Usually around here"), so a home address is never pinned exactly.

const TILE = 256;
const TILE_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

function project(lat, lng, z) {
  const scale = TILE * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

function unproject(x, y, z) {
  const scale = TILE * 2 ** z;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lng };
}

function metresPerPixel(lat, z) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

export default function PinMap({
  lat,
  lng,
  zoom = 14,
  height = 260,
  picker = false,
  onChange,
  markers = [],
  baseRadiusM = 2000,
  label,
}) {
  const boxRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState(null); // { x0, y0, dx, dy }
  const [z, setZ] = useState(zoom);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => setZ(zoom), [zoom]);

  const centre = project(lat, lng, z);
  const dx = drag ? drag.dx : 0;
  const dy = drag ? drag.dy : 0;
  const left = centre.x - width / 2 - dx;
  const top = centre.y - height / 2 - dy;

  const tiles = [];
  if (width) {
    const max = 2 ** z;
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
        if (ty < 0 || ty >= max) continue;
        const wrapped = ((tx % max) + max) % max;
        tiles.push(
          <img
            key={`${tx}:${ty}`}
            className="pinmap-tile"
            src={TILE_URL(z, wrapped, ty)}
            alt=""
            draggable={false}
            style={{ left: tx * TILE - left, top: ty * TILE - top }}
          />
        );
      }
    }
  }

  const onPointerDown = (e) => {
    if (!picker) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 });
  };
  const onPointerMove = (e) => {
    if (!drag) return;
    setDrag({ ...drag, dx: e.clientX - drag.x0, dy: e.clientY - drag.y0 });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const next = unproject(centre.x - drag.dx, centre.y - drag.dy, z);
    setDrag(null);
    if (onChange && (drag.dx || drag.dy)) onChange(next);
  };

  const baseRadiusPx = (m) => baseRadiusM / metresPerPixel(m.lat, z);

  return (
    <div
      ref={boxRef}
      className={`pinmap${picker ? ' picker' : ''}${drag ? ' dragging' : ''}`}
      style={{ height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role={picker ? 'application' : 'img'}
      aria-label={label || (picker ? 'Drag the map to move the pin' : 'Map')}
    >
      {tiles}
      {markers.map((m, i) => {
        const p = project(m.lat, m.lng, z);
        const x = p.x - left;
        const y = p.y - top;
        if (m.kind === 'base') {
          const r = baseRadiusPx(m);
          return (
            <span
              key={i}
              className="pinmap-area"
              style={{ left: x - r, top: y - r, width: r * 2, height: r * 2 }}
              title={m.title || 'Usually around here'}
            />
          );
        }
        return (
          <span key={i} className="pinmap-dot" style={{ left: x, top: y }} title={m.title || ''} />
        );
      })}
      {picker && <span className="pinmap-pin" aria-hidden="true" />}
      <div className="pinmap-zoom" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" aria-label="Zoom in" onClick={() => setZ((v) => Math.min(18, v + 1))}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => setZ((v) => Math.max(3, v - 1))}>
          −
        </button>
      </div>
      <a
        className="pinmap-credit"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        onPointerDown={(e) => e.stopPropagation()}
      >
        © OpenStreetMap
      </a>
    </div>
  );
}
