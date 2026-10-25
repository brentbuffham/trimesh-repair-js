// Real cave: Wookey Hole (CaveSurveys, github.com/CaveSurveys/Wookey-Hole)
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { openLas } from "las-laz-js";
import { buildMesh } from "trimesh-build-js";
import { patchLoops, orientMesh } from "../src/index.js";

// the method of the component with the most triangles
function largestMethod(r) {
	var pc = r.report.orientation.perComponent, best = pc[0];
	pc.forEach(function (c) { if (c.triangles > best.triangles) best = c; });
	return best.method;
}

// triangle -> "a,b,c" with the smallest id first, winding kept
function rotKey(a, b, c) {
	if (a < b && a < c) return a + "," + b + "," + c;
	if (b < c) return b + "," + c + "," + a;
	return c + "," + a + "," + b;
}

function sample(name) {
	// the samples live in trimesh-build-js (examples/public/samples); without them these tests skip
	return fileURLToPath(new URL("../../trimesh-build-js/examples/public/samples/" + name, import.meta.url));
}
var SAMPLE = sample("wookey-hole.laz");
// a missing sample SKIPS (named in the output), never passes quietly
var HAVE_SAMPLES = existsSync(SAMPLE);
if (!HAVE_SAMPLES) console.warn("wookeyHole: samples not found at " + SAMPLE + " - real-cave tests skipped");

async function load(file) {
	var las = await openLas(file);
	try { return await las.readPoints({ fields: ["x", "y", "z"] }); } finally { await las.close(); }
}

describe.skipIf(!HAVE_SAMPLES)("Wookey Hole cave sample", function () {
	it("meshes as one main surface with no non-manifold edges (thin 5 cm)", async function () {
		var pts = await load(SAMPLE);
		expect(pts.count).toBe(381870);
		var r = buildMesh({ count: pts.count, x: pts.x, y: pts.y, z: pts.z }, { thin: 0.05 });
		expect(r.mesh.nonManifoldEdgeCount).toBe(0);
		expect(r.report.trianglesAccepted).toBeGreaterThan(200000);
		// twisted strips are cut (repairFolds): every edge runs both ways
		expect(r.mesh.orientationConflicts).toBe(0);
		expect(r.report.foldsRemoved).toBeGreaterThan(0);
		expect(r.report.foldsRemoved).toBeLessThan(0.01 * r.soup.length);
		var sizes = r.report.orientation.perComponent.map(function (c) { return c.triangles; });
		expect(Math.max.apply(null, sizes) / r.soup.length).toBeGreaterThan(0.95);
		// no viewpoints: the ray vote gives the cave its sign
		expect(largestMethod(r)).toBe("visibility");
		console.log("visibility ms", r.report.visibilityMs);
		// pinched holes are split: every loop is simple, so every one can be patched
		r.mesh.boundaryLoops.forEach(function (l) { expect(new Set(l).size).toBe(l.length); });
	}, 120000);

	it("auto patching closes nearly every loop, figure-8s included", async function () {
		var pts = await load(SAMPLE);
		var r = buildMesh({ count: pts.count, x: pts.x, y: pts.y, z: pts.z }, { thin: 0.05 });
		var before = r.mesh.boundaryLoops.length;
		var p = patchLoops(r);
		expect(p.patched).toBeGreaterThan(0.99 * before);
		expect(r.mesh.nonManifoldEdgeCount).toBe(0);
		expect(r.mesh.orientationConflicts).toBe(0);
		expect(p.methods.fair + p.methods.fan + p.methods.centroid + p.methods.vertexFan).toBe(p.patched);
		// Liepa fill takes nearly every loop
		expect(p.methods.fair).toBeGreaterThan(0.95 * p.patched);
	}, 120000);

	// Parts 2 and 3 of the same survey (mesh1.obj and mesh2.obj vertices)
	[["wookey-hole-2.laz", 638466], ["wookey-hole-3.laz", 194016]].forEach(function (part) {
		it(part[0] + " meshes clean and patches without new non-manifold or fold edges", async function () {
			var pts = await load(sample(part[0]));
			expect(pts.count).toBe(part[1]);
			var r = buildMesh({ count: pts.count, x: pts.x, y: pts.y, z: pts.z }, { thin: 0.05 });
			expect(r.mesh.nonManifoldEdgeCount).toBe(0);
			expect(r.mesh.orientationConflicts).toBe(0);
			var sizes = r.report.orientation.perComponent.map(function (c) { return c.triangles; });
			expect(Math.max.apply(null, sizes) / r.soup.length).toBeGreaterThan(0.9);
			expect(largestMethod(r)).toBe("visibility");
			var before = r.mesh.boundaryLoops.length;
			var p = patchLoops(r);
			expect(p.patched).toBeGreaterThan(0.98 * before);
			expect(r.mesh.nonManifoldEdgeCount).toBe(0);
			expect(r.mesh.orientationConflicts).toBe(0);
		}, 180000);
	});

	// Only the cave itself: an isolated sheet closes into a thin pancake
	// (6,813 triangles here, -0.27 m3), whose volume sign says nothing
	it("part 3: the vote's sign agrees with the closed cave's", async function () {
		var pts = await load(sample("wookey-hole-3.laz"));
		var r = buildMesh({ count: pts.count, x: pts.x, y: pts.y, z: pts.z }, { thin: 0.05 });
		var o = orientMesh(r, null), big = 0;
		o.perComponent.forEach(function (c, i) { if (c.triangles > o.perComponent[big].triangles) big = i; });
		var before = r.soup.filter(function (t, i) { return o.componentOf[i] === big; }).map(function (t) { return rotKey(t.v0.id, t.v1.id, t.v2.id); });
		patchLoops(r);
		expect(r.mesh.closed).toBe(true);
		var after = new Set(r.soup.map(function (t) { return rotKey(t.v0.id, t.v1.id, t.v2.id); }));
		var same = 0, reversed = 0;
		before.forEach(function (k) {
			var ids = k.split(",");
			if (after.has(k)) same++;
			else if (after.has(rotKey(+ids[0], +ids[2], +ids[1]))) reversed++;
		});
		console.log("part 3 winding kept", same, "reversed", reversed, "of", before.length);
		expect(same / (same + reversed)).toBeGreaterThan(0.99);
	}, 180000);
});
