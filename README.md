# TinyCutList

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/K8C82AR8S0)

Cut lists and cutting diagrams for [Hew](https://hew3d.com), as a plugin written in TypeScript on Hew's plugin API.

**Status: early.** TinyCutList runs two ways:

- **Inside Hew**, as a plugin, from Hew `1.5.0-pre.2` on (a preview: plugins are behind Settings > Preview, and installed from a folder in developer mode). Hew has no plugin windows yet, so the plugin answers bus commands, which an agent or `hew-cli` calls: see [Inside Hew](#inside-hew).
- **As a command line tool** on `hew-cli`, Hew's command-line bus: it prints a model's parts list (Markdown, CSV or JSON) and makes a printable page with the cutting plans for sheets and bars.

## Where it comes from

TinyCutList is an independent project. It is **not OpenCutList** and isn't affiliated with it.

It started in October 2026 as a port of [OpenCutList](https://github.com/lairdubois/lairdubois-opencutlist-sketchup-extension), the SketchUp extension by L'Air du Bois, worked on for two weeks together with its author, Boris Beaulant. He then stepped back, and the plugin goes on under its own name. OpenCutList is the reference it was built from: the vocabulary, the material types and several rules come from it, and Boris's reviews shaped the part model. The history of this repository keeps that work, moved from the pull requests of `lairdubois/lairdubois-opencutlist-hew-extension`.

The plugin system it runs on is designed by Kurt Granroth in [hew3d/hew#60](https://github.com/hew3d/hew/issues/60).

## Layout

| Path | What |
|---|---|
| `hew-plugin.json` | The plugin manifest (Hew's format, `docs/agents/PLUGINS.md` in Hew). `npm run plugin:build` copies it into the package. |
| `src/host/` | The only door to Hew. `Host` is the interface (`query`, `transact`, `read`). `HewCliHost` drives `hew-cli mcp` for development, while `RecordingHost` and `ReplayHost` record Hew's answers and replay them in tests. `SdkHost` (`sdk.ts`) is the one inside Hew, over the plugin SDK's `hew.api`, keeping under Hew's 1,000 messages a second. `Host.read` sends many reads as dry-run `hew.doc.transact`s, 100 at a time, all of one model generation; a refused read keeps its refusal in its own slot. |
| `src/model.ts` | What `hew.query.occurrences` reports, as the plugin reads it. |
| `src/cutlist/` | The counting rule (`count.ts`), glue-ups (`glue.ts`), material types (`materials.ts`), Markdown (`format.ts`) and CSV (`csv.ts`) output. Cutting plans: stock (`stock.ts`), standard sheet sizes (`presets.ts`), nesting with PackingSolver (`nesting.ts`), drawings (`svg.ts`) and the printable page (`html.ts`). |
| `src/solver.ts`, `solver/` | PackingSolver as a single-threaded WebAssembly module: the CMake project that builds it, and the manifest of the released build. |
| `src/cli.ts` | The `tinycutlist` command: a file or the open document, out as Markdown, CSV, JSON or a page with the cutting plans. |
| `src/ui/`, `src/serve.ts` | The window (prototype): parts list, stock, cutting plans and exports, in plain DOM (`app.ts`, `index.html`). It talks only through a `Bridge` (`protocol.ts`): today `tinycutlist serve` answers it over HTTP (`bridge-http.ts`, `serve.ts`); from M3 the plugin's background will answer the same commands to its own window. |
| `src/support.ts` | The Ko-fi link, for every surface that shows it: the printable page now, the plugin window from M3. Drawn as a plain link, without Ko-fi's script, so the page stays self-contained. |
| `src/background.ts` | The plugin's bus commands as plain handlers over a `Host`, shared by the plugin and the tests. |
| `src/plugin/` | The plugin inside Hew: `main.ts` registers the commands with the SDK; `solver.ts` runs PackingSolver in a nested Worker, handed the compiled module; `solver-worker.js` and `embind-invoker.js` go into the package's `solver/worker.js`. |
| `tools/plugin-build.ts` | Builds the package Hew installs, in `dist/plugin/`. |
| `test/scenes.ts` | Synthetic models, each with the cut list the rule must give. |
| `tests/acceptance/linked-copies/` | The acceptance test for Hew's linked copies (milestone 2), run against a real build. |
| `docs/concept-mapping.md` | The record of how OpenCutList's concepts map onto Hew's data model, as discussed up to 12 November 2026. |
| `prototype/counting/` | The first counting prototype. Superseded by `src/cutlist/`; kept for its notes on real models. |
| `test/unit/` | The rule on recorded answers (`test/fixtures/`): no Hew needed. |
| `test/hew/` | The same scenes against a real Hew build. |
| `test/solver/` | Cutting plans with the real solver, checked geometrically. |
| `tools/record-fixtures.ts` | Records the fixtures from a real build. |
| `tools/corpus.ts` | Prints the cut list of real model files (`.hew` or `.skp`), opened in a private session. |
| `tools/solver-build.sh`, `tools/solver-fetch.ts` | Build the solver from source, or download the released build and check its checksums. |

## Command line

```sh
tinycutlist model.skp                        # the parts list, as a Markdown table
tinycutlist model.hew -o list.csv            # CSV (or .md, .json), from the file's extension
tinycutlist model.hew -o list.csv --sep ";" --decimal ","   # CSV for Italian (and other comma-decimal) spreadsheets
tinycutlist --live                           # the document open in the Hew app
tinycutlist --live --document "Cabinet.hew"  # another open window
```

It only reads: a file opens in a private Hew session and is never written back, and `--live` only queries the app's document. It needs `hew-cli`, which ships inside Hew: set `HEW_CLI` to its path if it isn't on the `PATH` (on macOS, `Hew.app` in `/Applications` is found by itself). `tinycutlist --help` lists every option.

Until it's published, run it from a clone with `node src/cli.ts …` (or `npm run cutlist -- …`), or `npm link` it once to get the `tinycutlist` command.

## The window (prototype)

```sh
tinycutlist serve --live                     # the document open in Hew, on http://127.0.0.1:8790
tinycutlist serve model.skp                  # a model file, opened privately
tinycutlist serve --live --port 8795 --stock project-stock.json
```

Hew has no plugin windows yet (they come with M3's second stop), so the window runs in a browser for now, served on this computer only (127.0.0.1; requests from other sites are refused). It has four tabs:

- **Parts**: the parts list by material and thickness, with a filter, the glue-ups, look-alikes and the objects that aren't closed. With `--live`, **Show** selects the part in Hew and frames it. A part inside an unevenly scaled component Hew can't open selects that component instead.
- **Stock**: each material's sheets or bars, starting from a guess. Pick a preset or type the sizes, kerf, trim and grain, then save: it goes to the global stock file (or `--stock`'s) and the plans are redone.
- **Cutting plans**: every sheet and bar, drawn to scale. Click one to see it large, with the parts on it.
- **Export**: CSV (also for comma-decimal spreadsheets), the printable page, Markdown and JSON.

`--live` only reads the document, except that **Show** changes Hew's selection and view. The window is built from `src/ui/` when the server starts, with esbuild (a dev dependency: run `npm install` first).

## Cutting plans

```sh
npm run solver:fetch                          # once: the PackingSolver module, into solver/dist
tinycutlist model.skp -o plan.html            # parts list, glue-ups and cutting plans, ready to print
tinycutlist model.skp --plan                  # the plans as a Markdown summary (or --plan with -f json)
tinycutlist stock model.skp                   # add the model's materials to the stock file, to check
```

Parts are grouped by material and thickness (sheets) or material and section (bars), and each group is nested by [PackingSolver](https://github.com/fontanf/packingsolver) (Florian Fontan, MIT): sheets with saw cuts in three stages, bars cut to length. Parts bigger than any stock size are listed, never dropped.

**What each material is cut from** lives in a stock file, keyed by the material's name in the model (`(no material)` for parts without one):

```json
{
  "Birch plywood 18": { "kind": "sheet", "preset": "plywood-birch" },
  "Oak boards":       { "kind": "sheet", "sheets": [[2400, 180], [2000, 150]], "grain": true, "kerf": 3.2, "trim": 10 },
  "Pine batten 40":   { "kind": "bar", "bars": [3000], "kerf": 3, "trim": 10 },
  "Steel":            { "kind": "list" }
}
```

- `kind`: `sheet` (panels or boards, in mm, length first), `bar` (lengths in mm) or `list` (in the parts list, no plan).
- `kerf` is the blade width, `trim` what's cut off each edge of a sheet or each end of a bar. `grain: true` keeps each part's length along the sheet's length.
- `preset` starts from a standard sheet good (`src/cutlist/presets.ts`): its usual full-sheet sizes and grain. Sizes set in the entry win.
- The global file is `~/.config/tinycutlist/stock.json` (or `$TINYCUTLIST_CONFIG/stock.json`); `--stock file.json` adds a project's own on top, material by material.
- A material that no file has is guessed from its name (a preset, or a sheet, bar or list by its wording) and the page says so. `tinycutlist stock` writes those guesses into the file, marked `"guessed": true`: check the sizes, then remove the mark.

Presets, with their full-sheet sizes in mm:

| Preset | Sheets | Grain |
|---|---|---|
| `plywood-poplar` | 2520 × 1870, 2500 × 1250, 2440 × 1220 | no |
| `plywood-birch` | 2500 × 1250, 1525 × 1525 | yes |
| `plywood-okoume` | 3100 × 1530, 2500 × 1220 | yes |
| `plywood-pine` | 2500 × 1250, 2440 × 1220 | no |
| `plywood-phenolic` | 2500 × 1250 | no |
| `plywood-faced` | 3050 × 1300, 2440 × 1220 | yes |
| `thin-plywood` (3–6 mm) | 2520 × 1250, 3000 × 1250 | yes |
| `mdf` | 2800 × 2070, 3660 × 2200 | no |
| `hdf` | 2800 × 2070 | no |
| `chipboard` | 2800 × 2070, 3770 × 2070 | no |
| `chipboard-melamine` | 2800 × 2070, 3050 × 2070 | no |
| `osb` | 2500 × 1250 | no |
| `blockboard` | 3120 × 1850, 3660 × 1870 | yes |
| `panel-spruce` | 2450 × 1200, 3000 × 1250 | yes |
| `panel-3-layer` | 5050 × 2050, 3000 × 1250 | yes |
| `panel-hardwood` | 3000 × 1200, 4500 × 1220 | yes |

**The solver** is PackingSolver's own JavaScript API (`wasm/` in its repository) built without threads (`solver/CMakeLists.txt`), so it runs in any Worker, without cross-origin isolation, as a Hew plugin needs. It runs one optimization at a time, in "not-anytime-sequential" mode. `npm run solver:fetch` downloads the build named in `solver/manifest.json` from this repository's releases and checks its SHA-256; `npm run solver:build` builds it from source with Emscripten (set `EMSDK`). `TINYCUTLIST_SOLVER` points at another folder.

## Inside Hew

```sh
npm run solver:fetch
npm run plugin:build        # → dist/plugin/
```

In Hew `1.5.0-pre.2` or later: turn on Plugins in Settings > Preview and restart, turn on developer mode in Settings > Plugins, then install the folder `dist/plugin` (or run `hew-cli plugin dev dist/plugin --live` and choose it in Hew). The plugin asks only for `model.read`.

Its commands, on Hew's bus as `io.github.tinyworkshopdesign.tinycutlist.<id>`:

| Command | What |
|---|---|
| `cut_list` | The cut list as `md` (default), `csv`, `json` or `html` (the printable page), with the cutting plans (`plan: true`, always in `html`). Answers `{format, text, summary}`. |
| `count_parts` | The parts list as data. |
| `get_stock`, `set_stock` | The sheets and bars the cutting plans use, kept in the plugin's own storage: what `~/.config/tinycutlist/stock.json` is for the command line. |

For example, from a terminal, against the document open in Hew:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"hew.meta.hello","params":{"protocol":1}}' \
  '{"jsonrpc":"2.0","id":2,"method":"hew.doc.attach","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"io.github.tinyworkshopdesign.tinycutlist.cut_list","params":{"format":"md","plan":true}}' \
  > cutlist.jsonl
hew-cli run cutlist.jsonl --live
```

Two things the package does that the command line doesn't need. Hew's plugin Worker allows no `eval`, and embind (PackingSolver's bindings) builds its call wrappers with the Function constructor, so the build puts `src/plugin/embind-invoker.js` in place of that one function. And Hew stops a plugin that sends more than 1,000 messages a second: the reads go in batches (below), and `SdkHost` keeps to 800 a second besides.

## Running

Node ≥ 23.6 runs the TypeScript directly; `npm install` only fetches the type checker.

```sh
npm install
npm test                                   # unit tests, on the recorded answers
npm run typecheck
HEW_CLI=/path/to/hew-cli npm run test:hew  # the same scenes, live
HEW_CLI=/path/to/hew-cli npm run record    # re-record the fixtures on a new build
HEW_CLI=/path/to/hew-cli node tools/corpus.ts model.skp   # a real model's cut list
npm run test:solver                        # cutting plans with the real solver (after solver:fetch)
```

`hew-cli` ships inside Hew (`Hew.app/Contents/MacOS/hew-cli` on macOS, in the AppImage on Linux). The fixtures say which build recorded them; they were recorded on `1.5.0-pre.plugin-m2`.

## The rule

- Hew reports facts, the plugin applies the rule.
- **A part is a closed solid**: every Object Hew reports as `solid`, wherever it sits (loose, in a group, or inside a component, at any depth). Groups and components only organise; an assembly is never a part. Hidden placements are skipped.
- **One row per solid.** Hew's linked copies share their solid, so a board copied three times is one row ×4, even when a copy is renamed (the other name shows in the notes). A board that was never copied is a row ×1. Rows split on material, size and handedness.
- **Handedness comes from Hew** (`hew.query.signature`): a mirrored placement is its own row only when the solid isn't its own mirror image. A plain board mirrored is the same part; a cabinet side with a rabbet and a dado has a left and a right.
- **Material** is what the user sees: the solid's base material, else its faces' (painted faces, then the nearest painted placement). Faces painted with an `edge` or `veneer` material don't count.
- **Glue-ups.** Boards glued face to face (laminated) or edge to edge (an edge-glued panel) stay separate parts, one per board, because that's what gets cut. They are also listed as glue-ups, with the blank's size and the boards in order across it, so the grain can be matched before gluing. Two boards glue up when their lengths are parallel and about the same, they overlap almost fully, and they touch: face to face with about the same width, or edge to edge with the same thickness, in one plane (`src/cutlist/glue.ts`).
- **Look-alikes**: different solids with the same shape and material (Hew's `shape` hash) are suggested for linking, never counted together. Boards of one glue-up are never suggested.
- Objects that aren't closed solids are reported, not measured.
- No hardware or machining types: TinyCutList is for hobbyists and small workshops, and keeps to the parts list, cutting diagrams and exports.

The scenes cover each point. On the five real models in the port's tests, the glue-ups found are two shelves made of eight strips, a doubled 36 mm panel, and the two halves of each castor wheel.

## License

GPL-3.0.
