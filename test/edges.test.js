// EdgeTable: typed-array hash table over vertex id pairs, same answers as the key API.
import { describe, it, expect } from "vitest";
import { EdgeTable, edgesOf, poolEdgeKey } from "../src/bms/edges.js";
import { orientMesh } from "../src/index.js";

function tri(a, b, c) { return { v0: { id: a }, v1: { id: b }, v2: { id: c } }; }

describe("EdgeTable", function () {
	it("an edge reads the same in either direction, by key or by ids", function () {
		var t = new EdgeTable(4);
		t.addEdge(7, 3, 0);
		t.add(poolEdgeKey(3, 7), 1);
		expect(t.count(poolEdgeKey(7, 3))).toBe(2);
		expect(t.slot(3, 7)).toBe(t.slot(7, 3));
		expect(t.tri(poolEdgeKey(3, 7), 0)).toBe(0);
		expect(t.tri(poolEdgeKey(3, 7), 1)).toBe(1);
		expect(t.tri(poolEdgeKey(3, 7), 2)).toBe(-1);
		expect(t.has(poolEdgeKey(3, 8))).toBe(false);
		expect(t.count(poolEdgeKey(3, 8))).toBe(0);
	});

	it("keeps a third face of a non-manifold edge", function () {
		var t = new EdgeTable(4);
		[10, 11, 12, 13].forEach(function (f) { t.addEdge(1, 2, f); });
		expect(t.count(poolEdgeKey(1, 2))).toBe(4);
		expect([0, 1, 2, 3].map(function (i) { return t.tri(poolEdgeKey(1, 2), i); })).toEqual([10, 11, 12, 13]);
	});

	it("grows past its first capacity without losing an edge", function () {
		var t = new EdgeTable(2), n = 5000;
		for (var i = 0; i < n; i++) t.addEdge(i, i + 1, i);
		for (var i = 0; i < n; i++) t.addEdge(i + 1, i, n + i);
		expect(t.size).toBe(n);
		for (var i = 0; i < n; i += 97) {
			expect(t.count(poolEdgeKey(i, i + 1))).toBe(2);
			expect(t.tri(poolEdgeKey(i + 1, i), 1)).toBe(n + i);
		}
	});

	it("visits edges in insertion order with their keys", function () {
		var t = new EdgeTable(4), seen = [];
		t.addEdge(5, 2, 0); t.addEdge(1, 9, 1);
		t.forEach(function (count, key, t0) { seen.push([count, key, t0]); });
		expect(seen).toEqual([[1, poolEdgeKey(2, 5), 0], [1, poolEdgeKey(1, 9), 1]]);
	});
});

describe("edgesOf", function () {
	it("rebuilds a cached table that is not this library's own", function () {
		var bms = { soup: [tri(0, 1, 2), tri(0, 2, 3)] };
		// what an older copy of the library left on a result
		Object.defineProperty(bms, "_edges", { value: { soup: bms.soup, length: 2, map: { count: function () { return 0; } } }, writable: true, configurable: true });
		var table = edgesOf(bms);
		expect(table instanceof EdgeTable).toBe(true);
		expect(table.count(poolEdgeKey(0, 2))).toBe(2);
		// and orientMesh works on it
		expect(function () { orientMesh(bms, null); }).not.toThrow();
	});

	it("reuses its own table while the soup is unchanged", function () {
		var bms = { soup: [tri(0, 1, 2)] };
		expect(edgesOf(bms)).toBe(edgesOf(bms));
	});
});

describe("orientMesh on a flipped triangle", function () {
	// two triangles sharing edge 1-2, the second wound against the first
	it("turns the second to agree and keeps the table valid", function () {
		var bms = { soup: [tri(0, 1, 2), tri(1, 2, 3)] };
		var r = orientMesh(bms, null);
		expect(r.perComponent.length).toBe(1);
		// consistent: the shared edge runs 1->2 in one and 2->1 in the other
		var runs12 = bms.soup.filter(function (t) { return (t.v0.id === 1 && t.v1.id === 2) || (t.v1.id === 1 && t.v2.id === 2) || (t.v2.id === 1 && t.v0.id === 2); }).length;
		expect(runs12).toBe(1);
	});
});
