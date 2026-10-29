// src/bms/ingestToBMS.js
//=============================================================
// INGEST TO BMS — vertex-id triangles into Brent's Mega Soup
//=============================================================
// Every used vertex id goes through trimesh-boolean's
// createVertexPool once; the pool merges anything within tolerance
// (this IS the weld). Triangles become mega soup entries
// { v0, v1, v2, mesh: "A", origIdx } sharing PoolVertex objects,
// ready for bmsBooleanOp.
//=============================================================

import { createVertexPool } from "trimesh-boolean";

/**
 * @param {Float64Array} vertexCoords - XYZ of every vertex id
 * @param {Uint32Array} triangles - vertex ids, 3 per triangle
 * @param {number} tolerance - weld distance
 * @param {number} [seedFrom] - ids >= this (break line vertices) enter the pool first, so the
 *   weld snaps cloud points onto them and never moves a break line
 * @returns {{pool: Object, soup: Array<Object>, idToPool: Array<Object>}}
 *   idToPool[id] is the PoolVertex an id landed on (only for used ids)
 */
export function ingestToBMS(vertexCoords, triangles, tolerance, seedFrom) {
	var pool = createVertexPool(tolerance);
	var v = vertexCoords, n = v.length / 3;
	// id -> position in verts, in a typed array: an array indexed by scattered ids drops to
	// V8's slow sparse mode (this was 2 s of a 4M-point weld)
	var slot = new Int32Array(n).fill(-1);
	var verts = [];
	function poolOf(id) {
		var s = slot[id];
		if (s >= 0) return verts[s];
		var pv = pool.getOrCreate(v[3 * id], v[3 * id + 1], v[3 * id + 2]);
		slot[id] = verts.length;
		verts.push(pv);
		return pv;
	}
	if (seedFrom !== undefined) {
		for (var s = 0; s < triangles.length; s++) if (triangles[s] >= seedFrom) poolOf(triangles[s]);
	}
	var soup = new Array(triangles.length / 3);
	for (var t = 0, k = 0; t < triangles.length; t += 3, k++) {
		soup[k] = {
			v0: poolOf(triangles[t]),
			v1: poolOf(triangles[t + 1]),
			v2: poolOf(triangles[t + 2]),
			mesh: "A",
			origIdx: k
		};
	}
	// idToPool[id], undefined for ids no triangle uses; length is the highest used id + 1, as before
	var top = n;
	while (top > 0 && slot[top - 1] < 0) top--;
	var idToPool = [];
	for (var i = 0; i < top; i++) idToPool.push(slot[i] >= 0 ? verts[slot[i]] : undefined);
	return { pool: pool, soup: soup, idToPool: idToPool };
}
