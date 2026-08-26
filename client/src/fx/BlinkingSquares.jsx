// Blinking Squares — ambient canvas twinkle field (ported from Originkit's
// `blinkingsquares`, JS + our palette, dependency-free). Each cell has its own
// phase and rate so the field never pulses in sync; a cursor halo brightens
// squares near the pointer. Fades toward the bottom so content stays readable.
import { useEffect, useRef } from "react";

const PALETTE = [
  [255, 61, 127], // pink
  [54, 216, 255], // cyan
  [255, 201, 60], // amber
];

export function BlinkingSquares({ gridSize = 26, opacity = 0.5, className = "" }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = null;
    let cells = [];
    let cols = 0, rows = 0, cellSize = 0;
    const size = { w: 0, h: 0 };
    const pointer = { x: -9999, y: -9999, active: false };
    const start = performance.now();

    const ensureCells = (c, r) => {
      if (cells.length === c * r) return;
      cells = Array.from({ length: c * r }, (_, i) => {
        // Hashed pseudo-random for per-cell determinism (same trick as source).
        const h = (k, m) => { const s = Math.sin(i * k + m) * 43758.5453; return s - Math.floor(s); };
        return { phase: h(12.9898, 78.233) * Math.PI * 2, rate: 0.6 + h(7.137, 33.71) * 0.8, tint: h(3.51, 5.91) };
      });
    };

    const resize = () => {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      size.w = w; size.h = h;
      cellSize = Math.max(w, h) / gridSize;
      cols = Math.max(1, Math.ceil(w / cellSize));
      rows = Math.max(1, Math.ceil(h / cellSize));
      cells = [];
    };

    const frame = (now) => {
      ensureCells(cols, rows);
      ctx.clearRect(0, 0, size.w, size.h);
      const t = (now - start) / 1000;
      const r2 = 140 * 140; // cursor halo radius²
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const cell = cells[y * cols + x];
          // Bottom fade: full up top, gone by ~70% down.
          const u = y / Math.max(1, rows - 1);
          let envelope = u < 0.25 ? 1 : u > 0.7 ? 0 : Math.pow(1 - (u - 0.25) / 0.45, 1.6);
          if (pointer.active) {
            const dx = x * cellSize + cellSize / 2 - pointer.x;
            const dy = y * cellSize + cellSize / 2 - pointer.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < r2) { const k = 1 - d2 / r2; envelope = Math.min(1, envelope + k * k * 0.6); }
          }
          if (envelope <= 0.002) continue;
          const twinkle = 0.5 + 0.5 * Math.sin(t * 1.4 * cell.rate + cell.phase);
          const a = envelope * twinkle * opacity;
          if (a <= 0.004) continue;
          const [r, g, b] = PALETTE[Math.floor(cell.tint * PALETTE.length)];
          ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
          const inset = cellSize * 0.36;
          ctx.fillRect(x * cellSize + inset / 2, y * cellSize + inset / 2, cellSize - inset, cellSize - inset);
        }
      }
      raf = requestAnimationFrame(frame);
    };

    const onMove = (e) => {
      const rect = container.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.active = true;
    };
    const onLeave = () => { pointer.active = false; };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(frame);
    return () => {
      ro.disconnect();
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [gridSize, opacity]);

  return (
    <div ref={containerRef} aria-hidden="true" className={`pointer-events-auto absolute inset-0 overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
