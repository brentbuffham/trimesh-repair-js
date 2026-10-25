// src/validate/validateMesh.js
//=============================================================
// VALIDATE MESH — report what the mesh is, never fail on it
//=============================================================
// Edge use decides everything:
//   1 face  -> boundary (a hole, the scan edge, or a break line that
//              ends mid-surface)
//   2 faces -> interior
//   3+      -> non-manifold
// closed = no 1-face and no 3+ edges. A break line edge used once is
// left out of boundaryEdgeCount (it is intentional) but still stops
// closed being true.
//
// pointInside is a ray-parity test for closed meshes. Whether inside
// means void or rock is the caller's call, from the convention that
// normals point out of rock into the void.
//=============================================================

import { computeSignedVolume } from "trimesh-boolean";
import { edgesOf, poolEdgeKey } from "../bms/edges.js";

/**
 * @typedef {Object} MeshResult
 * @property {boolean} closed
 * @property {number[][]} boundaryLoops - PoolVertex ids in loop order
 * @property {number} boundaryEdgeCount - 1-face edges that are not break line edges
 * @property {number} nonManifoldEdgeCount
 * @property {number|null} enclosedVolume - null unless closed
 * @property {Array<{a: number, b: number}>} constrainedEdges - break line edges present in the mesh
 * @property {string} orientation
 * @property {number} orientationConflicts - interior edges whose two triangles run them the same way (folds)
 */

// Trace loops over the boundary edges (1 face). The walk is undirected, so a
// winding conflict cannot break a loop into fragments, but at each vertex it
// prefers the edge that runs in its triangle's direction, so a bow-tie
// vertex still splits into its two loops. Each loop is returned running its
// first edge in that edge's triangle direction.
function traceLoops(soup, edges) {
	var adj = new Map(); // vertex -> [{to, key, forward}]
	function link(a, b, key, forward) {
		if (!adj.has(a)) adj.set(a, []);
		adj.get(a).push({ to: b, key: key, forward: forward });
	}
	edges.forEach(function (n, key, t0) {
		if (n !== 1) return;
		var t = soup[t0];
		var vs = [t.v0.id, t.v1.id, t.v2.id];
		for (var e = 0; e < 3; e++) {
			var a = vs[e], b = vs[(e + 1) % 3];
			if (poolEdgeKey(a, b) === key) { link(a, b, key, true); link(b, a, key, false); break; }
		}
	});
	var used = new Set();
	function pick(v) {
		var outs = adj.get(v), any = null;
		for (var i = 0; i < outs.length; i++) {
			if (used.has(outs[i].key)) continue;
			if (outs[i].forward) return outs[i];
			if (!any) any = outs[i];
		}
		return any;
	}
	var loops = [];
	var starts = Array.from(adj.keys()).sort(function (x, y) { return x - y; });
	for (var s = 0; s < starts.length; s++) {
		var start = starts[s];
		var step;
		while ((step = pick(start))) {
			var loop = [start];
			var firstForward = step.forward;
			used.add(step.key);
			var cur = step.to;
			while (cur !== start) {
				loop.push(cur);
				step = pick(cur);
				if (!step) break; // open chain: a non-manifold vertex
				used.add(step.key);
				cur = step.to;
			}
			if (!firstForward) loop = [loop[0]].concat(loop.slice(1).reverse());
			var simple = splitSelfTouching(loop);
			for (var q = 0; q < simple.length; q++) loops.push(simple[q]);
		}
	}
	return loops;
}

// Split a loop that passes through a vertex more than once (holes touching
// at a pinch vertex) into simple loops: the run between two visits of a
// vertex is one loop. Ported from trimesh-boolean boundaryLoops.js
// _splitSelfTouching (private there), keyed by PoolVertex id.
function splitSelfTouching(loop) {
	var out = [], stack = [], at = new Map();
	for (var i = 0; i < loop.length; i++) {
		var id = loop[i];
		if (at.has(id)) {
			var cycle = stack.splice(at.get(id));
			for (var c = 0; c < cycle.length; c++) at.delete(cycle[c]);
			if (cycle.length >= 3) out.push(cycle);
		}
		at.set(id, stack.length);
		stack.push(id);
	}
	if (stack.length >= 3) out.push(stack);
	return out;
}

// Interior edges whose two triangles run them the same way
function countConflicts(soup, edges) {
	var n = 0;
	edges.forEach(function (faces, key, t0, t1) {
		if (faces !== 2) return;
		var dirs = [t0, t1].map(function (ti) {
			var t = soup[ti], vs = [t.v0.id, t.v1.id, t.v2.id];
			for (var e = 0; e < 3; e++) if (poolEdgeKey(vs[e], vs[(e + 1) % 3]) === key) return vs[e];
			return -1;
		});
		if (dirs[0] === dirs[1]) n++;
	});
	return n;
}

/**
 * @param {{soup: Array<Object>, constraintPoolEdges?: Set<string>, constrainedPairs?: Array<{a: number, b: number}>}} bms
 * @param {string} orientation - from orientMesh
 * @returns {MeshResult}
 */
export function validateMesh(bms, orientation) {
	var soup = bms.soup;
	var edges = edgesOf(bms);
	var cons = bms.constraintPoolEdges || new Set();
	var oneFace = 0, boundary = 0, nonManifold = 0;
	edges.forEach(function (n, key) {
		if (n === 1) {
			oneFace++;
			if (!cons.has(key)) boundary++;
		} else if (n > 2) nonManifold++;
	});
	var closed = soup.length > 0 && oneFace === 0 && nonManifold === 0;
	var constrainedEdges = (bms.constrainedPairs || []).filter(function (p) {
		return edges.has(poolEdgeKey(p.a, p.b));
	});
	return {
		closed: closed,
		boundaryLoops: oneFace ? traceLoops(soup, edges) : [],
		boundaryEdgeCount: boundary,
		nonManifoldEdgeCount: nonManifold,
		enclosedVolume: closed ? Math.abs(computeSignedVolume(soup)) : null,
		constrainedEdges: constrainedEdges,
		orientation: orientation,
		orientationConflicts: countConflicts(soup, edges)
	};
}

// Fixed, slightly skewed direction so rays rarely graze an edge exactly
var RAY = (function () {
	var d = [1e-4, 2e-4, 1], l = Math.hypot(d[0], d[1], d[2]);
	return [d[0] / l, d[1] / l, d[2] / l];
})();

/**
 * Ray parity: odd crossings = inside the closed surface.
 * @param {{soup: Array<Object>}} bms
 * @param {number[]} p - origin-shifted [x, y, z]
 * @returns {boolean}
 */
export function pointInside(bms, p) {
	var hits = 0, d = RAY;
	var soup = bms.soup;
	for (var i = 0; i < soup.length; i++) {
		var t = soup[i];
		// Moller-Trumbore
		var e1x = t.v1.x - t.v0.x, e1y = t.v1.y - t.v0.y, e1z = t.v1.z - t.v0.z;
		var e2x = t.v2.x - t.v0.x, e2y = t.v2.y - t.v0.y, e2z = t.v2.z - t.v0.z;
		var px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
		var det = e1x * px + e1y * py + e1z * pz;
		if (Math.abs(det) < 1e-15) continue;
		var inv = 1 / det;
		var sx = p[0] - t.v0.x, sy = p[1] - t.v0.y, sz = p[2] - t.v0.z;
		var u = (sx * px + sy * py + sz * pz) * inv;
		if (u < 0 || u > 1) continue;
		var qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
		var v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
		if (v < 0 || u + v > 1) continue;
		var tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
		if (tt > 0) hits++;
	}
	return (hits & 1) === 1;
}
