import { describe, it, expect } from "vitest";
import { repairFolds } from "../src/post/repairFolds.js";
import { orientMesh } from "../src/bms/orientMesh.js";
import { validateMesh } from "../src/validate/validateMesh.js";
import { poolEdgeKey } from "../src/bms/edges.js";
import { meshToClean, windingConsistent, mobiusBand, conflictEdges } from "./fixtures/pipeline.js";
import { fibonacciSphere } from "./fixtures/synthetic.js";

describe("repairFolds", function () {
	it("cuts a twisted band at its twist, leaving it orientable", function () {
		var bms = mobiusBand(24);
		orientMesh(bms);
		var before = bms.soup.length;
		var r = repairFolds(bms);
		expect(r.removed).toBeGreaterThan(0);
		expect(bms.soup.length).toBe(before - r.removed);
		expect(conflictEdges(bms.soup).length).toBe(0);
		expect(windingConsistent(bms.soup)).toBe(true);
		expect(validateMesh(bms, r.orientation.orientation).orientationConflicts).toBe(0);
		// only twist triangles go: every survivor off rungs 0..3 is still there
		var flat = bms.soup.filter(function (t) { return t.v0.rung > 4 && t.v1.rung > 4 && t.v2.rung > 4; });
		expect(flat.length).toBe(2 * 18); // segments 5..22
	});

	it("leaves an orientable mesh alone", function () {
		var m = meshToClean(fibonacciSphere(2000, 5));
		orientMesh(m.bms);
		var n = m.bms.soup.length;
		var r = repairFolds(m.bms);
		expect(r.removed).toBe(0);
		expect(r.passes).toBe(0);
		expect(m.bms.soup.length).toBe(n);
	});

	it("never removes a triangle on a break line edge", function () {
		var bms = mobiusBand(24);
		orientMesh(bms);
		var seam = conflictEdges(bms.soup);
		var key = poolEdgeKey(seam[0][0].id, seam[0][1].id);
		bms.constraintPoolEdges = new Set([key]);
		var r = repairFolds(bms);
		var still = bms.soup.some(function (t) {
			var vs = [t.v0.id, t.v1.id, t.v2.id];
			for (var e = 0; e < 3; e++) if (poolEdgeKey(vs[e], vs[(e + 1) % 3]) === key) return true;
			return false;
		});
		expect(still).toBe(true);
		expect(r.kept).toBeGreaterThan(0);
	});
});
