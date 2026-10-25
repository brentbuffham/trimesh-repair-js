// test/indexed.test.js - moved from Kirra's src/meshRepair/__tests__/indexed.vitest.js (0.1.0)
//=============================================================
// The indexed-mesh level of the mesh repair front door (aiPlans/20261024-2300 Task 1):
// { positions: Float64Array world xyz, index: Uint32Array } in and out.
// Oracle: a unit cube (volume 1 m³, 12 triangles, outward winding) at UTM (478000 E / 6970000 N),
// the same cube missing one face (one 4-corner open loop), and a 10 x 10 m grid with a hole -
// the hole closes, the outer rim (> 50 edges) stays open (Review Focus 3).
//=============================================================
import { describe, it, expect } from "vitest";
import { checkMesh, findOpenLoops, patchMeshLoops, bmsFromIndexed } from "../src/index.js";

var OX = 478000, OY = 6970000, OZ = 300;

// unit cube, corners 0..7, faces wound outward (right-hand rule)
function cube(dropTop) {
	var c = [];
	for (var i = 0; i < 8; i++) c.push(OX + (i & 1), OY + ((i >> 1) & 1), OZ + ((i >> 2) & 1));
	var faces = [
		[0, 2, 1], [1, 2, 3], // bottom z=0 (normal -z)
		[4, 5, 6], [5, 7, 6], // top z=1 (normal +z)
		[0, 1, 4], [1, 5, 4], // y=0 (normal -y)
		[2, 6, 3], [3, 6, 7], // y=1 (normal +y)
		[0, 4, 2], [2, 4, 6], // x=0 (normal -x)
		[1, 3, 5], [3, 7, 5]  // x=1 (normal +x)
	];
	if (dropTop) faces.splice(2, 2);
	var idx = [];
	faces.forEach(function (f) { idx.push(f[0], f[1], f[2]); });
	return { positions: Float64Array.from(c), index: Uint32Array.from(idx) };
}

// a 10 x 10 m grid on a 0.5 m step (20 x 20 cells), triangles within 1 m of the centre removed
function gridWithHole() {
	var n = 21, pos = [], idx = [];
	for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) pos.push(OX + i * 0.5, OY + j * 0.5, OZ + 0.1 * Math.sin(i * 0.3));
	function keep(a, b, c) {
		var cx = (pos[3 * a] + pos[3 * b] + pos[3 * c]) / 3 - (OX + 5), cy = (pos[3 * a + 1] + pos[3 * b + 1] + pos[3 * c + 1]) / 3 - (OY + 5);
		return Math.hypot(cx, cy) > 1;
	}
	for (var y = 0; y < n - 1; y++) {
		for (var x = 0; x < n - 1; x++) {
			var a = y * n + x, b = a + 1, c = a + n, d = c + 1;
			if (keep(a, b, d)) idx.push(a, b, d);
			if (keep(a, d, c)) idx.push(a, d, c);
		}
	}
	return { positions: Float64Array.from(pos), index: Uint32Array.from(idx) };
}

describe("checkMesh", function () {
	it("a closed unit cube: closed, volume 1 m³, no open loops", function () {
		var r = checkMesh(cube(false));
		expect(r.closed).toBe(true);
		expect(r.volume).toBeCloseTo(1, 9);
		expect(r.openLoops).toBe(0);
		expect(r.nonManifoldEdges).toBe(0);
	});
	it("the cube without its top: open, no volume, one loop of the 4 top corners in world coordinates", function () {
		var r = checkMesh(cube(true));
		expect(r.closed).toBe(false);
		expect(r.volume).toBeNull();
		expect(r.openLoops).toBe(1);
		var l = r.loops[0];
		expect(l.length).toBe(12);
		var zs = [l[2], l[5], l[8], l[11]];
		zs.forEach(function (z) { expect(z).toBeCloseTo(OZ + 1, 9); });
		expect(Math.min(l[0], l[3], l[6], l[9])).toBeCloseTo(OX, 9);
	});
});

