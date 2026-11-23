// TinyCutList's window: the parts list, the stock, the cutting plans and the
// exports, for the model at hand. Plain DOM, no framework; everything it
// knows comes through a Bridge (src/ui/protocol.ts).

import type { CutList, Part } from "../cutlist/count.ts";
import type { CutGroup, CutPlan } from "../cutlist/nesting.ts";
import { PRESETS } from "../cutlist/presets.ts";
import { NO_MATERIAL, keyOf, resolve, type Stock, type StockEntry } from "../cutlist/stock.ts";
import { barSvg, sheetSvg } from "../cutlist/svg.ts";
import { KOFI_CSS, kofiButtonHtml } from "../support.ts";
import { httpBridge } from "./bridge-http.ts";
import type { Bridge, ExportFormat, Info, Summary } from "./protocol.ts";

type Tab = "parts" | "stock" | "plans" | "export";

const bridge: Bridge = httpBridge;
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mm = (v: number) => String(Math.round(v * 10) / 10);
const dims = (s: number[]) => s.map(mm).join(" × ");
const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

const state = {
  info: null as Info | null,
  cutList: null as CutList | null,
  plan: null as CutPlan | null,
  summary: null as Summary | null,
  seconds: 0,
  stock: {} as Stock,
  /** Edits not saved yet, by material. */
  drafts: {} as Stock,
  tab: (sessionTab() ?? "parts") as Tab,
  filter: "",
  highlight: null as string | null,
  busy: false,
};

