# trimesh-repair-js

Repair functions for the trimesh family of JavaScript meshing libraries
([trimesh-boolean](https://github.com/brentbuffham/trimesh-boolean),
[trimesh-build-js](https://github.com/brentbuffham/trimesh-build-js)): find and patch open loops,
fill gaps, close holes, repair folds, orient, and check a mesh (closed or open, non-manifold
edges, enclosed volume).

The functions were built and proven in [Kirra](https://kirra-design.com), then moved here.
From 0.1.0 trimesh-build-js uses them from this library.

**Live demo:** [brentbuffham.github.io/trimesh-repair-js](https://brentbuffham.github.io/trimesh-repair-js/). Load a mesh with problems (a sphere with holes, a terrain with an open rim, a cube missing its top, a sphere half inside out, a Möbius band) or open your own OBJ, then patch loops, fill gaps, repair folds and orient, and watch the check report change. The source is in `examples/`; run `npm run dev` to work on it locally.

## Install

```sh
npm i trimesh-repair-js
```

ES modules, Node 22 or later, or any modern browser. It depends on trimesh-boolean (its vertex pool,
signed volume and loop triangulation). Nothing in it touches `window`, the DOM or Three.js, so it
runs in a Web Worker.

## Two levels

| Level | Works on | Use it when |
|---|---|---|
| **Indexed** | `{ positions: Float64Array, index: Uint32Array }` - world xyz, three indices a triangle | You have a mesh and want it checked or patched. The input is never changed; a new mesh comes back. |
| **BMS** | a trimesh-boolean BMS result `{ pool, soup, mesh, ... }`, as trimesh-build-js's `buildMesh` returns | You are already working with a BMS result (trimesh-build-js does). These functions update it in place. |

## Use

```js
import { checkMeshIndexed, patchMeshLoopsLocal } from "trimesh-repair-js";

var mesh = { positions: positions, index: index }; // Float64Array, Uint32Array

var report = checkMeshIndexed(mesh);
// { triangles, closed, volume, openLoops, loops: Float64Array[], loopIds, nonManifoldEdges, boundaryEdges }

var r = patchMeshLoopsLocal(mesh, "all", { method: "auto", maxEdges: 50 });
// r.mesh:    the patched mesh (your triangles first, unchanged, then the new ones)
// r.added:   9 world coordinates per added triangle
// r.patched: loops patched; r.refused: [{ loop, reason }]; r.methods: { fair: 3, fan: 1, ... }
```

## Checking a mesh

| Call | Returns | How |
|---|---|---|
| `checkMeshIndexed(mesh, { tolerance })` | the report above | An edge census on the typed arrays. Fast on millions of triangles; it builds a BMS only when the winding is not consistent. |
| `checkMesh(mesh, { tolerance })` | the same report fields | Through a full BMS (`bmsFromIndexed`). |
| `findOpenLoops(mesh, { tolerance })` | `Float64Array[]` | The open boundary loops as world xyz polylines. |

`closed` means every edge has exactly two triangles. `volume` is the enclosed volume in cubic units,
or `null` when the mesh is open. `tolerance` is the weld distance in mesh units (default
`DEFAULT_TOLERANCE`, 0.001).

## Patching loops

| Call | What it patches | Winding |
|---|---|---|
| `patchMeshLoopsLocal(mesh, which, opts)` | Each loop from its own surroundings (a few rings of triangles around it), so it is quick on a large mesh. Returns the added triangles as well. | Your triangles are kept as they are; new ones are wound to agree with their neighbours. |
| `patchMeshLoops(mesh, which, opts)` | The same, returning `{ mesh, patched, refused, methods }`. | As above. |

`which` is one of:

- `"all"` - every loop of at most `opts.maxEdges` edges (default: no limit). Use a limit on an open
  surface: its outer rim is a loop too, and patching it caps the whole surface.
- a loop index, or a list of them (`findOpenLoops` / `checkMeshIndexed` order);
- world points along one loop (`[x, y, z]` arrays or `{x, y, z}` objects) - the loop whose vertices
  they sit on is patched, e.g. points a user clicked.

| `method` | What it does |
|---|---|
| `"auto"` (default) | Tries `fair`, then `fan`, `centroid` and `vertexFan`, and uses the first that is valid. |
| `"fair"` | Liepa (2003): the best triangulation of the loop, refined to the mesh's edge length, with the new points faired into the surrounding surface, so the patch bulges with the wall instead of cutting across it. |
| `"fan"` | trimesh-boolean's `triangulateLoop` on the loop's own vertices. No new points. |
| `"centroid"` | One new point at the loop centre, fanned to every loop edge. |
| `"vertexFan"` | A fan from one loop vertex to all the others, trying each vertex in turn. |

A loop is refused, never thrown on, when it is not simple or when every method would give an edge
a third triangle; the reason comes back in `refused`. A loop that passes through one vertex twice
(two holes touching at a point) is split there and each part patched on its own.

`fillOpenEdges(mesh)` caps every closed open loop with trimesh-boolean's `fillOpenEdgeLoops` and
returns the new mesh.

## The BMS level

The same functions trimesh-build-js 0.5.0 had, with the same signatures:

| Function | Does |
|---|---|
| `ingestToBMS`, `cleanSoup` | Build and tidy a BMS result from triangles. |
| `validateMesh`, `pointInside` | The mesh report (closed, boundary loops, non-manifold edges, enclosed volume); point-in-solid. |
| `orientMesh`, `orientByVisibility` | Consistent winding per component, and its sign (viewpoints, a ray visibility vote, or signed volume). |
| `patchLoop(result, which, { method })`, `patchLoops(result, { maxEdges, method, loops })`, `patchLoopIds` | Patch one or many loops of a BMS result. |
| `triangulateHole`, `fairFill` | The `fair` method's triangulation and fairing. |
| `fillGaps`, `closeHoles` | Fill small loops automatically; close holes with centroid fans. |
| `repairFolds` | Cut twisted strips so every edge runs both ways. |
| `edgesOf`, `markCurrent`, `poolEdgeKey` | The edge table. |
| `toIndexed` | A BMS result as `{ positions, index }`. |

⚠️ **Orientation convention.** `orientMesh` points a CLOSED component's normals into it - the
inside of a cave, drive or void is the side that matters there. The indexed patch calls do not
re-orient your mesh; if you call `orientMesh` yourself on a solid, expect inward normals.

Also exported: `bmsFromIndexed(positions, index, tolerance)`, `summaryOfResult(result)`,
`soupOfIndexed` / `indexedOfSoup` (trimesh-boolean `{v0, v1, v2}` soup to and from indexed),
`sortedEdgeKeys` / `hasRepeatedDirectedEdge`, and `VERSION`.

## Tests

```sh
npm test
```

The Wookey Hole real-cave tests use the samples in trimesh-build-js
(`../trimesh-build-js/examples/public/samples`). Without them those tests are skipped, and say so.

## Licence

MIT. Brent Buffham, [kirra-design.com](https://kirra-design.com).