describe("findOpenLoops", function () {
	it("the open cube has one loop; the closed cube none", function () {
		expect(findOpenLoops(cube(true)).length).toBe(1);
		expect(findOpenLoops(cube(false)).length).toBe(0);
	});
});

describe("patchMeshLoops", function () {
	it("patching the open cube's loop closes it with volume 1 m³ (any flat cap of a unit square), input unchanged", function () {
		var m = cube(true);
		var before = Array.from(m.index);
		var beforePos = Array.from(m.positions);
		var r = patchMeshLoops(m, 0, { method: "fan" });
		expect(r.patched).toBe(1);
		var c = checkMesh(r.mesh);
		expect(c.closed).toBe(true);
		expect(c.volume).toBeCloseTo(1, 9);
		expect(Array.from(m.index)).toEqual(before);
		expect(Array.from(m.positions)).toEqual(beforePos);
	});
	["auto", "fair", "fan", "centroid", "vertexFan"].forEach(function (method) {
		it("grid with a hole, Patch all up to 50 edges, method " + method + ": the hole closes or is refused with a reason; the rim stays open", function () {
			var m = gridWithHole();
			expect(checkMesh(m).openLoops).toBe(2); // rim + hole
			var r = patchMeshLoops(m, "all", { method: method, maxEdges: 50 });
			var after = checkMesh(r.mesh);
			if (r.patched === 1) expect(after.openLoops).toBe(1);
			else expect(r.refused.length).toBe(1), expect(typeof r.refused[0].reason).toBe("string");
			expect(after.openLoops).toBeGreaterThanOrEqual(1); // the outer rim (80 edges) was never touched
		});
	});
});

describe("bmsFromIndexed", function () {
	it("gives a library-level result the lifted functions accept (validateMesh-shaped mesh, world origin)", function () {
		var r = bmsFromIndexed(cube(false).positions, cube(false).index, 0.001);
		expect(r.mesh.closed).toBe(true);
		expect(r.origin.x).toBe(OX);
		expect(r.soup.length).toBe(12);
	});
});

// Phase A final review (2026-10-25), I4: patchMeshLoops re-oriented the WHOLE mesh with
// trimesh-build's cave convention (a closed component's normals INTO it), so an outward solid
// came back inside-out after a patch. Oracle: the divergence theorem - an outward unit cube has
// signed volume +1 (sum of v0 . (v1 x v2) / 6, taken about the first corner against UTM loss).
function signedVolume(m) {
	var p = m.positions, ix = m.index, ox = p[0], oy = p[1], oz = p[2], v = 0;
	for (var t = 0; t < ix.length; t += 3) {
		var a = 3 * ix[t], b = 3 * ix[t + 1], c = 3 * ix[t + 2];
		var ax = p[a] - ox, ay = p[a + 1] - oy, az = p[a + 2] - oz;
		var bx = p[b] - ox, by = p[b + 1] - oy, bz = p[b + 2] - oz;
		var cx = p[c] - ox, cy = p[c + 1] - oy, cz = p[c + 2] - oz;
		v += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
	}
	return v / 6;
}
describe("review I4 / M4: patchMeshLoops keeps the caller's winding, and fan / auto really patch", function () {
	it("the outward open cube, patched, is an OUTWARD closed cube: signed volume +1", function () {
		expect(signedVolume(cube(false))).toBeCloseTo(1, 9); // the fixture is outward
		var r = patchMeshLoops(cube(true), 0, { method: "fan" });
		expect(r.patched).toBe(1);
		expect(signedVolume(r.mesh)).toBeCloseTo(1, 9);
	});
	["auto", "fan"].forEach(function (method) {
		it("grid with a 1 m hole, Patch all up to 50 edges, " + method + ": the hole IS patched (not refused); the rim stays", function () {
			var r = patchMeshLoops(gridWithHole(), "all", { method: method, maxEdges: 50 });
			expect(r.patched).toBe(1);
			expect(checkMesh(r.mesh).openLoops).toBe(1);
		});
	});
});