function sessionTab(): Tab | null {
  try {
    const t = sessionStorage.getItem("tcl-tab");
    return t === "parts" || t === "stock" || t === "plans" || t === "export" ? t : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- status

let statusTimer = 0;
function status(text: string, error = false) {
  const el = $("#status")!;
  el.textContent = text;
  el.className = `status on${error ? " err" : ""}`;
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (el.className = "status"), error ? 6000 : 2500);
}

async function run<T>(what: string, f: () => Promise<T>): Promise<T | undefined> {
  try {
    return await f();
  } catch (e: any) {
    status(`${what}: ${e?.message ?? e}`, true);
    return undefined;
  }
}

// ---------------------------------------------------------------- loading

async function load(refresh: boolean) {
  state.busy = true;
  renderHeader();
  const r = await run("Couldn't read the model", () => bridge.call("cut_list", { refresh }));
  state.busy = false;
  if (r) {
    state.cutList = r.cutList;
    state.plan = r.plan;
    state.summary = r.summary;
    state.seconds = r.seconds;
  }
  render();
}

async function boot() {
  const info = await run("Couldn't reach TinyCutList", () => bridge.call("info", {}));
  if (!info) {
    $("#app")!.innerHTML = `<div class="busy">TinyCutList isn't answering. Is <code>tinycutlist serve</code> still running?</div>`;
    return;
  }
  state.info = info;
  document.title = `${info.title} — TinyCutList`;
  const st = await run("Couldn't read the stock", () => bridge.call("get_stock", {}));
  state.stock = st?.stock ?? {};
  $("#app")!.innerHTML = `
    <header id="header"></header>
    <main id="main"></main>
    <footer class="support"><span>TinyCutList is free and open source.</span>${kofiButtonHtml()}</footer>`;
  const style = document.createElement("style");
  style.textContent = KOFI_CSS;
  document.head.append(style);
  wire();
  render();
  await load(false);
}

// ---------------------------------------------------------------- rendering

function render() {
  renderHeader();
  renderMain();
}

function renderHeader() {
  const h = $("#header");
  if (!h || !state.info) return;
  const s = state.summary;
  const chips = s
    ? [
        `<span class="chip"><b>${s.parts}</b> parts in ${s.rows} rows</span>`,
        s.sheets ? `<span class="chip"><b>${s.sheets}</b> ${s.sheets === 1 ? "sheet" : "sheets"}</span>` : "",
        s.bars ? `<span class="chip"><b>${s.bars}</b> ${s.bars === 1 ? "bar" : "bars"}</span>` : "",
        s.glueUps ? `<span class="chip"><b>${s.glueUps}</b> ${s.glueUps === 1 ? "glue-up" : "glue-ups"}</span>` : "",
        s.guessed ? `<button class="chip warn" data-go="stock">Stock guessed for ${plural(s.guessed, "group", "groups")}: check it</button>` : "",
        s.open ? `<button class="chip warn" data-go="parts-open">${plural(s.open, "object", "objects")} not closed</button>` : "",
      ].join("")
    : "";
  const tabs: [Tab, string][] = [["parts", "Parts"], ["stock", "Stock"], ["plans", "Cutting plans"], ["export", "Export"]];
  h.innerHTML = `
    <div class="head">
      <h1 title="${esc(state.info.title)}">${esc(state.info.title)}</h1>
      <span class="src">${state.info.live ? "open in Hew" : "file"}${state.summary ? ` · ${state.seconds.toFixed(1)} s` : ""}</span>
      <span class="spacer"></span>
      <button class="btn" data-action="refresh" ${state.busy ? "disabled" : ""} title="Read the model again">${state.busy ? "Reading…" : "Refresh"}</button>
    </div>
    <div class="chips">${chips}</div>
    <nav role="tablist">${tabs.map(([id, label]) => `<button role="tab" data-tab="${id}" aria-selected="${state.tab === id}">${label}</button>`).join("")}</nav>`;
}

function renderMain() {
  const m = $("#main");
  if (!m) return;
  if (!state.cutList || !state.plan) {
    m.innerHTML = `<div class="busy">${state.busy ? "Reading the model…" : "Nothing to show yet."}</div>`;
    return;
  }
  if (state.tab === "parts") m.innerHTML = partsView(state.cutList);
  else if (state.tab === "stock") m.innerHTML = stockView(state.cutList, state.plan);
  else if (state.tab === "plans") m.innerHTML = plansView(state.plan);
  else m.innerHTML = exportView();
  if (state.tab === "parts") {
    const input = $<HTMLInputElement>("#filter");
    if (input && document.activeElement !== input && state.filter) input.value = state.filter;
  }
}

// ---------------------------------------------------------------- parts

function partsView(cl: CutList): string {
  const q = state.filter.trim().toLowerCase();
  const match = (p: Part) =>
    !q || [p.label, p.name, ...p.otherNames, p.material ?? NO_MATERIAL].some((s) => s.toLowerCase().includes(q));
  const groups = new Map<string, Part[]>();
  for (const p of cl.parts.filter(match)) {
    const k = `${keyOf(p.material)}\u0000${p.size[2]}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const canShow = !!state.info?.canShow;
  const sections = [...groups.entries()].map(([k, parts]) => {
    const [mat, t] = k.split("\u0000");
    const count = parts.reduce((s, p) => s + p.count, 0);
    const rows = parts.map((p) => {
      const notes = [
        p.mirrored ? `<span class="badge">mirrored</span>` : "",
        p.grain ? `<span class="badge">grain</span>` : "",
        ...p.glueUps.map((g) => `<span class="badge">glue-up ${esc(g)}</span>`),
        p.thicknessMismatch ? `<span class="badge warn">drawn ${mm(p.thicknessMismatch.part)}, material ${mm(p.thicknessMismatch.material)}</span>` : "",
      ].join("");
      return `<tr class="part${state.highlight === p.label ? " hl" : ""}" data-part="${esc(p.label)}">
        <td class="lab">${esc(p.label)}</td>
        <td>${esc(p.name)}${p.otherNames.length ? `<div class="other">also named ${p.otherNames.map(esc).join(", ")}</div>` : ""}<div class="narrow-only">${notes}</div></td>
        <td class="num">${p.count}</td>
        <td class="num wide-only">${mm(p.size[0])}</td><td class="num wide-only">${mm(p.size[1])}</td><td class="num wide-only">${mm(p.size[2])}</td>
        <td class="num narrow-only">${dims(p.size)}</td>
        <td class="wide-only">${notes}</td>
        <td class="num">${canShow ? `<button class="btn small" data-show="${esc(p.label)}" title="Select it in Hew">Show</button>` : ""}</td>
      </tr>`;
    });
    return `<section class="group"><h3>${esc(mat)} <span class="muted">${mm(Number(t))} mm · ${plural(count, "part", "parts")}</span></h3>
      <div class="table-wrap"><table class="parts">
        <colgroup><col class="c-lab"><col><col class="c-qty"><col class="c-dim"><col class="c-dim"><col class="c-dim"><col class="c-size"><col class="c-notes"><col class="c-show"></colgroup>
        <thead><tr><th></th><th>Part</th><th class="num">Qty</th><th class="num wide-only">L</th><th class="num wide-only">W</th><th class="num wide-only">T</th><th class="num narrow-only">L × W × T</th><th class="wide-only">Notes</th><th></th></tr></thead>
        <tbody>${rows.join("")}</tbody></table></div></section>`;
  });
  const glue = cl.glueUps.length
    ? `<section class="group"><h3>Glue-ups <span class="muted">boards glued into one blank: choose how their grain matches before gluing</span></h3>
        <div class="table-wrap"><table><thead><tr><th></th><th>Glue-up</th><th class="num">Qty</th><th>Blank</th><th>Boards</th></tr></thead><tbody>
        ${cl.glueUps.map((g) => `<tr><td class="lab">${esc(g.label)}</td><td>${esc(g.name)}</td><td class="num">${g.count}</td><td>${dims(g.size)}</td><td>${esc(g.kind)}: ${g.boards.map(esc).join(" + ")}</td></tr>`).join("")}
        </tbody></table></div></section>`
    : "";
  const look = cl.lookAlike.length
    ? `<div class="note">Look alike but not linked: ${cl.lookAlike.map((g) => g.map(esc).join(" = ")).join(", ")}. In Hew, Object ▸ Link identical copies would count them as one part.</div>`
    : "";
  const open = cl.open.length
    ? `<details class="note warn" id="parts-open"><summary>${plural(cl.open.length, "object isn't", "objects aren't")} a closed solid, so ${cl.open.length === 1 ? "it isn't" : "they aren't"} measured</summary>
        <p>${cl.open.map((o) => `${esc(o.name ?? o.id)}${o.count > 1 ? ` ×${o.count}` : ""}`).join(", ")}</p>
        <p class="muted">Hew's Model Health shows what's open. Downloaded hardware is often open and can be left as it is.</p></details>`
    : "";
  return `
    <div class="toolbar">
      <input id="filter" type="search" placeholder="Filter by name, label or material" value="${esc(state.filter)}" aria-label="Filter parts">
      <span class="muted">${plural(cl.parts.length, "row", "rows")}</span>
    </div>
    ${sections.join("") || `<div class="note">No part matches “${esc(state.filter)}”.</div>`}
    ${glue}${look}${open}`;
}

// ---------------------------------------------------------------- stock

type MaterialRow = { key: string; name: string | null; type: Part["materialType"]; parts: number; thicknesses: number[] };

function materialsOf(cl: CutList): MaterialRow[] {
  const m = new Map<string, MaterialRow>();
  for (const p of cl.parts) {
    const k = keyOf(p.material);
    const row = m.get(k) ?? { key: k, name: p.material, type: p.materialType, parts: 0, thicknesses: [] };
    row.parts += p.count;
    if (!row.thicknesses.includes(p.size[2])) row.thicknesses.push(p.size[2]);
    m.set(k, row);
  }
  return [...m.values()].sort((a, b) => b.parts - a.parts);
}

function stockView(cl: CutList, plan: CutPlan): string {
  const shown = { ...state.stock, ...state.drafts };
  const cards = materialsOf(cl).map((mat) => {
    const r = resolve(shown, mat.name, mat.type);
    const own = state.stock[mat.key];
    const draft = mat.key in state.drafts;
    const guessed = !draft && resolve(state.stock, mat.name, mat.type).guessed;
    const presetOpts = [`<option value="">Custom sizes</option>`, ...PRESETS.map((p) => `<option value="${p.id}" ${r.preset === p.id ? "selected" : ""}>${esc(p.name)}</option>`)].join("");
    const sizes =
      r.kind === "sheet"
        ? r.sheets.map((s, i) => `<div class="row" data-size="${i}"><input type="number" min="1" step="1" data-f="l" value="${s[0]}" aria-label="length"><span class="x">×</span><input type="number" min="1" step="1" data-f="w" value="${s[1]}" aria-label="width"><span class="muted">mm</span><button class="btn small" data-act="del-size" title="Remove this size">−</button></div>`).join("")
        : r.kind === "bar"
          ? r.bars.map((b, i) => `<div class="row" data-size="${i}"><input type="number" min="1" step="1" data-f="l" value="${b}" aria-label="length"><span class="muted">mm</span><button class="btn small" data-act="del-size" title="Remove this length">−</button></div>`).join("")
          : "";
    const groups = plan.groups.filter((g) => keyOf(g.material) === mat.key);
    const used = groups.reduce((s, g) => s + (g.kind === "sheet" ? g.sheets : g.bars).reduce((n, l) => n + l.count, 0), 0);
    return `<div class="card" data-mat="${esc(mat.key)}">
      <h4>${esc(mat.key)} ${draft ? `<span class="badge warn">not saved</span>` : guessed ? `<span class="badge warn">guessed</span>` : own ? `<span class="badge">set</span>` : ""}</h4>
      <div class="muted">${plural(mat.parts, "part", "parts")}, ${mat.thicknesses.map((t) => `${mm(t)} mm`).join(", ")}${used ? ` · ${used} ${r.kind === "bar" ? (used === 1 ? "bar" : "bars") : used === 1 ? "sheet" : "sheets"} in the plan` : ""}</div>
      <div class="row"><span class="seg" role="group" aria-label="Cut from">
        ${(["sheet", "bar", "list"] as const).map((k) => `<button data-act="kind" data-kind="${k}" aria-pressed="${r.kind === k}">${k === "sheet" ? "Sheets" : k === "bar" ? "Bars" : "List only"}</button>`).join("")}
      </span></div>
      ${r.kind === "sheet" ? `<div class="row"><label>Sizes from</label><select data-act="preset">${presetOpts}</select></div>` : ""}
      ${r.kind !== "list" ? `<div class="sizes">${sizes}</div><div class="row"><button class="btn small" data-act="add-size">+ ${r.kind === "sheet" ? "size" : "length"}</button></div>
      <div class="row"><label>Kerf</label><input type="number" min="0" step="0.1" data-f="kerf" value="${r.kerf}"><label>Trim</label><input type="number" min="0" step="1" data-f="trim" value="${r.trim}"><span class="muted">mm</span></div>` : `<div class="muted">Listed, not planned: hardware, edging, anything bought by the piece.</div>`}
      ${r.kind === "sheet" ? `<label class="check"><input type="checkbox" data-f="grain" ${r.grain ? "checked" : ""}><span>Parts follow the grain (along the sheet's length)</span></label>` : ""}
      <div class="actions">${draft ? `<button class="btn small" data-act="undo">Undo changes</button>` : own ? `<button class="btn small" data-act="forget" title="Go back to the guess">Reset</button>` : ""}<button class="btn primary small" data-act="save">${guessed && !draft ? "Use these sizes" : "Save and replan"}</button></div>
    </div>`;
  });
  return `<div class="note">Sheets and bars each material is cut from. Saved to <code>${esc(state.info?.stockWhere ?? "")}</code>, so the next model with the same material starts from it.</div>
    <div class="stock-grid">${cards.join("")}</div>`;
}

/** The entry a card shows now, read back from its inputs. */
function entryFromCard(card: HTMLElement): StockEntry {
  const kind = ($<HTMLButtonElement>('[data-act="kind"][aria-pressed="true"]', card)?.dataset.kind ?? "sheet") as StockEntry["kind"];
  const num = (f: string, el: ParentNode = card) => Number(($<HTMLInputElement>(`[data-f="${f}"]`, el)?.value ?? "").replace(",", "."));
  if (kind === "list") return { kind };
  const rows = [...card.querySelectorAll<HTMLElement>("[data-size]")];
  const entry: StockEntry = { kind, kerf: num("kerf"), trim: num("trim") };
  if (kind === "sheet") {
    entry.sheets = rows.map((r) => [num("l", r), num("w", r)] as [number, number]).filter(([l, w]) => l > 0 && w > 0);
    entry.grain = !!$<HTMLInputElement>('[data-f="grain"]', card)?.checked;
    const preset = $<HTMLSelectElement>('[data-act="preset"]', card)?.value;
    if (preset) entry.preset = preset;
  } else {
    entry.bars = rows.map((r) => num("l", r)).filter((l) => l > 0);
  }
  return entry;
}

async function saveStock(key: string, entry: StockEntry | null) {
  if (entry && entry.kind === "sheet" && !entry.sheets?.length) return status("Give at least one sheet size", true);
  if (entry && entry.kind === "bar" && !entry.bars?.length) return status("Give at least one bar length", true);
  const r = await run("Couldn't save the stock", () => bridge.call("set_stock", { stock: { [key]: entry } }));
  if (!r) return;
  state.stock = r.stock;
  delete state.drafts[key];
  status(entry ? `Saved ${key}` : `${key} goes back to the guess`);
  await load(false);
}

// ---------------------------------------------------------------- plans

function plansView(plan: CutPlan): string {
  if (!plan.groups.length && !plan.listOnly.length) return `<div class="note">Nothing to plan.</div>`;
  const names = new Map(state.cutList!.parts.map((p) => [p.label, p.name]));
  const groups = plan.groups.map((g, gi) => {
    const layouts = g.kind === "sheet" ? g.sheets : g.bars;
    const count = layouts.reduce((n, l) => n + l.count, 0);
    const eff = layouts.length ? Math.round(layouts.reduce((s, l) => s + l.efficiency * l.count, 0) / Math.max(1, count)) : 0;
    const head = `${esc(keyOf(g.material))} <span class="muted">${g.kind === "sheet" ? `${mm(g.thickness!)} mm` : `${dims(g.section!)} mm`} · ${count} ${g.kind === "sheet" ? (count === 1 ? "sheet" : "sheets") : count === 1 ? "bar" : "bars"} · ${eff}% used on average</span>${g.stock.guessed ? ` <button class="badge warn" data-go="stock">stock guessed</button>` : ""}`;
    const cards = layouts.map((l, li) => {
      const counts = new Map<string, number>();
      for (const p of l.parts) counts.set(p.label, (counts.get(p.label) ?? 0) + 1);
      const legend = [...counts].map(([lab, k]) => `<b>${esc(lab)}</b> ${esc(names.get(lab) ?? "")}${k > 1 ? ` ×${k}` : ""}`).join(" · ");
      if (g.kind === "sheet") {
        const s = g.sheets[li];
        return `<div class="sheet" data-view="${gi}:${li}"><div class="cap"><b>${li + 1}${s.count > 1 ? ` ×${s.count}` : ""}</b> ${dims([s.length, s.width])} <span class="muted">${s.efficiency}% used</span></div>
          ${sheetSvg(s, { trim: g.stock.trim, grain: g.stock.grain })}<div class="legend">${legend}</div></div>`;
      }
      const b = g.bars[li];
      return `<div class="bar" data-view="${gi}:${li}"><div class="cap"><b>${li + 1}${b.count > 1 ? ` ×${b.count}` : ""}</b> ${mm(b.length)} <span class="muted">${b.efficiency}% used</span></div>
        ${barSvg(b, { trim: g.stock.trim, section: g.section })}<div class="legend">${legend}</div></div>`;
    });
    const notes = [
      g.error ? `<div class="note warn">Couldn't plan this group: ${esc(g.error)}</div>` : "",
      g.tooBig.length ? `<div class="note warn">Too big for this stock: ${g.tooBig.map((x) => `${esc(x.label)} ×${x.count}`).join(", ")}. Add a bigger size in Stock.</div>` : "",
    ].join("");
    return `<section class="group"><h3>${head}</h3>${notes}<div class="${g.kind === "sheet" ? "sheets" : "bars"}">${cards.join("")}</div></section>`;
  });
  const list = plan.listOnly.length
    ? `<div class="note">Listed only, no plan: ${plan.listOnly.map((x) => `${esc(x.label)} ×${x.count} (${esc(x.material ?? NO_MATERIAL)})`).join(", ")}.</div>`
    : "";
  return groups.join("") + list;
}

