// src/bms/orientMesh.js
//=============================================================
// ORIENT MESH — consistent winding, then normals into the void
//=============================================================
// PCA normals have no reliable sign, so winding is fixed on the
// welded mesh, never per triangle:
//   1. per connected component, walk outward across edges with
//      exactly 2 faces, flipping any neighbour that runs the shared
//      edge the same way. The walk crosses the flattest edges first
//      (Hoppe et al. 1992's minimum spanning tree, over triangles
//      instead of points: weight 1 - |n.n| of the two face normals).
//      A scan mesh can hold twisted (Mobius) strips between holes,
//      where no winding is consistent; a breadth-first walk leaves
//      their seam wherever its two fronts meet, usually on flat
//      ground, while this one leaves it on the sharpest crease, the
//      fold that makes the twist;
//   2. pick the component's sign so normals point out of rock into
//      the void:
//        viewpoints given -> face the nearest scanner position
//        closed           -> void is inside, normals inward
//                            (signed volume negative)
//        otherwise        -> leave it, "unresolved"; buildMesh then
//                            runs orientByVisibility (visibility.js),
//                            a ray vote for the void side.
//=============================================================

import { computeSignedVolume } from "trimesh-boolean";
import { edgesOf } from "./edges.js";

function flip(t) {
	var x = t.v1; t.v1 = t.v2; t.v2 = x;
}

// true when triangle t runs edge a -> b
function runs(t, a, b) {
	var i0 = t.v0.id, i1 = t.v1.id, i2 = t.v2.id;
	return (i0 === a && i1 === b) || (i1 === a && i2 === b) || (i2 === a && i0 === b);
}

function crossOf(t) {
	var ax = t.v1.x - t.v0.x, ay = t.v1.y - t.v0.y, az = t.v1.z - t.v0.z;
	var bx = t.v2.x - t.v0.x, by = t.v2.y - t.v0.y, bz = t.v2.z - t.v0.z;
	return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

// Unit face normals, 3 per triangle (zero for a degenerate triangle)
function unitNormals(soup) {
	var N = new Float64Array(3 * soup.length);
	for (var i = 0; i < soup.length; i++) {
		var c = crossOf(soup[i]), l = Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]);
		if (l > 0) { N[3 * i] = c[0] / l; N[3 * i + 1] = c[1] / l; N[3 * i + 2] = c[2] / l; }
	}
	return N;
}

// Binary min-heap of (weight, triangle, from) entries in typed arrays.
// Each interior edge is pushed at most once from each side.
function Heap(capacity) {
	this.w = new Float64Array(Math.max(16, capacity));
	this.to = new Int32Array(this.w.length);
	this.from = new Int32Array(this.w.length);
	this.size = 0;
}
Heap.prototype._swap = function (i, j) {
	var w = this.w[i]; this.w[i] = this.w[j]; this.w[j] = w;
	var t = this.to[i]; this.to[i] = this.to[j]; this.to[j] = t;
	var f = this.from[i]; this.from[i] = this.from[j]; this.from[j] = f;
};
Heap.prototype.push = function (w, to, from) {
	var i = this.size++;
	this.w[i] = w; this.to[i] = to; this.from[i] = from;
	while (i > 0) {
		var p = (i - 1) >> 1;
		if (this.w[p] <= this.w[i]) break;
		this._swap(p, i);
		i = p;
	}
};
// Removes the lightest entry; read it from .w[size], .to[size], .from[size]
Heap.prototype.pop = function () {
	var last = --this.size;
	this._swap(0, last);
	var i = 0;
	for (;;) {
		var l = 2 * i + 1, r = l + 1, s = i;
		if (l < last && this.w[l] < this.w[s]) s = l;
		if (r < last && this.w[r] < this.w[s]) s = r;
		if (s === i) break;
		this._swap(s, i);
		i = s;
	}
};

// Sum over triangles of (2 x area x normal) . (nearest viewpoint - centroid)
function viewpointScore(soup, tris, viewpoints) {
	var score = 0;
	for (var i = 0; i < tris.length; i++) {
		var t = soup[tris[i]];
		var cx = (t.v0.x + t.v1.x + t.v2.x) / 3, cy = (t.v0.y + t.v1.y + t.v2.y) / 3, cz = (t.v0.z + t.v1.z + t.v2.z) / 3;
		var best = null, bd = Infinity;
		for (var v = 0; v < viewpoints.length; v++) {
			var p = viewpoints[v];
			var d = (p[0] - cx) * (p[0] - cx) + (p[1] - cy) * (p[1] - cy) + (p[2] - cz) * (p[2] - cz);
			if (d < bd) { bd = d; best = p; }
		}
		var n = crossOf(t);
		score += n[0] * (best[0] - cx) + n[1] * (best[1] - cy) + n[2] * (best[2] - cz);
	}
	return score;
}

