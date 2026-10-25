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
	var idToPool = [];
	var v = vertexCoords;
	function poolOf(id) {
		var pv = idToPool[id];
		if (!pv) {
			pv = pool.getOrCreate(v[3 * id], v[3 * id + 1], v[3 * id + 2]);
			idToPool[id] = pv;
		}
		return pv;
	}
	if (seedFrom !== undefined) {
		for (var s = 0; s < triangles.length; s++) if (triangles[s] >= seedFrom) poolOf(triangles[s]);
	}
	var soup = [];
	for (var t = 0; t < triangles.length; t += 3) {
		soup.push({
			v0: poolOf(triangles[t]),
			v1: poolOf(triangles[t + 1]),
			v2: poolOf(triangles[t + 2]),
			mesh: "A",
			origIdx: t / 3
		});
	}
	return { pool: pool, soup: soup, idToPool: idToPool };
}
