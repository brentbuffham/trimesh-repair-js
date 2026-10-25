// src/post/closeHoles.js
//=============================================================
// CLOSE HOLES — opt-in centroid fan over boundary loops
//=============================================================
// For each loop up to maxLoopEdges: one Steiner PoolVertex at the
// loop centroid, fanned to every loop edge (patchLoopIds, method
// "centroid", shared with patchLoop and fillGaps). Each fan triangle
// runs its loop edge opposite to the mesh triangle there, so winding
// stays consistent. A 3-edge loop gets one triangle and no Steiner.
//
// Never throws for a loop it cannot fill; it returns it:
//   - longer than maxLoopEdges,
//   - not simple (a vertex repeats) or not closed,
//   - runs along a break line edge (never crossed or capped),
//   - a fan edge would get a third face,
//   - the centroid lands on an existing vertex.
//=============================================================

import { edgesOf, markCurrent } from "../bms/edges.js";
import { patchLoopIds } from "./patchLoop.js";

/**
 * @param {{pool: Object, soup: Array<Object>, constraintPoolEdges?: Set<string>}} bms - soup is appended to
 * @param {import("../validate/validateMesh.js").MeshResult} mesh
 * @param {{maxLoopEdges?: number}} [options]
 * @returns {{added: number, unfilledLoops: number[][]}}
 */
export function closeHoles(bms, mesh, options) {
	var maxLoopEdges = options && options.maxLoopEdges !== undefined ? options.maxLoopEdges : 200;
	var edges = edgesOf(bms);
	var added = 0, unfilled = [];
	var loops = mesh.boundaryLoops || [];
	for (var i = 0; i < loops.length; i++) {
		if (loops[i].length > maxLoopEdges) { unfilled.push(loops[i]); continue; }
		var p = patchLoopIds(bms, edges, loops[i], "centroid");
		if (p.reason) unfilled.push(loops[i]);
		else added += p.added;
	}
	markCurrent(bms, edges);
	return { added: added, unfilledLoops: unfilled };
}
