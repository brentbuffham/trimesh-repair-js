// test/patchMeshLoopsLocal.test.js - moved from Kirra's src/meshRepair/__tests__/patchMeshLoopsLocal.vitest.js (0.1.0)
//=============================================================
// patchMeshLoopsLocal (aiPlans/20261025-0300 Task 7, issue #138): patch a hole from the triangles
// around it only - a BMS of each loop's ring, not of the whole mesh (61 s / ~1 GB at 8.6 M) - and
// hand back ONLY the triangles it added.
// Oracles: hand-built UTM meshes. A unit cube without its top, patched, is closed and 1 m³; a grid
// with a hole keeps its rim open; the patch is wound with its neighbours (no directed edge twice);
// two holes whose rings overlap are each patched once (Review Focus 4); the submesh is small.
//=============================================================
import { describe, it, expect } from "vitest";
import { patchMeshLoopsLocal, checkMeshIndexed } from "../src/index.js";
import { hasRepeatedDirectedEdge } from "../src/edgeKeys.js";

var OX = 478000, OY = 6970000, OZ = 300;
var FACES = [[0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6], [0, 1, 4], [1, 5, 4], [2, 6, 3], [3, 6, 7], [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5]];

function openCube() {
	var c = [];
	for (var i = 0; i < 8; i++) c.push(OX + (i & 1), OY + ((i >> 1) & 1), OZ + ((i >> 2) & 1));
	var idx = [];
	FACES.slice(0, 2).concat(FACES.slice(4)).forEach(function (f) { idx.push(f[0], f[1], f[2]); });
	return { positions: Float64Array.from(c), index: Uint32Array.from(idx) };
}
// an n x n grid on a 0.5 m step; triangles whose centre is within r of each hole centre removed
function grid(n, holes) {
	var pos = [], idx = [];
	for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) pos.push(OX + i * 0.5, OY + j * 0.5, OZ + 0.1 * Math.sin(i * 0.3) + 0.05 * Math.cos(j * 0.2));
	function keep(a, b, c) {
		var cx = (pos[3 * a] + pos[3 * b] + pos[3 * c]) / 3 - OX, cy = (pos[3 * a + 1] + pos[3 * b + 1] + pos[3 * c + 1]) / 3 - OY;
		return holes.every(function (h) { return Math.hypot(cx - h[0], cy - h[1]) > h[2]; });
	}
	for (var y = 0; y < n - 1; y++) for (var x = 0; x < n - 1; x++) {
		var a = y * n + x, b = a + 1, c = a + n, d = c + 1;
		if (keep(a, b, d)) idx.push(a, b, d);
		if (keep(a, d, c)) idx.push(a, d, c);
	}
	return { positions: Float64Array.from(pos), index: Uint32Array.from(idx) };
}

