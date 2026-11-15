// Cutting diagrams as SVG: one sheet or one bar, drawn to scale in millimeters.
// Each part shows its label, and its size where it fits; colors come from CSS
// classes (tcl-*), so a page can theme them.

import type { BarLayout, SheetLayout } from "./nesting.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => String(Math.round(v * 10) / 10);
const size = (a: number, b: number) => `${n(a)} × ${n(b)}`;

/** A label, and the size under it, as large as the box allows (or nothing if it doesn't fit). */
function texts(cx: number, cy: number, w: number, h: number, label: string, sub: string, max: number): string {
  const fs = Math.min(max, h * 0.42, (w * 0.9) / Math.max(1, label.length * 0.62));
  if (fs < max * 0.18) return "";
  let out = `<text class="tcl-label" x="${n(cx)}" y="${n(cy)}" font-size="${n(fs)}" text-anchor="middle" dominant-baseline="central">${esc(label)}</text>`;
  const fs2 = Math.min(fs * 0.45, (w * 0.9) / Math.max(1, sub.length * 0.55));
  if (sub && fs2 >= max * 0.12 && h >= fs + fs2 * 1.6) {
    out = `<text class="tcl-label" x="${n(cx)}" y="${n(cy - fs2 * 0.6)}" font-size="${n(fs)}" text-anchor="middle" dominant-baseline="central">${esc(label)}</text>`;
    out += `<text class="tcl-size" x="${n(cx)}" y="${n(cy + fs * 0.55)}" font-size="${n(fs2)}" text-anchor="middle" dominant-baseline="central">${esc(sub)}</text>`;
  }
  return out;
}

let nextId = 0;

export function sheetSvg(s: SheetLayout, opts: { trim: number; grain: boolean }): string {
  const { length: L, width: W } = s;
  const hatch = `tcl-hatch-${++nextId}`;
  const max = Math.min(L, W) * 0.09;
  const flip = (y: number, h: number) => W - y - h; // PackingSolver's y runs up, SVG's runs down
  const parts = s.parts.map((p) => {
    const [w, h] = p.rotated ? [p.width, p.length] : [p.length, p.width];
    const y = flip(p.y, h);
    return (
      `<g><title>${esc(`${p.label} ${p.name}: ${size(p.length, p.width)}${p.rotated ? ", turned" : ""}`)}</title>` +
      `<rect class="tcl-part" x="${n(p.x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/>` +
      texts(p.x + w / 2, y + h / 2, w, h, p.label, size(p.length, p.width), max) +
      `</g>`
    );
  });
  const offcuts = s.offcuts.map((o) => {
    const y = flip(o.y, o.width);
    return (
      `<g><title>${esc(`offcut ${size(o.length, o.width)}`)}</title>` +
      `<rect class="tcl-offcut" fill="url(#${hatch})" x="${n(o.x)}" y="${n(y)}" width="${n(o.length)}" height="${n(o.width)}"/>` +
      texts(o.x + o.length / 2, y + o.width / 2, o.length, o.width, size(o.length, o.width), "", max * 0.6) +
      `</g>`
    );
  });
  const t = opts.trim;
  const grain = opts.grain
    ? `<text class="tcl-grain" x="${n(L - max * 0.3)}" y="${n(max * 0.5)}" font-size="${n(max * 0.35)}" text-anchor="end" dominant-baseline="central">grain →</text>`
    : "";
  return (
    `<svg class="tcl-sheet" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(L)} ${n(W)}" role="img" aria-label="${esc(`sheet ${size(L, W)}`)}">` +
    `<defs><pattern id="${hatch}" patternUnits="userSpaceOnUse" width="${n(max * 0.25)}" height="${n(max * 0.25)}" patternTransform="rotate(45)">` +
    `<line class="tcl-hatch" x1="0" y1="0" x2="0" y2="${n(max * 0.25)}"/></pattern></defs>` +
    `<rect class="tcl-stock" x="0" y="0" width="${n(L)}" height="${n(W)}"/>` +
    (t > 0 ? `<rect class="tcl-trim" x="${n(t)}" y="${n(t)}" width="${n(L - 2 * t)}" height="${n(W - 2 * t)}"/>` : "") +
    offcuts.join("") + parts.join("") + grain +
    `</svg>`
  );
}

export function barSvg(b: BarLayout, opts: { trim: number; section?: [number, number] }): string {
  const L = b.length;
  const H = Math.max(L * 0.035, 40);
  const parts = b.parts.map(
    (p) =>
      `<g><title>${esc(`${p.label} ${p.name}: ${n(p.length)}`)}</title>` +
      `<rect class="tcl-part" x="${n(p.x)}" y="0" width="${n(p.length)}" height="${n(H)}"/>` +
      texts(p.x + p.length / 2, H / 2, p.length, H, p.label, n(p.length), H * 0.7) +
      `</g>`,
  );
  return (
    `<svg class="tcl-bar" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(L)} ${n(H)}" role="img" aria-label="${esc(`bar ${n(L)}`)}">` +
    `<rect class="tcl-stock" x="0" y="0" width="${n(L)}" height="${n(H)}"/>` +
    (opts.trim > 0 ? `<rect class="tcl-trim" x="${n(opts.trim)}" y="0" width="${n(L - 2 * opts.trim)}" height="${n(H)}"/>` : "") +
    parts.join("") +
    `</svg>`
  );
}
