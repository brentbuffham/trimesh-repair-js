import { describe, it, expect } from "vitest";
import { ingestToBMS } from "../src/bms/ingestToBMS.js";
import { cleanSoup } from "../src/bms/cleanSoup.js";
import { buildEdgeMap } from "../src/bms/edges.js";

// Unit right tetrahedron, outward winding
var TET = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
var TET_T = Uint32Array.from([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);

function noConstraints() {
	return { firstId: 1e9, count: 0, segments: new Uint32Array(0), edgeKeys: new Set() };
}

describe("ingestToBMS", function () {
	it("soup entries have BMS shape", function () {
		var bms = ingestToBMS(TET, TET_T, 1e-6);
		expect(bms.soup.length).toBe(4);
		bms.soup.forEach(function (t, i) {
			expect(t.mesh).toBe("A");
			expect(t.origIdx).toBe(i);
			["v0", "v1", "v2"].forEach(function (k) {
				expect(typeof t[k].id).toBe("number");
				expect(typeof t[k].x).toBe("number");
			});
		});
		expect(bms.pool.size()).toBe(4);
	});

	it("shared vertex identity", function () {
		var bms = ingestToBMS(TET, TET_T, 1e-6);
		expect(bms.soup[0].v0).toBe(bms.soup[1].v0);
		expect(bms.idToPool[0]).toBe(bms.soup[0].v0);
	});

	it("pool welds within tolerance", function () {
		var c = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1.0001, 0, 0, 1, 1, 0]);
		var bms = ingestToBMS(c, Uint32Array.from([0, 1, 2, 3, 4, 2]), 0.001);
		expect(bms.idToPool[1]).toBe(bms.idToPool[3]);
		var r = cleanSoup(bms, noConstraints());
		expect(r.merged).toBe(1);
	});
});

describe("cleanSoup", function () {
	it("collapsed triangle removed", function () {
		var c = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0.0001, 0, 0]);
		var bms = ingestToBMS(c, Uint32Array.from([0, 1, 2, 0, 3, 2]), 0.001);
		var r = cleanSoup(bms, noConstraints());
		expect(r.degenerate).toBe(1);
		expect(bms.soup.length).toBe(1);
		expect(bms.soup[0].origIdx).toBe(0);
	});

	it("duplicate triangle removed", function () {
		var bms = ingestToBMS(TET, Uint32Array.from([0, 1, 2, 2, 0, 1]), 1e-6);
		var r = cleanSoup(bms, noConstraints());
		expect(r.duplicates).toBe(1);
		expect(bms.soup.length).toBe(1);
	});

	it("edge counts", function () {
		var bms = ingestToBMS(TET, TET_T, 1e-6);
		var r = cleanSoup(bms, noConstraints());
		expect(r.boundaryEdges).toBe(0);
		expect(r.nonManifoldEdges).toBe(0);
		var fan = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1]);
		var b2 = ingestToBMS(fan, Uint32Array.from([0, 1, 2, 0, 1, 3, 0, 1, 4]), 1e-6);
		var r2 = cleanSoup(b2, noConstraints());
		expect(r2.nonManifoldEdges).toBe(1);
		expect(buildEdgeMap(b2.soup).size).toBe(7);
	});

	it("collapsed constraint reported", function () {
		// constraint 3-4 is shorter than the weld tolerance
		var c = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 1.0001, 1, 0]);
		var bms = ingestToBMS(c, Uint32Array.from([0, 1, 3, 0, 4, 2]), 0.001);
		var cons = { firstId: 3, count: 2, segments: Uint32Array.from([3, 4]), edgeKeys: new Set(["3|4"]) };
		var r = cleanSoup(bms, cons);
		expect(r.collapsedConstraints).toBe(1);
		expect(bms.constraintPoolEdges.size).toBe(0);
	});
});
