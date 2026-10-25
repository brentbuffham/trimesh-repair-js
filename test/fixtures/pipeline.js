// test/fixtures/pipeline.js
//=============================================================
// Run the stages up to cleanSoup, for tests of later stages
//=============================================================

import { prepareCloud } from "trimesh-build-js";
import { runLocalDelaunay } from "trimesh-build-js";
import { EMPTY_CONSTRAINTS } from "trimesh-build-js";
import { ingestToBMS } from "../../src/bms/ingestToBMS.js";
import { cleanSoup } from "../../src/bms/cleanSoup.js";

export var DEFAULTS = { k: 20, maxRadiusMultiplier: 3, minNeighbours: 6, normalAgreement: 0.5, maxPlaneOffset: 0.5, minVotes: 2 };

/**
 * @returns {{cloud: Object, constraints: Object, bms: Object}}
 */
export function meshToClean(cols) {
	var cloud = prepareCloud(cols, {});
	var constraints = EMPTY_CONSTRAINTS(cloud);
	var r = runLocalDelaunay(cloud, constraints, DEFAULTS);
	var bms = ingestToBMS(cloud.coords, r.triangles, Math.max(0.001, 0.25 * cloud.medianSpacing));
	cleanSoup(bms, constraints);
	return { cloud: cloud, constraints: constraints, bms: bms };
}

export function triNormal(t) {
	var ax = t.v1.x - t.v0.x, ay = t.v1.y - t.v0.y, az = t.v1.z - t.v0.z;
	var bx = t.v2.x - t.v0.x, by = t.v2.y - t.v0.y, bz = t.v2.z - t.v0.z;
	return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

/** Every edge shared by 2 triangles is traversed in opposite directions. */
export function windingConsistent(soup) {
	var dir = new Map();
	for (var i = 0; i < soup.length; i++) {
		var vs = [soup[i].v0.id, soup[i].v1.id, soup[i].v2.id];
		for (var e = 0; e < 3; e++) {
			var a = vs[e], b = vs[(e + 1) % 3];
			var k = a + ">" + b;
			if (dir.has(k)) return false;
			dir.set(k, true);
		}
	}
	return true;
}

// A Mobius band: a flat ring of quads, one quad wide, given its half turn
// in three sharp 60 degree steps (rungs 0..3). No winding can be
// consistent; the seam should land in the twist, not on the flat ring.
export function mobiusBand(N) {
	var rungs = [];
	for (var i = 0; i < N; i++) {
		var phi = 2 * Math.PI * i / N, th = Math.PI / 3 * Math.min(i, 3);
		var c = [10 * Math.cos(phi), 10 * Math.sin(phi), 0];
		var d = [Math.cos(th) * Math.cos(phi), Math.cos(th) * Math.sin(phi), Math.sin(th)];
		rungs.push([
			{ x: c[0] + d[0], y: c[1] + d[1], z: c[2] + d[2], id: 2 * i, rung: i },
			{ x: c[0] - d[0], y: c[1] - d[1], z: c[2] - d[2], id: 2 * i + 1, rung: i }
		]);
	}
	var soup = [];
	for (var s = 0; s < N; s++) {
		var a = rungs[s][0], b = rungs[s][1];
		// the last segment closes with the ends swapped: the half turn
		var c2 = s === N - 1 ? rungs[0][0] : rungs[s + 1][1], d2 = s === N - 1 ? rungs[0][1] : rungs[s + 1][0];
		soup.push({ v0: a, v1: b, v2: c2, mesh: "A", origIdx: soup.length });
		soup.push({ v0: a, v1: c2, v2: d2, mesh: "A", origIdx: soup.length });
	}
	return { soup: soup };
}

// interior edges whose two triangles run them the same way, as [a, b] vertices
export function conflictEdges(soup) {
	var seen = new Map(), out = [];
	soup.forEach(function (t) {
		var vs = [t.v0, t.v1, t.v2];
		for (var e = 0; e < 3; e++) {
			var k = vs[e].id + ">" + vs[(e + 1) % 3].id;
			if (seen.has(k)) out.push([vs[e], vs[(e + 1) % 3]]);
			seen.set(k, true);
		}
	});
	return out;
}