function openViewer(gi: number, li: number) {
  const g: CutGroup | undefined = state.plan?.groups[gi];
  if (!g) return;
  const names = new Map(state.cutList!.parts.map((p) => [p.label, p]));
  const layout = g.kind === "sheet" ? g.sheets[li] : g.bars[li];
  const svg = g.kind === "sheet" ? sheetSvg(g.sheets[li], { trim: g.stock.trim, grain: g.stock.grain }) : barSvg(g.bars[li], { trim: g.stock.trim, section: g.section });
  const labels = [...new Set(layout.parts.map((p) => p.label))];
  const d = $<HTMLDialogElement>("#viewer")!;
  d.innerHTML = `<div class="viewer-head"><b>${esc(keyOf(g.material))}</b><span class="muted">${g.kind === "sheet" ? `${dims([(layout as any).length, (layout as any).width])}` : mm(layout.length)} · ${layout.efficiency}% used${layout.count > 1 ? ` · cut ${layout.count} like this` : ""}</span><span class="spacer"></span><button class="btn" data-act="close">Close</button></div>
    <div class="viewer-body">${svg}
    <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th></th><th>Part</th><th class="num">On this ${g.kind}</th><th>Size</th></tr></thead><tbody>
    ${labels.map((lab) => { const p = names.get(lab); const k = layout.parts.filter((x) => x.label === lab).length; return `<tr><td class="lab">${esc(lab)}</td><td>${esc(p?.name ?? "")}</td><td class="num">${k}</td><td>${p ? dims(p.size) : ""}</td></tr>`; }).join("")}
    </tbody></table></div></div>`;
  d.showModal();
}

