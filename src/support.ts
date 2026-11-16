// Supporting TinyCutList: the Ko-fi page, in one place for every surface that
// shows it (the printable page now, the plugin window from Hew's M3 on).
//
// Ko-fi's own widget loads a script from storage.ko-fi.com to draw a link. We
// draw the same link ourselves instead: the page stays one self-contained file
// that opens offline and calls no one, and the plugin's sandboxed window won't
// load outside scripts anyway.

export const KOFI = {
  id: "K8C82AR8S0",
  url: "https://ko-fi.com/K8C82AR8S0",
  label: "Support me on Ko-fi",
  color: "#20bf50",
} as const;

/** A coffee cup, drawn in the button's text color. */
const CUP =
  `<svg class="tcl-kofi-cup" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">` +
  `<path d="M3 8h13v6a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8z" fill="currentColor"/>` +
  `<path d="M16 9.5h1.5a2.5 2.5 0 0 1 0 5H16" fill="none" stroke="currentColor" stroke-width="2"/>` +
  `<path d="M9.5 15.2c-1.8-1.3-3-2.3-3-3.5 0-.8.6-1.4 1.4-1.4.7 0 1.2.4 1.6.9.4-.5.9-.9 1.6-.9.8 0 1.4.6 1.4 1.4 0 1.2-1.2 2.2-3 3.5z" fill="${KOFI.color}"/>` +
  `</svg>`;

/** The Ko-fi button as HTML, with the CSS it needs (class `tcl-kofi`). */
export const KOFI_CSS =
  `.tcl-kofi { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 8px; ` +
  `background: ${KOFI.color}; color: #fff; font-weight: 600; text-decoration: none; } ` +
  `.tcl-kofi:hover { filter: brightness(1.07); } .tcl-kofi:focus-visible { outline: 2px solid var(--ink, #1d1b18); outline-offset: 2px; }`;

export function kofiButtonHtml(): string {
  return `<a class="tcl-kofi" href="${KOFI.url}" target="_blank" rel="noopener">${CUP}${KOFI.label}</a>`;
}
