// src/post/fillGaps.js
//=============================================================
// FILL GAPS — repair voting gaps, on by default
//=============================================================
// Neighbouring patches sometimes split their votes and leave a tiny
// hole of a few edges. A loop of <= maxGapEdges edges (default 6)
// spans about two point spacings: smaller than the sampling can
// resolve, so it is a reconstruction defect, not a hole in the data.
// Real holes (occlusion, the scan edge) are left for closeHoles.
//
// Patched with patchLoopIds, method "auto" (shared with patchLoop):
// trimesh-boolean triangulateLoop on the loop's own vertices first,
// then a centroid fan, then a fan from a loop vertex. Run orientMesh
// afterwards to make the new triangles' winding agree.
//=============================================================

import { edgesOf, markCurrent } from "../bms/edges.js";
import { patchLoopIds } from "./patchLoop.js";

/**
 * @param {{pool: Object, soup: Array<Object>, constraintPoolEdges?: Set<string>}} bms - soup is appended to
 * @param {import("../validate/validateMesh.js").MeshResult} mesh
 * @param {number} maxGapEdges - 0 disables
 * @returns {{filled: number, triangles: number}}
 */
export function fillGaps(bms, mesh, maxGapEdges) {
	if (!(maxGapEdges >= 3)) return { filled: 0, triangles: 0 };
	var edges = edgesOf(bms);
	var filled = 0, added = 0;
	var loops = mesh.boundaryLoops || [];
	for (var i = 0; i < loops.length; i++) {
		if (loops[i].length > maxGapEdges) continue;
		var p = patchLoopIds(bms, edges, loops[i], "auto");
		if (!p.reason) { filled++; added += p.added; }
	}
	markCurrent(bms, edges);
	return { filled: filled, triangles: added };
}
