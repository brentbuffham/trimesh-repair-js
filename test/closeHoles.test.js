import { describe, it, expect } from "vitest";
import { closeHoles } from "../src/post/closeHoles.js";
import { validateMesh } from "../src/validate/validateMesh.js";
import { orientMesh } from "../src/bms/orientMesh.js";
import { ingestToBMS } from "../src/bms/ingestToBMS.js";
import { cleanSoup } from "../src/bms/cleanSoup.js";
import { meshToClean, windingConsistent } from "./fixtures/pipeline.js";
import { sphereWithCap } from "./fixtures/synthetic.js";

function cappedSphere() {
	var m = meshToClean(sphereWithCap(3000, 5, 0.4));
	var o = m.cloud.origin;
	var r = orientMesh(m.bms, [[-o.x, -o.y, -o.z]]);
	return { m: m, mesh: validateMesh(m.bms, r.orientation) };
}

describe("closeHoles", function () {
	it("capped sphere closes", function () {
		var s = cappedSphere();
		expect(s.mesh.closed).toBe(false);
		expect(s.mesh.boundaryLoops.length).toBe(1);
		var r = closeHoles(s.m.bms, s.mesh, {});
		expect(r.unfilledLoops).toEqual([]);
		expect(r.added).toBe(s.mesh.boundaryLoops[0].length);
		var after = validateMesh(s.m.bms, s.mesh.orientation);
		expect(after.closed).toBe(true);
		expect(after.enclosedVolume).toBeGreaterThan(0);
		expect(windingConsistent(s.m.bms.soup)).toBe(true);
	});

	it("loop over maxLoopEdges is unfilled", function () {
		var s = cappedSphere();
		var before = s.m.bms.soup.length;
		var r = closeHoles(s.m.bms, s.mesh, { maxLoopEdges: 3 });
		expect(r.added).toBe(0);
		expect(r.unfilledLoops.length).toBe(1);
		expect(s.m.bms.soup.length).toBe(before);
	});

	it("loop on a constrained edge is unfilled", function () {
		// open square; edge 0-1 is a break line
		var b = ingestToBMS(Float64Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), Uint32Array.from([0, 1, 2, 0, 2, 3]), 1e-6);
		cleanSoup(b, { segments: Uint32Array.from([0, 1]) });
		var mesh = validateMesh(b, "unresolved");
		var r = closeHoles(b, mesh, {});
		expect(r.added).toBe(0);
		expect(r.unfilledLoops.length).toBe(1);
	});
});
