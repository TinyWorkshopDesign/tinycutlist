# TinyCutList

Cut lists and cutting diagrams for [Hew](https://hew3d.com), as a plugin written in TypeScript on Hew's plugin API.

**Status: skeleton.** Hew runs plugins from its milestone 3 on. Until then the code runs against `hew-cli`, Hew's command-line bus, and only the part counting is here. The first version aims at the parts list, exports and cutting diagrams.

## Where it comes from

TinyCutList is an independent project. It is **not OpenCutList** and isn't affiliated with it.

It started in October 2026 as a port of [OpenCutList](https://github.com/lairdubois/lairdubois-opencutlist-sketchup-extension), the SketchUp extension by L'Air du Bois, worked on for two weeks together with its author, Boris Beaulant. He then stepped back, and the plugin goes on under its own name. OpenCutList is the reference it was built from: the vocabulary, the material types and several rules come from it, and Boris's reviews shaped the part model. The history of this repository keeps that work, moved from the pull requests of `lairdubois/lairdubois-opencutlist-hew-extension`.

The plugin system it runs on is designed by Kurt Granroth in [hew3d/hew#60](https://github.com/hew3d/hew/issues/60).

## Layout

| Path | What |
|---|---|
| `hew-plugin.json` | The plugin manifest (Hew's format, `docs/agents/PLUGINS.md` in Hew). Draft: Hew can't load plugins before M3. |
| `src/host/` | The only door to Hew. `Host` is the interface (`query`, `transact`). `HewCliHost` drives `hew-cli mcp` for development, while `RecordingHost` and `ReplayHost` record Hew's answers and replay them in tests. From M3, a host over the SDK joins them. |
| `src/model.ts` | What `hew.query.occurrences` reports, as the plugin reads it. |
| `src/cutlist/` | The counting rule (`count.ts`), glue-ups (`glue.ts`), material types (`materials.ts`), a Markdown table (`format.ts`). |
| `src/background.ts` | The plugin's entry: its bus commands as plain handlers over a `Host`, to be registered through the SDK in M3. |
| `test/scenes.ts` | Synthetic models, each with the cut list the rule must give. |
| `tests/acceptance/linked-copies/` | The acceptance test for Hew's linked copies (milestone 2), run against a real build. |
| `docs/concept-mapping.md` | The record of how OpenCutList's concepts map onto Hew's data model, as discussed up to 12 November 2026. |
| `prototype/counting/` | The first counting prototype. Superseded by `src/cutlist/`; kept for its notes on real models. |
| `test/unit/` | The rule on recorded answers (`test/fixtures/`): no Hew needed. |
| `test/hew/` | The same scenes against a real Hew build. |
| `tools/record-fixtures.ts` | Records the fixtures from a real build. |
| `tools/corpus.ts` | Prints the cut list of real model files (`.hew` or `.skp`), opened in a private session. |

## Running

Node ≥ 23.6 runs the TypeScript directly; `npm install` only fetches the type checker.

```sh
npm install
npm test                                   # unit tests, on the recorded answers
npm run typecheck
HEW_CLI=/path/to/hew-cli npm run test:hew  # the same scenes, live
HEW_CLI=/path/to/hew-cli npm run record    # re-record the fixtures on a new build
HEW_CLI=/path/to/hew-cli node tools/corpus.ts model.skp   # a real model's cut list
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
