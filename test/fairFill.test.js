import { describe, it, expect } from "vitest";
import { buildMesh } from "trimesh-build-js";
import { patchLoop } from "../src/index.js";
import { triangulateHole, fairFill } from "../src/post/fairFill.js";
import { orientMesh } from "../src/bms/orientMesh.js";
import { validateMesh } from "../src/validate/validateMesh.js";
import { windingConsistent } from "./fixtures/pipeline.js";
import { fibonacciSphere, sphereWithCap, planarGrid } from "./fixtures/synthetic.js";

// Planar grid with the points inside a circle removed: one round hole
function gridWithHole(n, spacing, radius) {
	var g = planarGrid(n, n, spacing), c = (n - 1) * spacing / 2, out = [];
	for (var i = 0; i < g.count; i++) {
		var x = g.positions[3 * i], y = g.positions[3 * i + 1];
		if (Math.hypot(x - c, y - c) < radius) continue;
		out.push(x, y, 0);
	}
	return { count: out.length / 3, positions: Float64Array.from(out) };
}

function longestLoop(r) {
	var best = 0;
	r.mesh.boundaryLoops.forEach(function (l, i) { if (l.length > r.mesh.boundaryLoops[best].length) best = i; });
	return best;
}

describe("triangulateHole (minimum weight, Liepa 2003 step 1)", function () {
	var square = Float64Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);

	it("triangulates a loop of n vertices into n - 2 triangles", function () {
		var t = triangulateHole(square, null, null);
		expect(t.length).toBe(2);
	});

	it("never uses a diagonal that already exists in the mesh", function () {
		var t = triangulateHole(square, null, function (i, k) { return (i === 0 && k === 2) || (i === 2 && k === 0); });
		expect(t.length).toBe(2);
		t.forEach(function (tri) { expect(tri.indexOf(0) >= 0 && tri.indexOf(2) >= 0).toBe(false); });
	});

	it("returns null when every triangulation needs a forbidden diagonal", function () {
		expect(triangulateHole(square, null, function () { return true; })).toBeNull();
	});
});

// A good closed sphere mesh with every triangle within capAngle of +Y removed
function sphereMinusCap(capAngle) {
	var r = buildMesh(fibonacciSphere(3000, 5), { viewpoints: [[0, 0, 0]] }), o = r.origin;
	var V = r.mesh.enclosedVolume;
	r.soup = r.soup.filter(function (t) {
		var x = (t.v0.x + t.v1.x + t.v2.x) / 3 + o.x, y = (t.v0.y + t.v1.y + t.v2.y) / 3 + o.y, z = (t.v0.z + t.v1.z + t.v2.z) / 3 + o.z;
		return Math.acos(y / Math.hypot(x, y, z)) >= capAngle;
	});
	r.mesh = validateMesh(r, orientMesh(r, null).orientation);
	return { r: r, V: V };
}

describe("fairFill", function () {
	it("starts a loop of more than 400 edges from a fan, and still fills it as a flat disc", function () {
		var n = 600, P = new Float64Array(3 * n);
		for (var i = 0; i < n; i++) { var a = 2 * Math.PI * i / n; P[3 * i] = 10 * Math.cos(a); P[3 * i + 1] = 10 * Math.sin(a); }
		var f = fairFill(P, {});
		expect(f.reason).toBeUndefined();
		var m = f.points.length / 3;
		expect(m).toBeGreaterThan(1000);
		var zmax = 0;
		for (var k = 0; k < m; k++) zmax = Math.max(zmax, Math.abs(f.points[3 * k + 2]));
		expect(zmax).toBeLessThan(1e-6);
		// a disc: loop edges used once, the rest twice; Euler: T = n + 2m - 2
		var use = new Map();
		f.tris.forEach(function (t) {
			for (var e = 0; e < 3; e++) { var a = t[e], b = t[(e + 1) % 3], key = Math.min(a, b) + "," + Math.max(a, b); use.set(key, (use.get(key) || 0) + 1); }
		});
		var wrong = 0;
		use.forEach(function (c, key) {
			var ab = key.split(",").map(Number), loopEdge = ab[1] < n && (ab[1] - ab[0] === 1 || ab[1] - ab[0] === n - 1);
			if (c !== (loopEdge ? 1 : 2)) wrong++;
		});
		expect(wrong).toBe(0);
		expect(f.tris.length).toBe(n + 2 * m - 2);
	}, 30000);
});

