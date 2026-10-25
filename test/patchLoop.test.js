import { describe, it, expect } from "vitest";
import { buildMesh } from "trimesh-build-js";
import { patchLoop, patchLoops } from "../src/index.js";
import { windingConsistent } from "./fixtures/pipeline.js";
import { sphereWithCap, cylinderTunnel, planarGrid } from "./fixtures/synthetic.js";

function cappedSphere() {
	return buildMesh(sphereWithCap(3000, 5, 0.4), { viewpoints: [[0, 0, 0]] });
}

describe("patchLoop", function () {
	it("auto is the default and reports the method it used", function () {
		var r = cappedSphere();
		var p = patchLoop(r, 0);
		expect(p.method).toBe("fair");
		expect(r.mesh.closed).toBe(true);
	});

	it("vertex fan closes a loop on its own vertices", function () {
		var r = cappedSphere();
		var poolBefore = r.pool.size();
		var p = patchLoop(r, 0, { method: "vertexFan" });
		expect(p.refused).toEqual([]);
		expect(p.method).toBe("vertexFan");
		expect(r.pool.size()).toBe(poolBefore);
		expect(r.mesh.closed).toBe(true);
		expect(windingConsistent(r.soup)).toBe(true);
	});

	it("fan patch (Kirra Fill) closes the capped sphere with no new points", function () {
		var r = cappedSphere();
		expect(r.mesh.boundaryLoops.length).toBe(1);
		var poolBefore = r.pool.size();
		var loopLen = r.mesh.boundaryLoops[0].length;
		var p = patchLoop(r, 0, { method: "fan" });
		expect(p.refused).toEqual([]);
		expect(p.added).toBe(loopLen - 2);
		expect(r.pool.size()).toBe(poolBefore);
		expect(r.mesh.closed).toBe(true);
		expect(r.mesh.enclosedVolume).toBeGreaterThan(0);
		expect(windingConsistent(r.soup)).toBe(true);
	});

	it("centroid patch adds one point and closes", function () {
		var r = cappedSphere();
		var poolBefore = r.pool.size();
		var loopLen = r.mesh.boundaryLoops[0].length;
		var p = patchLoop(r, 0, { method: "centroid" });
		expect(p.added).toBe(loopLen);
		expect(r.pool.size()).toBe(poolBefore + 1);
		expect(r.mesh.closed).toBe(true);
		expect(windingConsistent(r.soup)).toBe(true);
	});

	it("accepts the loop as world points (a loop picked in Kirra)", function () {
		var r = cappedSphere();
		var byId = r.pool.getAll(), o = r.origin;
		var world = r.mesh.boundaryLoops[0].map(function (id) { var v = byId[id]; return [v.x + o.x, v.y + o.y, v.z + o.z]; });
		var p = patchLoop(r, world);
		expect(p.refused).toEqual([]);
		expect(r.mesh.closed).toBe(true);
	});

	it("refuses a point that is not on the mesh", function () {
		var r = cappedSphere();
		var p = patchLoop(r, [[100, 0, 0], [101, 0, 0], [100, 1, 0]]);
		expect(p.added).toBe(0);
		expect(p.refused[0].reason).toMatch(/not a mesh vertex/);
	});

	it("refuses a loop that is not simple", function () {
		var r = cappedSphere();
		var l = r.mesh.boundaryLoops[0];
		var p = patchLoop(r, [l[0], l[1], l[2], l[1]]);
		expect(p.added).toBe(0);
		expect(p.refused[0].reason).toMatch(/simple/);
	});

	it("refuses a loop along a break line", function () {
		// break line along the grid's y = 0 border
		var r = buildMesh(planarGrid(20, 20, 0.5), { origin: { x: 0, y: 0, z: 0 }, breaklines: [{ vertices: [[0, 0, 0], [9.5, 0, 0]], closedLoop: false }] });
		expect(r.mesh.boundaryLoops.length).toBe(1);
		var p = patchLoop(r, 0);
		expect(p.added).toBe(0);
		expect(p.refused[0].reason).toMatch(/break line/);
	});
});

describe("patchLoops", function () {
	it("only patches loops up to maxEdges", function () {
		var r = buildMesh(cylinderTunnel(2.5, 20, 0.25, 1), {});
		var small = patchLoops(r, { maxEdges: 10 });
		expect(small.added).toBe(0);
		expect(r.mesh.boundaryLoops.length).toBe(2);
		var all = patchLoops(r, { maxEdges: 100, method: "centroid" });
		expect(all.refused).toEqual([]);
		expect(r.mesh.closed).toBe(true);
		expect(windingConsistent(r.soup)).toBe(true);
	});
});

describe("patching and the visibility sign", function () {
	function keys(soup, n) { return soup.slice(0, n).map(function (t) { return t.v0.id + "," + t.v1.id + "," + t.v2.id; }); }

	it("patching keeps the visibility sign", function () {
		var r = buildMesh(cylinderTunnel(2.5, 20, 0.25, 1));
		expect(r.mesh.orientation).toBe("visibility");
		var before = keys(r.soup, 50);
		patchLoops(r);
		expect(keys(r.soup, 50)).toEqual(before);
		expect(["visibility", "closed"]).toContain(r.mesh.orientation);
	});

	it("patching a visibility: false result does not vote", function () {
		var r = buildMesh(cylinderTunnel(2.5, 20, 0.25, 1), { visibility: false });
		patchLoop(r, 0);
		expect(r.mesh.orientation).not.toBe("visibility");
	});
});
