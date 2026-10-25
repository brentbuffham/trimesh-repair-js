// src/post/repairFolds.js
//=============================================================
// REPAIR FOLDS — cut twisted strips so the mesh can be oriented
//=============================================================
// A scan mesh can hold twisted (Mobius) strips between holes: no
// winding makes every interior edge run both ways, so validateMesh
// reports orientationConflicts, rendering shows black patches, and
// patching the holes spreads the twist (Wookey Hole: ~3,600 conflict
// edges once every loop was patched).
//
// orientMesh leaves each strip's seam on its sharpest crease, the fold
// that makes the twist. Removing the triangles on the seam cuts the
// strip, so it orients; the cut joins two holes, which fillGaps or
// patchLoops close as usual. Wookey Hole: 841 triangles (0.3 %)
// removed, then 0 conflicts before and after patching.
//
// A triangle on a break line edge is never removed (the conflict it
// sits on is counted in kept). Repeats until no conflicts are left
// or maxPasses.
//=============================================================

import { edgesOf, poolEdgeKey } from "../bms/edges.js";
import { orientMesh } from "../bms/orientMesh.js";

// index of the vertex triangle t starts edge key from
function startOf(t, key) {
	var vs = [t.v0.id, t.v1.id, t.v2.id];
	for (var e = 0; e < 3; e++) if (poolEdgeKey(vs[e], vs[(e + 1) % 3]) === key) return vs[e];
	return -1;
}

function onBreakline(t, cons) {
	if (!cons.size) return false;
	return cons.has(poolEdgeKey(t.v0.id, t.v1.id)) || cons.has(poolEdgeKey(t.v1.id, t.v2.id)) || cons.has(poolEdgeKey(t.v2.id, t.v0.id));
}

/**
 * Remove the triangles on orientation-conflict edges, then re-orient.
 * Expects bms already oriented (orientMesh). The soup is compacted in place.
 * @param {{soup: Array<Object>, constraintPoolEdges?: Set<number>}} bms
 * @param {{viewpoints?: Array<number[]>, maxPasses?: number}} [options] - viewpoints origin-shifted; maxPasses default 3
 * @returns {{removed: number, kept: number, passes: number,
 *   orientation: ReturnType<typeof orientMesh>|null}} kept: conflict edges left because a
 *   triangle on them is on a break line; orientation: the last orientMesh result (null when nothing was removed)
 */
export function repairFolds(bms, options) {
	var opts = options || {};
	var maxPasses = opts.maxPasses !== undefined ? opts.maxPasses : 3;
	var cons = bms.constraintPoolEdges || new Set();
	var removed = 0, kept = 0, passes = 0, orientation = null;
	while (passes < maxPasses) {
		var soup = bms.soup, edges = edgesOf(bms);
		var drop = new Uint8Array(soup.length), any = false;
		kept = 0;
		edges.forEach(function (faces, key, t0, t1) {
			if (faces !== 2 || startOf(soup[t0], key) !== startOf(soup[t1], key)) return;
			if (onBreakline(soup[t0], cons) || onBreakline(soup[t1], cons)) { kept++; return; }
			drop[t0] = 1; drop[t1] = 1; any = true;
		});
		if (!any) break;
		var m = 0;
		for (var i = 0; i < soup.length; i++) if (!drop[i]) soup[m++] = soup[i];
		removed += soup.length - m;
		soup.length = m;
		passes++;
		orientation = orientMesh(bms, opts.viewpoints || null);
	}
	return { removed: removed, kept: kept, passes: passes, orientation: orientation };
}