describe("patchLoop method fair", function () {
	it("refills a spherical cap close to the full sphere's volume", function () {
		var s = sphereMinusCap(0.9), r = s.r;
		expect(r.mesh.boundaryLoops.length).toBe(1);
		var poolBefore = r.pool.size();
		var p = patchLoop(r, 0, { method: "fair" });
		expect(p.refused).toEqual([]);
		expect(p.method).toBe("fair");
		expect(r.pool.size()).toBeGreaterThan(poolBefore); // refined: new points
		expect(r.mesh.closed).toBe(true);
		expect(r.mesh.nonManifoldEdgeCount).toBe(0);
		expect(r.mesh.orientationConflicts).toBe(0);
		expect(windingConsistent(r.soup)).toBe(true);
		var fairErr = Math.abs(r.mesh.enclosedVolume - s.V) / s.V;
		expect(fairErr).toBeLessThan(0.02);

		// a flat centroid fan loses most of the cap (9 % of the volume)
		var flat = sphereMinusCap(0.9);
		patchLoop(flat.r, 0, { method: "centroid" });
		expect(Math.abs(flat.r.mesh.enclosedVolume - flat.V) / flat.V).toBeGreaterThan(5 * fairErr);
	});

	it("beats the centroid fan on a coarse hole rim (long loop edges)", function () {
		var V = buildMesh(fibonacciSphere(3000, 5), { viewpoints: [[0, 0, 0]] }).mesh.enclosedVolume;
		var fair = buildMesh(sphereWithCap(3000, 5, 0.9), { viewpoints: [[0, 0, 0]] });
		var flat = buildMesh(sphereWithCap(3000, 5, 0.9), { viewpoints: [[0, 0, 0]] });
		expect(patchLoop(fair, longestLoop(fair), { method: "fair" }).refused).toEqual([]);
		patchLoop(flat, longestLoop(flat), { method: "centroid" });
		expect(fair.mesh.closed).toBe(true);
		expect(Math.abs(fair.mesh.enclosedVolume - V)).toBeLessThan(0.8 * Math.abs(flat.mesh.enclosedVolume - V));
	});

	it("keeps a flat hole flat, with no patch edge longer than the loop's", function () {
		var r = buildMesh(gridWithHole(30, 0.1, 0.8), {});
		// the hole is the shorter of the two loops (the outer edge is the other)
		var loops = r.mesh.boundaryLoops, hole = loops[0].length < loops[1].length ? 0 : 1;
		var byId = r.pool.getAll(), lp = loops[hole], loopMax = 0;
		for (var i = 0; i < lp.length; i++) {
			var u = byId[lp[i]], w = byId[lp[(i + 1) % lp.length]];
			loopMax = Math.max(loopMax, Math.hypot(u.x - w.x, u.y - w.y, u.z - w.z));
		}
		var before = r.soup.length, poolBefore = r.pool.size();
		var p = patchLoop(r, hole, { method: "fair" });
		expect(p.refused).toEqual([]);
		expect(r.pool.size()).toBeGreaterThan(poolBefore);
		expect(r.mesh.boundaryLoops.length).toBe(1);
		expect(r.mesh.nonManifoldEdgeCount).toBe(0);
		for (var t = before; t < r.soup.length; t++) {
			var tri = r.soup[t], vs = [tri.v0, tri.v1, tri.v2];
			for (var e = 0; e < 3; e++) {
				var a = vs[e], b = vs[(e + 1) % 3];
				expect(Math.abs(a.z)).toBeLessThan(1e-6);
				expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThanOrEqual(loopMax + 1e-9);
			}
		}
	});
});
