// test/checkMeshIndexed.test.js - moved from Kirra's src/meshRepair/__tests__/checkMeshIndexed.vitest.js (0.1.0)
//=============================================================
// checkMeshIndexed (aiPlans/20261025-0300 Task 6, issue #138): the repair report - closed, volume,
// open loops, non-manifold edges - straight from the typed arrays, no BMS. Phase 1 measured the
// BMS read at 61 s and ~1 GB (Chrome) to find ONE 30-edge loop on the 8.6 M-triangle WALL mesh.
// Oracles: hand-counted UTM fixtures (a unit cube is 1 m³ and closed; without its top it has one
// 4-corner loop; a grid with a hole has its rim and the hole) AND parity with checkMesh, the BMS
// read the Repair section used until now (an independent implementation).
//=============================================================
import { describe, it, expect } from "vitest";
import { checkMeshIndexed, checkMesh } from "../src/index.js";

var OX = 478000, OY = 6970000, OZ = 300;
var FACES = [[0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6], [0, 1, 4], [1, 5, 4], [2, 6, 3], [3, 6, 7], [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5]];

function cubeOf(faces, extraPos) {
	var c = [];
	for (var i = 0; i < 8; i++) c.push(OX + (i & 1), OY + ((i >> 1) & 1), OZ + ((i >> 2) & 1));
	if (extraPos) c = c.concat(extraPos);
	var idx = [];
	faces.forEach(function (f) { idx.push(f[0], f[1], f[2]); });
	return { positions: Float64Array.from(c), index: Uint32Array.from(idx) };
}
function gridWithHole() {
	var n = 21, pos = [], idx = [];
	for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) pos.push(OX + i * 0.5, OY + j * 0.5, OZ + 0.1 * Math.sin(i * 0.3));
	function keep(a, b, c) {
		var cx = (pos[3 * a] + pos[3 * b] + pos[3 * c]) / 3 - (OX + 5), cy = (pos[3 * a + 1] + pos[3 * b + 1] + pos[3 * c + 1]) / 3 - (OY + 5);
		return Math.hypot(cx, cy) > 1;
	}
	for (var y = 0; y < n - 1; y++) for (var x = 0; x < n - 1; x++) {
		var a = y * n + x, b = a + 1, c = a + n, d = c + 1;
		if (keep(a, b, d)) idx.push(a, b, d);
		if (keep(a, d, c)) idx.push(a, d, c);
	}
	return { positions: Float64Array.from(pos), index: Uint32Array.from(idx) };
}
// skipLoops: a loop that closes only through a NON-MANIFOLD edge (a fin) is a loop to the BMS read
// but not a hole - checkMeshIndexed chains loops of open edges only (ruling, ledger Task 6).
// Volume to 1e-3: on a welded crack the BMS sums its welded positions, this the raw ones.
function parity(m, skipLoops) {
	var a = checkMeshIndexed(m), b = checkMesh(m);
	expect(a.triangles).toBe(b.triangles);
	expect(a.closed).toBe(b.closed);
	if (!skipLoops) expect(a.openLoops).toBe(b.openLoops);
	expect(a.boundaryEdges).toBe(b.boundaryEdges);
	expect(a.nonManifoldEdges).toBe(b.nonManifoldEdges);
	if (b.volume == null) expect(a.volume).toBeNull();
	else expect(a.volume).toBeCloseTo(b.volume, 3);
	return a;
}

