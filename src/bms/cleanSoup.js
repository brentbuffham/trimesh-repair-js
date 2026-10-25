// src/bms/cleanSoup.js
//=============================================================
// CLEAN SOUP — tidy up after the BMS pool has welded
//=============================================================
// The pool did the welding in ingestToBMS. This step removes what
// the weld leaves behind (triangles with two corners on one
// PoolVertex, and repeated triangles), counts edge use, and maps
// the break line segments onto pool ids:
//   bms.constraintPoolEdges - Set of pool edge keys
//   bms.constrainedPairs    - Array<{a, b}> of pool ids
// A constraint whose ends welded together is reported, not hidden.
//=============================================================

import { edgesOf, poolEdgeKey } from "./edges.js";

/**
 * @param {{pool: Object, soup: Array<Object>, idToPool: Array<Object>}} bms - mutated
 * @param {{segments: Uint32Array}} constraints
 * @returns {{merged: number, degenerate: number, duplicates: number,
 *   boundaryEdges: number, nonManifoldEdges: number, collapsedConstraints: number}}
 */
export function cleanSoup(bms, constraints) {
	// ids that landed on a PoolVertex an earlier id already had
	var seen = new Set(), merged = 0;
	for (var id = 0; id < bms.idToPool.length; id++) {
		var pv = bms.idToPool[id];
		if (!pv) continue;
		if (seen.has(pv)) merged++;
		else seen.add(pv);
	}

	var kept = [], degenerate = 0, duplicates = 0;
	// duplicate test on sorted ids: (lo, mid) -> the high ids seen with them
	var faces = new Map();
	for (var t = 0; t < bms.soup.length; t++) {
		var tri = bms.soup[t];
		var a = tri.v0.id, b = tri.v1.id, c = tri.v2.id;
		if (a === b || b === c || a === c) { degenerate++; continue; }
		var lo = Math.min(a, b, c), hi = Math.max(a, b, c), mid = a + b + c - lo - hi;
		var k = poolEdgeKey(lo, mid), seen = faces.get(k);
		if (seen === undefined) faces.set(k, hi);
		else if (seen === hi || (Array.isArray(seen) && seen.indexOf(hi) >= 0)) { duplicates++; continue; }
		else if (Array.isArray(seen)) seen.push(hi);
		else faces.set(k, [seen, hi]);
		tri.origIdx = kept.length;
		kept.push(tri);
	}
	bms.soup.length = 0;
	for (var k = 0; k < kept.length; k++) bms.soup.push(kept[k]);

	var edges = edgesOf(bms);
	var boundary = 0, nonManifold = 0;
	edges.forEach(function (n) {
		if (n === 1) boundary++;
		else if (n > 2) nonManifold++;
	});

	var segs = constraints.segments || new Uint32Array(0);
	var poolEdges = new Set(), pairs = [], collapsed = 0;
	for (var i = 0; i < segs.length; i += 2) {
		var pa = bms.idToPool[segs[i]], pb = bms.idToPool[segs[i + 1]];
		if (!pa || !pb) continue;
		if (pa === pb) { collapsed++; continue; }
		var key = poolEdgeKey(pa.id, pb.id);
		if (poolEdges.has(key)) continue;
		poolEdges.add(key);
		pairs.push({ a: pa.id, b: pb.id });
	}
	bms.constraintPoolEdges = poolEdges;
	bms.constrainedPairs = pairs;

	return {
		merged: merged,
		degenerate: degenerate,
		duplicates: duplicates,
		boundaryEdges: boundary,
		nonManifoldEdges: nonManifold,
		collapsedConstraints: collapsed
	};
}
