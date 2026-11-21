# Acceptance test: layered materials, top face and grain (hew3d/hew#134)

> **Status: written ahead of the build, not run on it yet.** Hew's first round of layered materials isn't out. The harness was checked on Hew 1.4.0 (macOS), where every `layers` case skips cleanly on the unknown `hew.material.create` fields. B1 needs `v1.5.0-pre.1` or later (on 1.4.0 `hew.query.occurrences` isn't a read-only command yet).

What TinyCutList needs from Hew's layered materials, as executable cases. Agreed on [hew3d/hew#134](https://github.com/hew3d/hew/issues/134) (Kurt's plan of 18 November 2026, "For TinyCutList"):

- per material: its kind (plain or layered), its layers, its total thickness, and whether it has a grain direction;
- per placement, next to `material` on `hew.query.occurrences`: the grain direction and the top-face direction in world space, and a thickness mismatch when the part and its material differ;
- `hew.query.part_frame` gives the length along the grain first, with `source: "material"`.

## The rule the cases check

The top face and the grain live on the **shared solid**, in its own frame. Each placement carries them through its own `world_pose`: turn a copy and its grain turns with it; a mirrored copy keeps the grain line. The layered material itself sits on the placement, so one copy can be birch and another maple. A copy that needs a different grain is made unique first.

Grain is a line, so grain checks compare up to sign. The top face's normal is a direction, so those checks keep the sign. For linked copies the expected value is computed from the poses (`carry` in `cases.ts`): back to the solid's frame through one placement's pose, out through the other's.

## Running it

Same as the linked-copies suite: Node ≥ 23 and the `hew-cli` of the build under test. It reuses `../linked-copies/hew.ts` and that suite's copy gestures and M2 calls.

```bash
HEW_CLI=/path/to/hew-cli node run.ts
HEW_CLI=… node run.ts --only A1,L1 --json report.json
```

**PASS / FAIL / SKIP / ERROR** mean what they mean there. A case skips only when a TBD call in `adapter.ts` is rejected for its shape, or when none of the candidate field names is on a row.

## Cases

**Baseline** (current builds):

| Id | What | Expected |
|---|---|---|
| B1 | A board with a plain material | `part_frame.source` isn't `"material"` |

**The material:**

| Id | What | Expected |
|---|---|---|
| M1 | Plywood, 9 × 2 mm | kind `layered`, 9 layers top to bottom with names, 18 mm, has grain |
| M2 | Melamine, 0.2 / core / 0.2, 19 mm | 3 layers, 19 mm, no grain |
| M3 | One ply goes 2 → 3 mm | the material becomes 19 mm (Kurt's outline: the total follows the layers) |
| M4 | A plain material | doesn't read as layered |

**Applying it** (Paint's plain click):

| Id | What | Expected |
|---|---|---|
| A1 | Click the top of a 600 × 400 × 18 panel | made of the plywood; grain along X (longest edge); top +Z |
| A2 | Click the underside | top −Z, grain still along X |
| A3 | Undo | one undo step; no frame left |
| A4 | Melamine | top face set, no grain reported |
| A5 | Click again with another plywood, on an edge | material swapped, top face and grain kept |

**What TinyCutList reads:**

| Id | What | Expected |
|---|---|---|
| R1 | A 300 × 500 rail, grain along the 300 | `part_frame` extents `[0.3, 0.5, 0.018]`, source `"material"` |
| R2 | "Grain runs along: Width" on the panel | extents swap to `[0.4, 0.6, …]` |
| R3 | A 19 mm part on 18 mm plywood, and an 18 mm one | mismatch `{part: 0.019, material: 0.018}` on the first, none on the second; nothing refused |
| R4 | Push/pull a ply part to 20 mm | the mismatch appears; top face and grain unchanged |

**Carried through cuts and moves:**

| Id | What | Expected |
|---|---|---|
| C1 | Crosscut a 600 × 150 board to 100 long (Kurt's example) | grain still along X; extents `[0.1, 0.15, …]`, length along the grain though shorter |
| C2 | Turn 90° about Z | grain along Y |
| C3 | Stand on its edge, 90° about X | grain along X, top −Y |

**Linked copies:**

| Id | What | Expected |
|---|---|---|
| L1 | Rotate copy ×3 by 90° | 4 placements of one solid; each one's grain and top = its pose applied to the solid's; both X and Y appear |
| L2 | Mirrored copy | still linked; grain along X, top +Z on the mirrored one |
| L3 | Set the grain through one copy | every copy changes; still linked |
| L4 | Make one unique, then change its grain | it keeps the grain it had; after the change only it differs |
| L5 | Independent copy | carries the grain over; changing it leaves the original alone |
| L6 | Paint one linked copy maple | still linked; one birch, one maple, same top face and grain |

**Persistence:**

| Id | What | Expected |
|---|---|---|
| S1 | Save and reopen | layers, top face, grain and the grain-first extents come back |

## The TBD calls (`adapter.ts`)

Kurt's app design (#134, section 6) gives the wasm names. The bus names are guesses built from them, to be corrected when the kernel half lands, in `adapter.ts` only:

| Function | Guessed bus shape | From the design |
|---|---|---|
| `createLayered` | `hew.material.create {name, color, layers, directional}` | `add_layered_material` |
| `setLayers` | `hew.material.set_layers {material, layers}` | `set_material_layers` |
| `applyFromFace` | `hew.material.apply_layered {face: {path, at}, material}` | Paint's click + `set_material_frame_from_face` |
| `setFrame` | `hew.material.set_frame {path, grain, down}` | `set_material_frame` |
| `materialInfo` | `kind`, `layers`, `thickness`, `directional` on `hew.query.scene` materials | `MaterialJs.layer_*`, `directional()` |
| `frameOf` | `material_frame {grain, top \| down}` on occurrence rows | `object_material_frame` |
| `mismatchOf` | `thickness_mismatch {part, material}` on occurrence rows | `material_thickness_mismatch` |

Lengths are metres, as everywhere on the bus; the design's `Layer.thickness` is metres too.

## On TinyCutList's side

Done: when `part_frame.source` is `"material"`, `count.ts` keeps Hew's order (length along the grain, width, thickness) and marks the part `grain`. `nesting.ts` doesn't re-sort it and keeps that part oriented along the sheet, even when the stock file says the sheet has no grain. Both are covered by unit tests on a re-answered S1 fixture.

Done too: Hew's thickness mismatch on a part's row (read as `thickness_mismatch` or `material_thickness_mismatch`) becomes a warning on that part in the Markdown, CSV ("Warnings" column) and HTML lists, with a line at the top of the page. The part is still listed and planned at the thickness it's drawn.

Still to do, once the names are settled: the thickness from the material in place of the side file's.

## Files

- `adapter.ts`: the TBD calls and field readers.
- `cases.ts`: the cases.
- `run.ts`: the runner.
