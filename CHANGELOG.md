# Changelog

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
