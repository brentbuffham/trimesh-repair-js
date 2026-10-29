# Changelog

## 0.1.3

- **Faster orientation and edge lookups. Same results.** `EdgeTable` was a `Map` keyed by one 52-bit double, so every lookup hashed a heap number; it is now an open-addressing hash table over the two vertex ids in typed arrays, with `slot(a, b)` and `addEdge(a, b, t)` beside the key methods. `orientMesh` looked an edge up about ten times per edge (reach, the walk, the consistency pass); it now reads each triangle's neighbours from one flat table built once. On a 260k-triangle cave `orientMesh` takes 0.21 s, was 0.43 s. The winding, components and `perComponent` are identical to 0.1.2 on a 20k sphere and three cave meshes with half the triangles flipped at random.
- `edgesOf` rebuilds a cached table that came from another copy or version of the library, instead of calling methods it may not have.

## 0.1.2

- A demo (`examples/`, live on GitHub Pages): meshes with problems, and the library's tools to fix them - Patch selected / Patch all (patchMeshLoopsLocal, every method), Fill gaps, Repair folds, Orient, Undo - with the checkMeshIndexed report after each step. Its header shows the library version and links to the trimesh family's other demos.
- No library change.

## 0.1.1

- The README: what the library does, the two levels, checking, patching (methods, `which`, winding), the BMS-level functions and the orientation convention. 0.1.0 shipped with the placeholder README.

## 0.1.0

First working release. The repair functions move here from trimesh-build-js 0.5.0, unchanged:

- BMS level: `ingestToBMS`, `cleanSoup`, `orientMesh`, `orientByVisibility`, `validateMesh`,
  `pointInside`, `closeHoles`, `fillGaps`, `repairFolds`, `patchLoop`, `patchLoops`, `patchLoopIds`,
  `triangulateHole`, `fairFill`, `toIndexed`, and the edge table (`edgesOf`, `markCurrent`, `poolEdgeKey`).
- Indexed level ({ positions, index } in and out), moved from Kirra: `checkMesh`, `findOpenLoops`,
  `patchMeshLoops` (keeps the caller's winding), `patchMeshLoopsLocal`, `checkMeshIndexed`, `fillOpenEdges`,
  `bmsFromIndexed`, `summaryOfResult`, `soupOfIndexed`, `indexedOfSoup`, and the edge keys (`sortedEdgeKeys`,
  `hasRepeatedDirectedEdge`).
- Their tests, including the Wookey Hole real-cave tests (skipped when the samples are not beside
  this repo in `../trimesh-build-js/examples/public/samples`).

trimesh-build-js 0.6.0 imports these from here and re-exports them for one release.
