import { describe, it, expect } from "vitest";
import { computeSignedVolume } from "trimesh-boolean";
import { meanEdgeLength, buildTriangleGrid, rayHits, orientByVisibility } from "../src/bms/visibility.js";
import { orientMesh } from "../src/bms/orientMesh.js";
import { meshToClean, triNormal } from "./fixtures/pipeline.js";
import { cylinderTunnel, halfPipe, planarGrid, fibonacciSphere, mulberry32 } from "./fixtures/synthetic.js";

function tri(z, s) {
	return { v0: { x: -s, y: -s, z: z }, v1: { x: s, y: -s, z: z }, v2: { x: 0, y: s, z: z } };
}

describe("triangle grid and rays", function () {
	var soup = [tri(5, 1), tri(-5, 1)];

	it("a ray hits a triangle in front of it and misses one behind", function () {
		var g = buildTriangleGrid(soup, 2 * meanEdgeLength(soup));
		expect(rayHits(g, soup, 0.1, 0.1, 0, 0, 0, 1, 0, -1)).toBe(true);
		expect(rayHits(g, soup, 0.1, 0.1, 0, 1, 0, 0, 0, -1)).toBe(false);
	});

	it("ignores hits closer than tMin and the skip triangle", function () {
		var g = buildTriangleGrid(soup, 2 * meanEdgeLength(soup));
		expect(rayHits(g, soup, 0.1, 0.1, 4.9, 0, 0, 1, 0.5, -1)).toBe(false);
		expect(rayHits(g, soup, 0.1, 0.1, 4.9, 0, 0, 1, 0, 0)).toBe(false);
		expect(rayHits(g, soup, 0.1, 0.1, 4.9, 0, 0, 1, 0, -1)).toBe(true);
	});

	it("walks many cells", function () {
		var g = buildTriangleGrid(soup, 0.1);
		expect(rayHits(g, soup, 0.1, 0.1, -4.95, 0, 0, 1, 0.5, -1)).toBe(true);
	});

	it("stops a ray at tMax", function () {
		var g = buildTriangleGrid(soup, 2 * meanEdgeLength(soup));
		expect(rayHits(g, soup, 0.1, 0.1, 0, 0, 0, 1, 0, -1, 4)).toBe(false);
		expect(rayHits(g, soup, 0.1, 0.1, 0, 0, 0, 1, 0, -1, 6)).toBe(true);
	});

	it("keeps its cell size however far apart the triangles are", function () {
		var big = [tri(0, 0.5), tri(3000, 0.5)];
		var g = buildTriangleGrid(big, 0.01);
		expect(g.cell).toBe(0.01);
		expect(rayHits(g, big, 0.1, 0.1, 1, 0, 0, 1, 0, -1, 5000)).toBe(true);
	});
});

function scramble(soup, seed) {
	var rnd = mulberry32(seed);
	soup.forEach(function (t) { if (rnd() < 0.5) { var x = t.v1; t.v1 = t.v2; t.v2 = x; } });
}

// Area fraction whose normal faces the X axis (y = z = 0, world)
function facingAxis(soup, o) {
	var good = 0, all = 0;
	soup.forEach(function (t) {
		var n = triNormal(t), a = Math.hypot(n[0], n[1], n[2]);
		var cy = (t.v0.y + t.v1.y + t.v2.y) / 3 + o.y, cz = (t.v0.z + t.v1.z + t.v2.z) / 3 + o.z;
		all += a;
		if (n[1] * -cy + n[2] * -cz > 0) good += a;
	});
	return good / all;
}

function voted(cols, seed) {
	var m = meshToClean(cols);
	scramble(m.bms.soup, seed);
	var r = orientMesh(m.bms);
	return { m: m, r: orientByVisibility(m.bms, r, {}) };
}

