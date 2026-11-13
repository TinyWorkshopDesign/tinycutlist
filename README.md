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
| `src/cutlist/` | The counting rule (`count.ts`), material types (`materials.ts`), a Markdown table (`format.ts`). |
| `src/background.ts` | The plugin's entry: its bus commands as plain handlers over a `Host`, to be registered through the SDK in M3. |
| `test/scenes.ts` | Synthetic models, each with the cut list the rule must give. |
| `tests/acceptance/linked-copies/` | The acceptance test for Hew's linked copies (milestone 2), run against a real build. |
| `docs/concept-mapping.md` | The record of how OpenCutList's concepts map onto Hew's data model, as discussed up to 12 November 2026. |
| `prototype/counting/` | The first counting prototype. Superseded by `src/cutlist/`; kept for its notes on real models. |
| `test/unit/` | The rule on recorded answers (`test/fixtures/`): no Hew needed. |
| `test/hew/` | The same scenes against a real Hew build. |
| `tools/record-fixtures.ts` | Records the fixtures from a real build. |

## Running

Node ≥ 23.6 runs the TypeScript directly; `npm install` only fetches the type checker.

```sh
npm install
npm test                                   # unit tests, on the recorded answers
npm run typecheck
HEW_CLI=/path/to/hew-cli npm run test:hew  # the same scenes, live
HEW_CLI=/path/to/hew-cli npm run record    # re-record the fixtures on a new build
```

`hew-cli` ships inside Hew (`Hew.app/Contents/MacOS/hew-cli` on macOS, in the AppImage on Linux). The fixtures say which build recorded them; they were recorded on `1.5.0-pre.plugin-m2`.

## The rule

The code today implements the component-based rule below, from the concept mapping. **It is going to change**: the plan is the simpler "a part is a closed solid". A board that was never copied is a part placed once, linked copies are counted as Hew reports them, and look-alike solids are only suggested for linking.

- Hew reports facts, the plugin applies the rule.
- A part is any component placement with solids of its own, at any depth, sized from those solids only. Groups are transparent: their solids and the placements in them count toward the enclosing component.
- Identical parts are counted by definition, so Hew's linked copies count as one part placed several times. Rows are split on material, size and mirroring (unless the definition is `symmetrical`).
- Hardware (a placement painted with a `hardware` material) is one item. Machining bodies are left out of the size. Assemblies (no solids of their own) aren't parts. Hidden placements are skipped. Open objects are reported, not measured.
- Objects with no definition (never copied, or imported SketchUp groups) are listed as parts placed once.

The scenes cover each point. S5 (groups inside a part) and S6 (linked copies) come from what the real models showed on M2.

## License

GPL-3.0.