// nbr[3t + k]: the triangle across the k-th edge of triangle t as the soup stands NOW
// (edge k runs vertex k to vertex k+1), or -1 when the edge does not have exactly two faces.
// Built once from the edge table; a flip swaps v1 and v2, which reads the three edges as
// [2, 1, 0], so nothing has to be rebuilt as triangles turn over.
function neighbourTable(soup, edges) {
	var n = soup.length, nbr = new Int32Array(3 * n).fill(-1), counts = edges.counts, t0 = edges.t0, t1 = edges.t1;
	for (var t = 0; t < n; t++) {
		var tri = soup[t], a = tri.v0.id, b = tri.v1.id, c = tri.v2.id;
		for (var e = 0; e < 3; e++) {
			var s = edges.slot(e === 0 ? a : e === 1 ? b : c, e === 0 ? b : e === 1 ? c : a);
			if (counts[s] === 2) nbr[3 * t + e] = t0[s] === t ? t1[s] : t0[s];
		}
	}
	return nbr;
}

/**
 * @param {{soup: Array<Object>}} bms - triangles are flipped in place
 * @param {Array<number[]>} [viewpoints] - origin-shifted scanner positions
 * @returns {{perComponent: Array<{triangles: number, method: string, consistent: boolean}>,
 *   orientation: "viewpoint"|"closed"|"unresolved"|"mixed", componentOf: Int32Array}}
 *   componentOf maps each soup triangle to its index in perComponent
 */
export function orientMesh(bms, viewpoints) {
	var soup = bms.soup;
	var edges = edgesOf(bms);
	var comp = new Int32Array(soup.length).fill(-1);
	var perComponent = [];
	var hasViews = Array.isArray(viewpoints) && viewpoints.length > 0;
	var FN = unitNormals(soup);
	var heap = new Heap(3 * soup.length);
	var nbr = neighbourTable(soup, edges);
	// ids of each triangle's v1 when the table was built: v1 changed means flipped
	var v1At = new Int32Array(soup.length);
	for (var i = 0; i < soup.length; i++) v1At[i] = soup[i].v1.id;
	// the triangle across edge e of ti now (see neighbourTable)
	function across(ti, e) { return nbr[3 * ti + (soup[ti].v1.id === v1At[ti] ? e : 2 - e)]; }

	// Queue the 2-face neighbours of ti not yet reached, weighted by crease
	function reach(ti) {
		for (var e = 0; e < 3; e++) {
			var nj = across(ti, e);
			if (nj < 0 || comp[nj] !== -1) continue;
			var d = FN[3 * ti] * FN[3 * nj] + FN[3 * ti + 1] * FN[3 * nj + 1] + FN[3 * ti + 2] * FN[3 * nj + 2];
			heap.push(1 - Math.abs(d), nj, ti);
		}
	}

	for (var seed = 0; seed < soup.length; seed++) {
		if (comp[seed] !== -1) continue;
		var id = perComponent.length;
		var members = [seed];
		comp[seed] = id;
		reach(seed);
		while (heap.size > 0) {
			heap.pop();
			var nj = heap.to[heap.size], ti = heap.from[heap.size];
			if (comp[nj] !== -1) continue;
			var t = soup[ti], other = soup[nj];
			// the edge the two share, in t's direction
			var vs = [t.v0.id, t.v1.id, t.v2.id];
			for (var e = 0; e < 3; e++) {
				if (across(ti, e) !== nj) continue;
				var a = vs[e], b = vs[(e + 1) % 3];
				if (runs(other, a, b)) flip(other);
				break;
			}
			comp[nj] = id;
			members.push(nj);
			reach(nj);
		}

		// closed: every edge has 2 faces; consistent: every one is run both ways
		var consistent = true, closed = true;
		for (var q = 0; q < members.length; q++) {
			var tq = soup[members[q]], ws = [tq.v0.id, tq.v1.id, tq.v2.id];
			for (var k = 0; k < 3; k++) {
				var g = across(members[q], k);
				if (g < 0) { closed = false; continue; }
				if (runs(soup[g], ws[k], ws[(k + 1) % 3])) consistent = false;
			}
		}

		var method;
		if (hasViews) {
			if (viewpointScore(soup, members, viewpoints) < 0) members.forEach(function (m) { flip(soup[m]); });
			method = "viewpoint";
		} else if (closed) {
			var tris = members.map(function (m) { return soup[m]; });
			if (computeSignedVolume(tris) > 0) members.forEach(function (m) { flip(soup[m]); });
			method = "closed";
		} else {
			method = "unresolved";
		}
		perComponent.push({ triangles: members.length, method: method, consistent: consistent });
	}

	var methods = new Set(perComponent.map(function (c) { return c.method; }));
	var orientation = methods.size === 1 ? perComponent[0].method : methods.size === 0 ? "unresolved" : "mixed";
	return { perComponent: perComponent, orientation: orientation, componentOf: comp };
}