function withoutBand(cols, half) {
	var p = cols.positions, out = [];
	for (var i = 0; i < cols.count; i++) if (Math.abs(p[3 * i + 2]) >= half) out.push(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
	return { count: out.length / 3, positions: Float64Array.from(out) };
}

function windingKeys(soup, n) {
	return soup.slice(0, n).map(function (t) { return t.v0.id + "," + t.v1.id + "," + t.v2.id; });
}

describe("orientByVisibility", function () {
	it("open tube: normals face the axis", function () {
		var v = voted(cylinderTunnel(2.5, 20, 0.25, 1), 3);
		expect(v.r.orientation).toBe("visibility");
		expect(v.r.perComponent[0].margin).toBeGreaterThan(0.5);
		expect(facingAxis(v.m.bms.soup, v.m.cloud.origin)).toBeGreaterThan(0.95);
	});

	it("half-pipe: normals face the concave side", function () {
		var v = voted(halfPipe(2.5, 20, 0.25, 2), 5);
		expect(v.r.orientation).toBe("visibility");
		expect(v.r.perComponent[0].margin).toBeGreaterThan(0.5);
		expect(facingAxis(v.m.bms.soup, v.m.cloud.origin)).toBeGreaterThan(0.95);
	});

	it("flat grid stays unresolved", function () {
		var v = voted(planarGrid(40, 40, 0.25), 7);
		expect(v.r.orientation).toBe("unresolved");
	});

	it("two halves of a tube vote across the gap", function () {
		var v = voted(withoutBand(cylinderTunnel(2.5, 20, 0.25, 1), 0.6), 11);
		expect(v.r.perComponent.length).toBeGreaterThanOrEqual(2);
		v.r.perComponent.forEach(function (c) { if (c.triangles > 100) expect(c.method).toBe("visibility"); });
		expect(facingAxis(v.m.bms.soup, v.m.cloud.origin)).toBeGreaterThan(0.95);
	});

	it("same mesh, same answer", function () {
		var a = voted(cylinderTunnel(2.5, 20, 0.25, 1), 3), b = voted(cylinderTunnel(2.5, 20, 0.25, 1), 3);
		expect(a.r.perComponent.map(function (c) { return c.margin; })).toEqual(b.r.perComponent.map(function (c) { return c.margin; }));
		expect(windingKeys(a.m.bms.soup, 50)).toEqual(windingKeys(b.m.bms.soup, 50));
	});

	it("closed components are untouched", function () {
		var m = meshToClean(fibonacciSphere(3000, 5));
		var r = orientMesh(m.bms);
		var vol = computeSignedVolume(m.bms.soup), keys = windingKeys(m.bms.soup, 50);
		r = orientByVisibility(m.bms, r, {});
		expect(r.orientation).toBe("closed");
		expect(computeSignedVolume(m.bms.soup)).toBe(vol);
		expect(windingKeys(m.bms.soup, 50)).toEqual(keys);
	});

	it("zero-area triangles do not give NaN", function () {
		var m = meshToClean(cylinderTunnel(2.5, 20, 0.25, 1));
		var id = m.bms.pool.size() + 10;
		m.bms.soup.push({ v0: { x: 0, y: 0, z: 0, id: id }, v1: { x: 1, y: 0, z: 0, id: id + 1 }, v2: { x: 2, y: 0, z: 0, id: id + 2 } });
		var r = orientByVisibility(m.bms, orientMesh(m.bms), {});
		r.perComponent.forEach(function (c) { if (c.margin !== undefined) expect(Number.isFinite(c.margin)).toBe(true); });
		expect(r.perComponent[0].method).toBe("visibility");
	});

	// A ring tube of N x rings quads, no pool (ids unique), one component
	function ringTube(L) {
		var N = 64, step = 0.25, rings = Math.round(L / step), V = [], soup = [];
		for (var i = 0; i <= rings; i++) for (var j = 0; j < N; j++) {
			var a = 2 * Math.PI * j / N;
			V.push({ x: i * step, y: 2.5 * Math.cos(a), z: 2.5 * Math.sin(a), id: i * N + j });
		}
		for (var p = 0; p < rings; p++) for (var q = 0; q < N; q++) {
			var A = V[p * N + q], B = V[p * N + (q + 1) % N], C = V[(p + 1) * N + q], D = V[(p + 1) * N + (q + 1) % N];
			soup.push({ v0: A, v1: B, v2: D }, { v0: A, v1: D, v2: C });
		}
		return soup;
	}

	it("a stray triangle 3 km away does not slow the vote or change it", function () {
		var soup = ringTube(200), n = soup.length;
		soup.push({ v0: { x: 3000, y: 3000, z: 3000, id: 1e6 }, v1: { x: 3000.2, y: 3000, z: 3000, id: 1e6 + 1 }, v2: { x: 3000, y: 3000.2, z: 3000, id: 1e6 + 2 } });
		var comp = new Int32Array(n + 1); comp[n] = 1;
		var o = { perComponent: [{ triangles: n, method: "unresolved" }, { triangles: 1, method: "unresolved" }], orientation: "unresolved", componentOf: comp };
		var t0 = performance.now();
		orientByVisibility({ soup: soup }, o, {});
		var ms = performance.now() - t0;
		expect(o.perComponent[0].method).toBe("visibility");
		expect(o.perComponent[1].method).toBe("unresolved");
		expect(ms).toBeLessThan(1500);
	}, 60000);

	it("finds the opposite wall in another component (square tunnel of 4 separate walls)", function () {
		// walls y = 0, y = 4, z = 0, z = 4, each its own grid of 0.25 m squares along x 0..20
		var soup = [], comp = [], id = 0, s = 0.25, nx = 80, nw = 16;
		function wall(w, at) {
			var V = [];
			for (var i = 0; i <= nx; i++) for (var j = 0; j <= nw; j++) {
				var u = j * s, p = w < 2 ? { x: i * s, y: at, z: u } : { x: i * s, y: u, z: at };
				p.id = id++; V.push(p);
			}
			for (var a = 0; a < nx; a++) for (var b = 0; b < nw; b++) {
				var A = V[a * (nw + 1) + b], B = V[a * (nw + 1) + b + 1], C = V[(a + 1) * (nw + 1) + b], D = V[(a + 1) * (nw + 1) + b + 1];
				// walls 1 and 3 wound the other way
				if (w % 2) soup.push({ v0: A, v1: D, v2: B }, { v0: A, v1: C, v2: D });
				else soup.push({ v0: A, v1: B, v2: D }, { v0: A, v1: D, v2: C });
				comp.push(w, w);
			}
		}
		wall(0, 0); wall(1, 4); wall(2, 0); wall(3, 4);
		var o = { perComponent: [0, 1, 2, 3].map(function (w) { return { triangles: 2 * nx * nw, method: "unresolved" }; }), orientation: "unresolved", componentOf: Int32Array.from(comp) };
		orientByVisibility({ soup: soup }, o, {});
		expect(o.orientation).toBe("visibility");
		var inward = 0;
		soup.forEach(function (t) {
			var n = triNormal(t), c = [(t.v0.y + t.v1.y + t.v2.y) / 3, (t.v0.z + t.v1.z + t.v2.z) / 3];
			if (n[1] * (2 - c[0]) + n[2] * (2 - c[1]) > 0) inward++;
		});
		expect(inward / soup.length).toBeGreaterThan(0.99);
	});
});
