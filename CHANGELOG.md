# Changelog

## 0.1.5

- **`orientMesh` is about 4x faster standalone and leaner in memory. Same results.** It reads vertex ids from one typed array (kept in step with the flips) instead of through three objects per step, computes the face normals without an array per triangle, and its heap moves a held entry through a hole instead of swapping three arrays per level. The 260k-triangle Wookey Hole cave orients in 0.12 s (0.46 s in 0.1.2); winding, components and `perComponent` are identical to 0.1.2 on seven meshes, including a flat grid where every weight ties, and a test pops the new heap against the old one entry for entry on tie-heavy input.
- **The heap starts at 4096 entries and doubles** (it had room for 3 per triangle, 48 bytes a triangle: 140 MB on a 3M-triangle mesh).
- **`EdgeTable` no longer stores a key per edge** (8 bytes an edge); `forEach` computes it from the two ids. It throws a `RangeError` naming tiling when a vertex id is 67,108,864 or more, instead of letting two edges share a key: `poolEdgeKey` packs both ids into one double, exact only below 2^26.
- **`fairFill`: a `maxEdges` of 0 is used as given** (it was `o.maxEdges || 5000`).

## Unreleased

- `trimesh-boolean` is installed from GitHub (`git+https://github.com/brentbuffham/trimesh-boolean.git#master`, 0.7.8: its vertex pool searches 8 cells, not 27, which speeds the weld). **Change it back to `^0.7.8` once trimesh-boolean 0.7.8 is on npm.**
- The las-laz-js dev dependency is `git+https://github.com/brentbuffham/las-laz-js.git#main` (0.18.1, the faster `dedupe`), so one copy installs. **When las-laz-js 0.18.1 or later is on npm, change it back to `^0.18.1`**, with the trimesh-build-js one.

## 0.1.4

- **Faster weld and orientation set-up. Same results.** `ingestToBMS` looked each vertex up in an array indexed by scattered ids, which V8 holds in its slow sparse mode (2 s of a 4M-point weld); it now uses a typed-array index and builds `idToPool` once at the end. `orientMesh` builds each triangle's neighbours from one pass over the edge table's slots on typed arrays, not a hash lookup per triangle edge. A 260k-triangle cave orients in 0.17 s (0.45 s in 0.1.2); the winding, components and `perComponent` are identical to 0.1.2 on scrambled caves, and the weld matches a plain reference weld on a scatter with near-duplicate points, unused ids and break line seeds.

## 0.1.3

- **Faster orientation and edge lookups. Same results.** `EdgeTable` was a `Map` keyed by one 52-bit double, so every lookup hashed a heap number; it is now an open-addressing hash table over the two vertex ids in typed arrays, with `slot(a, b)` and `addEdge(a, b, t)` beside the key methods. `orientMesh` looked an edge up about ten times per edge (reach, the walk, the consistency pass); it now reads each triangle's neighbours from one flat table built once. On a 260k-triangle cave `orientMesh` takes 0.21 s, was 0.43 s. The winding, components and `perComponent` are identical to 0.1.2 on a 20k sphere and three cave meshes with half the triangles flipped at random.
- `edgesOf` rebuilds a cached table that came from another copy or version of the library, instead of calling methods it may not have.
- The dev dependency on trimesh-build-js is now `git+https://github.com/brentbuffham/trimesh-build-js.git#main` (was `0.5.0`), and las-laz-js is `^0.18.0`, so one copy of each is installed. **Before this library goes to npm, once trimesh-build-js is published, change the git URL back to a version range.** (trimesh-build-js installs this library from GitHub the same way until then.)

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
