import { describe, it, expect } from "vitest";
import { validateMesh, pointInside } from "../src/validate/validateMesh.js";
import { ingestToBMS } from "../src/bms/ingestToBMS.js";
import { cleanSoup } from "../src/bms/cleanSoup.js";

var NONE = { segments: new Uint32Array(0) };

function bmsOf(coords, tris, constraints) {
	var b = ingestToBMS(Float64Array.from(coords), Uint32Array.from(tris), 1e-6);
	cleanSoup(b, constraints || NONE);
	return b;
}

var TET = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
var TET_T = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];

// 4 x 4 vertex grid (ids i*4+j), all 9 quads, each as 2 triangles; skip listed quads
function grid(skip) {
	var c = [], t = [];
	for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) c.push(i, j, 0);
	for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) {
		if (skip.indexOf(a * 3 + b) >= 0) continue;
		var v = a * 4 + b;
		t.push(v, v + 4, v + 5, v, v + 5, v + 1);
	}
	return { c: c, t: t };
}

describe("validateMesh", function () {
	it("tetrahedron closed with volume", function () {
		var m = validateMesh(bmsOf(TET, TET_T), "closed");
		expect(m.closed).toBe(true);
		expect(m.boundaryLoops.length).toBe(0);
		expect(m.nonManifoldEdgeCount).toBe(0);
		expect(Math.abs(m.enclosedVolume - 1 / 6)).toBeLessThan(1e-12);
		expect(m.orientation).toBe("closed");
	});

	it("open square has one loop of 4", function () {
		var m = validateMesh(bmsOf([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3]), "unresolved");
		expect(m.closed).toBe(false);
		expect(m.enclosedVolume).toBeNull();
		expect(m.boundaryLoops.length).toBe(1);
		expect(m.boundaryLoops[0].length).toBe(4);
		expect(m.boundaryEdgeCount).toBe(4);
	});

	it("two holes give two loops", function () {
		var g = grid([4]);
		var m = validateMesh(bmsOf(g.c, g.t), "unresolved");
		var sizes = m.boundaryLoops.map(function (l) { return l.length; }).sort(function (a, b) { return a - b; });
		expect(sizes).toEqual([4, 12]);
	});

	it("non-manifold edge makes it not closed", function () {
		var c = TET.concat([1, 1, 1]);
		var m = validateMesh(bmsOf(c, TET_T.concat([1, 2, 4])), "closed");
		expect(m.nonManifoldEdgeCount).toBe(1);
		expect(m.closed).toBe(false);
		expect(m.enclosedVolume).toBeNull();
	});

	it("constrained edge used once is excluded from boundaryEdgeCount but closed is false", function () {
		// open square; vertices 0-1 are a break line segment
		var cons = { segments: Uint32Array.from([0, 1]) };
		var m = validateMesh(bmsOf([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3], cons), "unresolved");
		expect(m.boundaryEdgeCount).toBe(3);
		expect(m.closed).toBe(false);
		expect(m.constrainedEdges.length).toBe(1);
	});
});

describe("validateMesh with bad winding", function () {
	it("inconsistent winding still traces one loop and counts the conflict", function () {
		// open square, second triangle wound the wrong way
		var m = validateMesh(bmsOf([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 3, 2]), "unresolved");
		expect(m.boundaryLoops.length).toBe(1);
		expect(m.boundaryLoops[0].length).toBe(4);
		expect(m.orientationConflicts).toBe(1);
	});

	it("bow-tie vertex gives two loops of 3", function () {
		var m = validateMesh(bmsOf([0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0], [0, 1, 2, 0, 3, 4]), "unresolved");
		var sizes = m.boundaryLoops.map(function (l) { return l.length; }).sort();
		expect(sizes).toEqual([3, 3]);
		expect(m.orientationConflicts).toBe(0);
	});
});

describe("validateMesh loops are always simple", function () {
	it("two holes touching at one corner give two simple loops", function () {
		// 4 x 4 vertex grid, quads (0,0) and (1,1) removed: the holes share vertex (1,1)
		var g = grid([0, 4]);
		var m = validateMesh(bmsOf(g.c, g.t), "unresolved");
		var total = 0;
		m.boundaryLoops.forEach(function (l) {
			expect(new Set(l).size).toBe(l.length);
			total += l.length;
		});
		expect(total).toBe(m.boundaryEdgeCount);
	});
});

describe("pointInside", function () {
	it("centroid inside, far point outside", function () {
		var b = bmsOf(TET, TET_T);
		expect(pointInside(b, [0.2, 0.2, 0.2])).toBe(true);
		expect(pointInside(b, [5, 5, 5])).toBe(false);
	});
});