describe("checkMeshIndexed", function () {
	it("a closed unit cube: closed, 1 m³, no loops", function () {
		var r = parity(cubeOf(FACES));
		expect(r.closed).toBe(true);
		expect(r.volume).toBeCloseTo(1, 9);
		expect(r.openLoops).toBe(0);
	});

	it("the cube without its top: open, no volume, ONE loop of the 4 top corners in world coordinates", function () {
		var r = parity(cubeOf(FACES.slice(0, 2).concat(FACES.slice(4))));
		expect(r.openLoops).toBe(1);
		expect(r.boundaryEdges).toBe(4);
		var l = r.loops[0];
		expect(l.length).toBe(12);
		[l[2], l[5], l[8], l[11]].forEach(function (z) { expect(z).toBe(OZ + 1); });
	});

	it("a grid with a hole: two loops (the rim and the hole)", function () {
		expect(parity(gridWithHole()).openLoops).toBe(2);
	});

	it("a crack: the top face's two corners duplicated 0.4 mm off - welded at 1 mm, closed, 1 m³", function () {
		// vertices 8, 9 sit 0.4 mm from 6, 7; the top face uses them instead
		var faces = FACES.slice();
		faces[2] = [4, 5, 8];
		faces[3] = [5, 9, 8];
		var r = parity(cubeOf(faces, [OX, OY + 1.0004, OZ + 1, OX + 1, OY + 1.0004, OZ + 1]));
		expect(r.closed).toBe(true);
		expect(r.volume).toBeCloseTo(1, 3);
	});

	it("one face wound the wrong way (closed, winding not coherent): still 1 m³, as the BMS read orients", function () {
		var faces = FACES.slice();
		faces[0] = [0, 1, 2];
		var r = parity(cubeOf(faces));
		expect(r.volume).toBeCloseTo(1, 9);
	});

	it("a fin on a cube edge: one non-manifold edge", function () {
		var faces = FACES.concat([[0, 1, 8]]);
		var r = parity(cubeOf(faces, [OX + 0.5, OY - 1, OZ - 1]), true);
		expect(r.nonManifoldEdges).toBe(1);
		expect(r.boundaryEdges).toBe(2); // the fin's two free edges
		expect(r.openLoops).toBe(0);
		expect(r.closed).toBe(false);
	});

	it("an empty mesh: zero everything", function () {
		var r = checkMeshIndexed({ positions: new Float64Array(0), index: new Uint32Array(0) });
		expect(r.triangles).toBe(0);
		expect(r.openLoops).toBe(0);
	});
});

describe("review fixes (final review, 2026-10-25)", function () {
	it("Important 1: a cube whose top sits on 0.3 mm duplicates of ALL four corners, wound inward: 1 m³, not a third of it", function () {
		// no raw edge joins the top to the sides - only the weld closes it, so only a welded winding check sees it
		var faces = FACES.slice();
		faces[2] = [8, 10, 9];
		faces[3] = [9, 10, 11];
		var dup = [];
		for (var i = 4; i < 8; i++) dup.push(OX + (i & 1), OY + ((i >> 1) & 1), OZ + 1 + 0.0003);
		var r = parity(cubeOf(faces, dup));
		expect(r.closed).toBe(true);
		expect(r.volume).toBeCloseTo(1, 2);
	});

	// two square holes in a grid that touch at ONE vertex (a pinch); the vertices renumbered at random
	function pinchGrid(seed) {
		var n = 7, pos = [], idx = [];
		for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) pos.push(OX + i, OY + j, OZ);
		for (var y = 0; y < n - 1; y++) for (var x = 0; x < n - 1; x++) {
			if ((x === 2 && y === 2) || (x === 3 && y === 3)) continue; // the two holes share vertex (3, 3)
			var a = y * n + x, b = a + 1, c = a + n, d = c + 1;
			idx.push(a, b, d, a, d, c);
		}
		var V = n * n, perm = [], s = seed;
		for (var k = 0; k < V; k++) perm.push(k);
		for (k = V - 1; k > 0; k--) { s = (s * 1103515245 + 12345) % 2147483648; var r = s % (k + 1), tmp = perm[k]; perm[k] = perm[r]; perm[r] = tmp; }
		var p2 = new Float64Array(3 * V);
		for (k = 0; k < V; k++) { p2[3 * perm[k]] = pos[3 * k]; p2[3 * perm[k] + 1] = pos[3 * k + 1]; p2[3 * perm[k] + 2] = pos[3 * k + 2]; }
		return { positions: p2, index: Uint32Array.from(idx.map(function (v) { return perm[v]; })) };
	}

	it("Important 2: two holes touching at a vertex are TWO loops of 4, whatever the vertex numbering (40 numberings)", function () {
		for (var seed = 1; seed <= 40; seed++) {
			var r = checkMeshIndexed(pinchGrid(seed));
			expect(r.openLoops, "seed " + seed).toBe(3); // the rim + 2 holes
			var holes = r.loopIds.map(function (l) { return l.length; }).sort(function (a, b) { return a - b; });
			expect(holes.slice(0, 2), "seed " + seed).toEqual([4, 4]);
		}
	});
});