describe("patchMeshLoopsLocal", function () {
	it("the open cube's loop (fan): 2 triangles added; the mesh closes at 1 m³, coherently wound; input unchanged", function () {
		var m = openCube(), before = Array.from(m.index);
		var r = patchMeshLoopsLocal(m, [0], { method: "fan" });
		expect(r.patched).toBe(1);
		expect(r.added.length).toBe(2 * 9); // 2 triangles x 3 corners x xyz, world coordinates
		var c = checkMeshIndexed(r.mesh);
		expect(c.closed).toBe(true);
		expect(c.volume).toBeCloseTo(1, 9);
		expect(hasRepeatedDirectedEdge(r.mesh.index, r.mesh.positions.length / 3)).toBe(false);
		expect(Array.from(m.index)).toEqual(before);
	});

	it("by world points along the loop (Edit Mesh's picked loop)", function () {
		var pts = [[OX, OY, OZ + 1], [OX + 1, OY, OZ + 1], [OX + 1, OY + 1, OZ + 1], [OX, OY + 1, OZ + 1]];
		var r = patchMeshLoopsLocal(openCube(), pts, { method: "fan" });
		expect(r.patched).toBe(1);
		expect(checkMeshIndexed(r.mesh).closed).toBe(true);
	});

	it("Patch all up to 50 edges on a grid with a hole: the hole closes, the rim (80 edges) stays open, nothing non-manifold", function () {
		var m = grid(21, [[5, 5, 1]]);
		expect(checkMeshIndexed(m).openLoops).toBe(2);
		var r = patchMeshLoopsLocal(m, "all", { maxEdges: 50, method: "auto" });
		expect(r.patched).toBe(1);
		var c = checkMeshIndexed(r.mesh);
		expect(c.openLoops).toBe(1);
		expect(c.nonManifoldEdges).toBe(0);
		expect(hasRepeatedDirectedEdge(r.mesh.index, r.mesh.positions.length / 3)).toBe(false);
	});

	it("works from the hole's surroundings only: on a 39,200-triangle grid the submesh is a few hundred triangles", function () {
		var m = grid(141, [[35, 35, 1]]);
		var r = patchMeshLoopsLocal(m, "all", { maxEdges: 50, method: "fan" });
		expect(r.patched).toBe(1);
		expect(r.stats.largestSubmesh).toBeLessThan(600);
		expect(r.stats.largestSubmesh).toBeGreaterThan(0);
	});

	it("two holes whose rings overlap (Review Focus 4): both patched, each once - no edge used three times", function () {
		var m = grid(31, [[6, 7.5, 0.8], [8.6, 7.5, 0.8]]);
		var before = checkMeshIndexed(m);
		expect(before.openLoops).toBe(3); // rim + 2 holes
		var r = patchMeshLoopsLocal(m, "all", { maxEdges: 50, method: "auto" });
		expect(r.patched).toBe(2);
		var c = checkMeshIndexed(r.mesh);
		expect(c.openLoops).toBe(1);
		expect(c.nonManifoldEdges).toBe(0);
	});

	it("points that are on no open loop: refused with a reason, nothing added", function () {
		var r = patchMeshLoopsLocal(openCube(), [[OX + 0.5, OY + 0.5, OZ - 5], [OX + 0.6, OY + 0.5, OZ - 5], [OX + 0.5, OY + 0.6, OZ - 5]], {});
		expect(r.patched).toBe(0);
		expect(r.added.length).toBe(0);
		expect(r.refused.length).toBe(1);
		expect(typeof r.refused[0].reason).toBe("string");
	});
});

describe("review fixes (final review, 2026-10-25)", function () {
	// the same 21 x 21 grid with a hole, placed at a SMALL origin (a local mine grid, RLs near 0)
	function localGrid() {
		var n = 21, pos = [], idx = [];
		for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) pos.push(3 + i * 0.5, 7 + j * 0.5, 0.1 * Math.sin(i * 0.3));
		function keep(a, b, c) {
			var cx = (pos[3 * a] + pos[3 * b] + pos[3 * c]) / 3 - 8, cy = (pos[3 * a + 1] + pos[3 * b + 1] + pos[3 * c + 1]) / 3 - 12;
			return Math.hypot(cx, cy) > 1;
		}
		for (var y = 0; y < n - 1; y++) for (var x = 0; x < n - 1; x++) {
			var a = y * n + x, b = a + 1, c = a + n, d = c + 1;
			if (keep(a, b, d)) idx.push(a, b, d);
			if (keep(a, d, c)) idx.push(a, d, c);
		}
		return { positions: Float64Array.from(pos), index: Uint32Array.from(idx) };
	}

	it("Important 3a: a hole on a grid at small coordinates is patched (not refused)", function () {
		var r = patchMeshLoopsLocal(localGrid(), "all", { maxEdges: 50, method: "fan" });
		expect(r.refused).toEqual([]);
		expect(r.patched).toBe(1);
		expect(checkMeshIndexed(r.mesh).openLoops).toBe(1);
	});

	it("Important 3b: a hole beside duplicate vertices (same coordinates, other ids) is patched, as the whole-mesh patch does", function () {
		var m = grid(21, [[5, 5, 1]]);
		// give two triangles near the hole their own copy of a shared vertex (an exact duplicate)
		var pos = Array.from(m.positions), idx = Array.from(m.index), V = pos.length / 3;
		var target = 8 * 21 + 8; // a vertex one ring out from the hole
		var hits = 0;
		for (var t = 0; t < idx.length && hits < 2; t += 3) {
			for (var c = 0; c < 3; c++) if (idx[t + c] === target) { idx[t + c] = V; hits++; break; }
		}
		pos.push(pos[3 * target], pos[3 * target + 1], pos[3 * target + 2]);
		var dup = { positions: Float64Array.from(pos), index: Uint32Array.from(idx) };
		var r = patchMeshLoopsLocal(dup, "all", { maxEdges: 50, method: "fan" });
		expect(r.refused).toEqual([]);
		expect(r.patched).toBe(1);
	});
});
