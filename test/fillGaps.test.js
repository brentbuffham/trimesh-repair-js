import { describe, it, expect } from "vitest";
import { fillGaps } from "../src/post/fillGaps.js";
import { validateMesh } from "../src/validate/validateMesh.js";
import { orientMesh } from "../src/bms/orientMesh.js";
import { ingestToBMS } from "../src/bms/ingestToBMS.js";
import { cleanSoup } from "../src/bms/cleanSoup.js";
import { windingConsistent } from "./fixtures/pipeline.js";

// 4 x 4 vertex grid with the centre quad missing: outer loop 12, inner gap 4
function holedGrid(constrained) {
	var c = [], t = [];
	for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) c.push(i, j, 0);
	for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) {
		if (a === 1 && b === 1) continue;
		var v = a * 4 + b;
		t.push(v, v + 4, v + 5, v, v + 5, v + 1);
	}
	var bms = ingestToBMS(Float64Array.from(c), Uint32Array.from(t), 1e-6);
	cleanSoup(bms, { segments: Uint32Array.from(constrained || []) });
	orientMesh(bms);
	return bms;
}

describe("fillGaps", function () {
	it("fills a 4-edge gap without Steiner points", function () {
		var bms = holedGrid();
		var poolBefore = bms.pool.size();
		var r = fillGaps(bms, validateMesh(bms, "unresolved"), 6);
		expect(r.filled).toBe(1);
		expect(r.triangles).toBe(2);
		expect(bms.pool.size()).toBe(poolBefore);
		orientMesh(bms);
		var after = validateMesh(bms, "unresolved");
		expect(after.boundaryLoops.length).toBe(1);
		expect(after.boundaryLoops[0].length).toBe(12);
		expect(windingConsistent(bms.soup)).toBe(true);
	});

	it("leaves loops over maxGapEdges alone", function () {
		var bms = holedGrid();
		var r = fillGaps(bms, validateMesh(bms, "unresolved"), 3);
		expect(r.filled).toBe(0);
	});

	it("never fills a gap bounded by a break line", function () {
		var bms = holedGrid([5, 6]); // edge on the inner gap
		var r = fillGaps(bms, validateMesh(bms, "unresolved"), 6);
		expect(r.filled).toBe(0);
	});
});
