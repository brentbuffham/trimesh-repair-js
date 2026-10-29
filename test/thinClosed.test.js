// A closed component can be a sheet sealed along its rim: a pancake whose volume is a rounding-sized
// number with a sign. orientMesh calls such a component "unresolved" so the visibility vote decides
// its side; real closed solids keep the volume rule.
import { describe, it, expect } from "vitest";
import { orientMesh } from "../src/index.js";

// A closed box of nx x ny x nz cells (x and y spaced 1, z spaced dz): all six faces gridded, vertices
// shared, so every edge has two faces. Triangles are wound the same way on every face, not made
// consistent, so orientMesh has work to do.
function box(nx, ny, nz, dz) {
	var ids = new Map(), n = 0, soup = [];
	function v(i, j, k) {
		var key = i + "," + j + "," + k;
		if (!ids.has(key)) ids.set(key, { x: i, y: j, z: k * dz, id: n++ });
		return ids.get(key);
	}
	function quad(a, b, c, d) { soup.push({ v0: a, v1: b, v2: c }, { v0: a, v1: c, v2: d }); }
	var i, j, k;
	for (i = 0; i < nx; i++) for (j = 0; j < ny; j++) { quad(v(i, j, 0), v(i + 1, j, 0), v(i + 1, j + 1, 0), v(i, j + 1, 0)); quad(v(i, j, nz), v(i + 1, j, nz), v(i + 1, j + 1, nz), v(i, j + 1, nz)); }
	for (i = 0; i < nx; i++) for (k = 0; k < nz; k++) { quad(v(i, 0, k), v(i + 1, 0, k), v(i + 1, 0, k + 1), v(i, 0, k + 1)); quad(v(i, ny, k), v(i + 1, ny, k), v(i + 1, ny, k + 1), v(i, ny, k + 1)); }
	for (j = 0; j < ny; j++) for (k = 0; k < nz; k++) { quad(v(0, j, k), v(0, j + 1, k), v(0, j + 1, k + 1), v(0, j, k + 1)); quad(v(nx, j, k), v(nx, j + 1, k), v(nx, j + 1, k + 1), v(nx, j, k + 1)); }
	return { soup: soup };
}

function methods(bms, opts) { return orientMesh(bms, null, opts).perComponent.map(function (c) { return c.method; }); }

describe("orientMesh: thin closed sheets", function () {
	it("a closed pancake (10 x 10 cells, 0.01 thick, 480 triangles) is left to the vote", function () {
		var b = box(10, 10, 1, 0.01);
		expect(b.soup.length).toBe(480);
		expect(methods(b)).toEqual(["unresolved"]);
	});

	it("a closed box as thick as it is wide (1,200 triangles) keeps the volume rule", function () {
		expect(methods(box(10, 10, 10, 1))).toEqual(["closed"]);
	});

	it("a small solid is not mistaken for a sheet: a cube of 12 triangles", function () {
		expect(methods(box(1, 1, 1, 1))).toEqual(["closed"]);
	});

	it("the size floor is 100 triangles: a flat box of 32 keeps the volume rule, one of 140 does not", function () {
		expect(box(2, 2, 1, 0.01).soup.length).toBe(32);
		expect(box(5, 5, 1, 0.01).soup.length).toBe(140);
		expect(methods(box(2, 2, 1, 0.01))).toEqual(["closed"]);
		expect(methods(box(5, 5, 1, 0.01))).toEqual(["unresolved"]);
	});

	it("thinRatio 0 turns the rule off, and the knobs are used as given", function () {
		expect(methods(box(10, 10, 1, 0.01), { thinRatio: 0 })).toEqual(["closed"]);
		expect(methods(box(2, 2, 1, 0.01), { minThinTriangles: 0 })).toEqual(["unresolved"]);
		expect(methods(box(10, 10, 1, 0.01), { minThinTriangles: 1000 })).toEqual(["closed"]);
	});

	it("a thin closed sheet keeps whatever winding it had (the vote's), a solid is set by volume", function () {
		var thin = box(10, 10, 1, 0.01), before = thin.soup.map(function (t) { return t.v1.id + "," + t.v2.id; });
		orientMesh(thin, null);
		var after = thin.soup.map(function (t) { return t.v1.id + "," + t.v2.id; });
		// the walk makes it consistent from triangle 0 and never re-decides the sign: triangle 0 is as it was
		expect(after[0]).toBe(before[0]);
		var solid = box(10, 10, 10, 1);
		orientMesh(solid, null);
		// void inside: normals point inward, so the signed volume is not positive
		var vol = 0;
		solid.soup.forEach(function (t) {
			var a = t.v0, b = t.v1, c = t.v2;
			vol += (a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)) / 6;
		});
		expect(vol).toBeLessThan(0);
	});
});