// ---------------------------------------------------------------- export

function exportView(): string {
  const card = (title: string, text: string, buttons: string) => `<div class="card"><h4>${title}</h4><p>${text}</p><div class="row">${buttons}</div></div>`;
  return `<div class="export-grid">
    ${card("Spreadsheet (CSV)", "One row per part, for Excel, Numbers or LibreOffice.", `<button class="btn" data-export="csv" data-sep="," data-decimal=".">CSV</button><button class="btn" data-export="csv" data-sep=";" data-decimal=",">CSV, Italian Excel</button>`)}
    ${card("Printable page", "The parts list, the glue-ups and every cutting plan, ready to print for the workshop.", `<button class="btn primary" data-export="html">Open the page</button>`)}
    ${card("Markdown", "The parts list and plans as text, for notes or an issue.", `<button class="btn" data-export="md">Markdown</button>`)}
    ${card("JSON", "Everything above as data, for your own tools.", `<button class="btn" data-export="json">JSON</button>`)}
  </div>`;
}

async function doExport(format: ExportFormat, sep?: string, decimal?: string) {
  // open the page's tab now: a browser only allows it in the click itself
  const tab = format === "html" ? window.open("about:blank", "_blank") : null;
  const r = await run("Couldn't export", () => bridge.call("export", { format, sep, decimal }));
  if (!r) {
    tab?.close();
    return;
  }
  const blob = new Blob([r.text], { type: r.mime });
  const url = URL.createObjectURL(blob);
  if (tab) {
    tab.location.href = url;
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = r.name;
    document.body.append(a);
    a.click();
    a.remove();
    status(`Saved ${r.name}`);
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------------------------------------------------------------- events

function wire() {
  document.addEventListener("click", async (ev) => {
    const t = ev.target as HTMLElement;
    const tab = t.closest<HTMLElement>("[data-tab]")?.dataset.tab as Tab | undefined;
    if (tab) {
      state.tab = tab;
      window.scrollTo(0, 0);
      try {
        sessionStorage.setItem("tcl-tab", tab);
      } catch {
        // no storage: the tab just isn't remembered
      }
      return render();
    }
    const go = t.closest<HTMLElement>("[data-go]")?.dataset.go;
    if (go) {
      state.tab = go === "stock" ? "stock" : "parts";
      render();
      if (go === "parts-open") {
        const d = $<HTMLDetailsElement>("#parts-open");
        if (d) {
          d.open = true;
          d.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      return;
    }
    const action = t.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "refresh") return load(true);

    const show = t.closest<HTMLElement>("[data-show]")?.dataset.show;
    if (show) {
      const p = state.cutList?.parts.find((x) => x.label === show);
      if (!p) return;
      const r = await run("Couldn't show it in Hew", () => bridge.call("show", { placements: p.placements.slice(0, 1) }));
      if (r?.how === "part") status(`${p.label} ${p.name}: selected in Hew${p.placements.length > 1 ? ` (1 of ${p.placements.length})` : ""}`);
      else if (r?.how === "outer") status(`${p.label} ${p.name}: Hew couldn't open its component, so the whole component is selected`);
      return;
    }
    const row = t.closest<HTMLElement>("tr.part");
    if (row) {
      state.highlight = state.highlight === row.dataset.part ? null : row.dataset.part ?? null;
      document.querySelectorAll("tr.part").forEach((r) => r.classList.toggle("hl", (r as HTMLElement).dataset.part === state.highlight));
      return;
    }
    const view = t.closest<HTMLElement>("[data-view]")?.dataset.view;
    if (view) {
      const [gi, li] = view.split(":").map(Number);
      return openViewer(gi, li);
    }
    const exp = t.closest<HTMLElement>("[data-export]");
    if (exp) return doExport(exp.dataset.export as ExportFormat, exp.dataset.sep, exp.dataset.decimal);

    const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "close") return $<HTMLDialogElement>("#viewer")!.close();
    const card = t.closest<HTMLElement>(".card[data-mat]");
    if (!card || !act) return;
    const key = card.dataset.mat!;
    if (act === "kind") {
      const kind = (t.closest<HTMLElement>("[data-kind]")!.dataset.kind) as StockEntry["kind"];
      const cur = entryFromCard(card);
      state.drafts = { ...state.drafts, [key]: kind === cur.kind ? cur : kind === "list" ? { kind } : kind === "bar" ? { kind, bars: [3000], kerf: 3, trim: 10 } : { kind, sheets: [[2800, 2070]], kerf: 3.2, trim: 10 } };
      return renderMain();
    }
    if (act === "add-size") {
      const cur = entryFromCard(card);
      if (cur.kind === "sheet") cur.sheets = [...(cur.sheets ?? []), [2500, 1250]];
      if (cur.kind === "bar") cur.bars = [...(cur.bars ?? []), 3000];
      delete cur.preset;
      state.drafts = { ...state.drafts, [key]: cur };
      return renderMain();
    }
    if (act === "del-size") {
      const i = Number(t.closest<HTMLElement>("[data-size]")!.dataset.size);
      const cur = entryFromCard(card);
      if (cur.kind === "sheet") cur.sheets = cur.sheets!.filter((_, j) => j !== i);
      if (cur.kind === "bar") cur.bars = cur.bars!.filter((_, j) => j !== i);
      delete cur.preset;
      state.drafts = { ...state.drafts, [key]: cur };
      return renderMain();
    }
    if (act === "undo") {
      delete state.drafts[key];
      return renderMain();
    }
    if (act === "save") return saveStock(key, entryFromCard(card));
    if (act === "forget") return saveStock(key, null);
  });

  document.addEventListener("change", (ev) => {
    const t = ev.target as HTMLElement;
    if ((t as HTMLSelectElement).dataset?.act === "preset") {
      const card = t.closest<HTMLElement>(".card[data-mat]")!;
      const p = PRESETS.find((x) => x.id === (t as HTMLSelectElement).value);
      const cur = entryFromCard(card);
      if (p) {
        cur.preset = p.id;
        cur.sheets = p.sheets;
        cur.grain = p.grain;
      } else delete cur.preset;
      state.drafts = { ...state.drafts, [card.dataset.mat!]: cur };
      renderMain();
    }
  });

  document.addEventListener("input", (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.id === "filter") {
      state.filter = t.value;
      const pos = t.selectionStart;
      renderMain();
      const again = $<HTMLInputElement>("#filter");
      again?.focus();
      if (again && pos !== null) again.setSelectionRange(pos, pos);
    }
  });

  $<HTMLDialogElement>("#viewer")!.addEventListener("click", (ev) => {
    if (ev.target === ev.currentTarget) (ev.currentTarget as HTMLDialogElement).close();
  });
}

boot();
