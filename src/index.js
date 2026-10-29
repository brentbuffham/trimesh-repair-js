/**
 * trimesh-repair-js
 *
 * Repair functions for the trimesh family of JavaScript meshing libraries (trimesh-boolean,
 * trimesh-build-js): find and patch open loops (auto, fair, fan, centroid, vertex fan), fill gaps,
 * close holes, repair folds, orient, and check a mesh (closed, non-manifold edges, enclosed volume).
 *
 * Two levels:
 *   - the BMS level - functions on a trimesh-boolean BMS result ({ soup, pool, mesh }), as
 *     trimesh-build-js used them before 0.6.0;
 *   - the indexed level - an indexed world mesh ({ positions: Float64Array, index: Uint32Array })
 *     in and out (from 0.1.0, src/indexed.js).
 *
 * Moved from trimesh-build-js 0.5.0 (src/bms, src/post, src/validate, src/output) - the functions
 * and their signatures are unchanged. Built and proven in Kirra (kirra-design.com) first.
 *
 * Author: Brent Buffham (kirra-design.com)
 *
 * @module trimesh-repair-js
 */

export var VERSION = "0.1.4";

// ── BMS level ──
export { edgesOf, markCurrent, poolEdgeKey } from "./bms/edges.js";
export { ingestToBMS } from "./bms/ingestToBMS.js";
export { cleanSoup } from "./bms/cleanSoup.js";
export { orientMesh } from "./bms/orientMesh.js";
export { orientByVisibility } from "./bms/visibility.js";
export { validateMesh, pointInside } from "./validate/validateMesh.js";
export { closeHoles } from "./post/closeHoles.js";
export { fillGaps } from "./post/fillGaps.js";
export { repairFolds } from "./post/repairFolds.js";
export { patchLoop, patchLoops, patchLoopIds } from "./post/patchLoop.js";
export { triangulateHole, fairFill } from "./post/fairFill.js";
export { toIndexed } from "./output/toIndexed.js";

// ── Indexed level ({ positions, index } in and out) ──
export { bmsFromIndexed, summaryOfResult, checkMesh, findOpenLoops, patchMeshLoops, fillOpenEdges, checkMeshIndexed, patchMeshLoopsLocal, soupOfIndexed, indexedOfSoup, DEFAULT_TOLERANCE } from "./indexed.js";
export * from "./edgeKeys.js";
