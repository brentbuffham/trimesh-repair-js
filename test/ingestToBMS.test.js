// The weld: same pool vertices, ids and soup as the plain version (an array indexed by id, a
// pool lookup per vertex), including near-duplicate points, unused ids and break line seeds.
import { describe, it, expect } from "vitest";
import { createVertexPool } from "trimesh-boolean";
import { ingestToBMS } from "../src/index.js";

function reference(v, tris, tol, seedFrom) {
	var pool = createVertexPool(tol), idToPool = [];
	function poolOf(id) {
		var pv = idToPool[id];
		if (!pv) { pv = pool.getOrCreate(v[3 * id], v[3 * id + 1], v[3 * id + 2]); idToPool[id] = pv; }
		return pv;
	}
	if (seedFrom !== undefined) for (var s = 0; s < tris.length; s++) if (tris[s] >= seedFrom) poolOf(tris[s]);
	var soup = [];
	for (var t = 0; t < tris.length; t += 3) soup.push({ v0: poolOf(tris[t]), v1: poolOf(tris[t + 1]), v2: poolOf(tris[t + 2]), mesh: "A", origIdx: t / 3 });
	return { pool: pool, soup: soup, idToPool: idToPool };
}

// a seeded scatter with ~1 in 5 points a near-copy (inside the tolerance) of an earlier one
function scatter(n, tol) {
	var v = new Float64Array(3 * n), seed = 12345;
	function rnd() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
	for (var i = 0; i < n; i++) {
		if (i > 5 && rnd() < 0.2) {
			var j = Math.floor(rnd() * i);
			v[3 * i] = v[3 * j] + (rnd() - 0.5) * tol; v[3 * i + 1] = v[3 * j + 1] + (rnd() - 0.5) * tol; v[3 * i + 2] = v[3 * j + 2] + (rnd() - 0.5) * tol;
		} else { v[3 * i] = rnd() * 50; v[3 * i + 1] = rnd() * 50; v[3 * i + 2] = rnd() * 50; }
	}
	return { v: v, rnd: rnd };
}

describe("ingestToBMS", function () {
	[undefined, 400].forEach(function (seedFrom) {
		it("matches the plain weld" + (seedFrom === undefined ? "" : " with break line seeds"), function () {
			var n = 2000, tol = 0.05, sc = scatter(n, tol), tris = [];
			// triangles use only some ids (the rest are unused), ids repeat across triangles
			for (var t = 0; t < 1500; t++) tris.push(Math.floor(sc.rnd() * 1800), Math.floor(sc.rnd() * 1800), Math.floor(sc.rnd() * 1800));
			var a = ingestToBMS(sc.v, Uint32Array.from(tris), tol, seedFrom), b = reference(sc.v, tris, tol, seedFrom);
			expect(a.pool.size()).toBe(b.pool.size());
			expect(a.soup.length).toBe(b.soup.length);
			for (var i = 0; i < a.soup.length; i++) {
				expect([a.soup[i].v0.id, a.soup[i].v1.id, a.soup[i].v2.id, a.soup[i].origIdx, a.soup[i].mesh])
					.toEqual([b.soup[i].v0.id, b.soup[i].v1.id, b.soup[i].v2.id, b.soup[i].origIdx, b.soup[i].mesh]);
			}
			expect(a.idToPool.length).toBe(b.idToPool.length);
			for (var id = 0; id < b.idToPool.length; id++) expect(a.idToPool[id] ? a.idToPool[id].id : null).toBe(b.idToPool[id] ? b.idToPool[id].id : null);
			// the weld did merge something, or the test proves little
			expect(b.pool.size()).toBeLessThan(new Set(tris).size);
		});
	});
});
