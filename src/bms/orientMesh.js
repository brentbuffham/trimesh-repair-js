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

// Turn triangle t over: swap v1 and v2, in the soup and in the ids array that mirrors it
function flipAt(soup, ids, t) {
	var tri = soup[t], x = tri.v1; tri.v1 = tri.v2; tri.v2 = x;
	var o = 3 * t, y = ids[o + 1]; ids[o + 1] = ids[o + 2]; ids[o + 2] = y;
}

// true when triangle t runs edge a -> b
function runs(ids, t, a, b) {
	var o = 3 * t, i0 = ids[o], i1 = ids[o + 1], i2 = ids[o + 2];
	return (i0 === a && i1 === b) || (i1 === a && i2 === b) || (i2 === a && i0 === b);
}

function crossOf(t) {
	var ax = t.v1.x - t.v0.x, ay = t.v1.y - t.v0.y, az = t.v1.z - t.v0.z;
	var bx = t.v2.x - t.v0.x, by = t.v2.y - t.v0.y, bz = t.v2.z - t.v0.z;
	return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

// Unit face normals, 3 per triangle (zero for a degenerate triangle). The same arithmetic as
// crossOf, without an array per triangle.
function unitNormals(soup) {
	var N = new Float64Array(3 * soup.length);
	for (var i = 0; i < soup.length; i++) {
		var t = soup[i], v0 = t.v0, v1 = t.v1, v2 = t.v2;
		var ax = v1.x - v0.x, ay = v1.y - v0.y, az = v1.z - v0.z;
		var bx = v2.x - v0.x, by = v2.y - v0.y, bz = v2.z - v0.z;
		var c0 = ay * bz - az * by, c1 = az * bx - ax * bz, c2 = ax * by - ay * bx;
		var l = Math.sqrt(c0 * c0 + c1 * c1 + c2 * c2);
		if (l > 0) { N[3 * i] = c0 / l; N[3 * i + 1] = c1 / l; N[3 * i + 2] = c2 / l; }
	}
	return N;
}

// Binary min-heap of (weight, triangle, from) entries in typed arrays. Each interior edge is
// pushed at most once from each side, but the walk's frontier is a small fraction of that, so
// it starts small and doubles (16 bytes an entry; room for 3 per triangle up front was 48 bytes
// a triangle, 140 MB on a 3M-triangle mesh).
export function Heap(capacity) {
	this.w = new Float64Array(Math.max(16, capacity));
	this.to = new Int32Array(this.w.length);
	this.from = new Int32Array(this.w.length);
	this.size = 0;
}
// Push and pop move a held entry through a hole, one write per level, rather than swapping
// three arrays per level. The comparisons are those of the swapping version, so the heap
// ends in the same arrangement and entries come out in the same order.
Heap.prototype._grow = function () {
	var cap = this.w.length * 2;
	function bigger(Ctor, old) { var a = new Ctor(cap); a.set(old); return a; }
	this.w = bigger(Float64Array, this.w);
	this.to = bigger(Int32Array, this.to);
	this.from = bigger(Int32Array, this.from);
};
Heap.prototype.push = function (w, to, from) {
	if (this.size === this.w.length) this._grow();
	var W = this.w, T = this.to, F = this.from, i = this.size++;
	while (i > 0) {
		var p = (i - 1) >> 1;
		if (W[p] <= w) break;
		W[i] = W[p]; T[i] = T[p]; F[i] = F[p];
		i = p;
	}
	W[i] = w; T[i] = to; F[i] = from;
};
// Removes the lightest entry; read it from .w[size], .to[size], .from[size]
Heap.prototype.pop = function () {
	var W = this.w, T = this.to, F = this.from, last = --this.size;
	var rw = W[0], rt = T[0], rf = F[0];          // the entry leaving
	var hw = W[last], ht = T[last], hf = F[last]; // the one that takes its place, then sifts down
	var i = 0;
	for (;;) {
		var l = 2 * i + 1, r = l + 1, s = -1, sw = hw;
		if (l < last && W[l] < sw) { s = l; sw = W[l]; }
		if (r < last && W[r] < sw) s = r;
		if (s < 0) break;
		W[i] = W[s]; T[i] = T[s]; F[i] = F[s];
		i = s;
	}
	W[i] = hw; T[i] = ht; F[i] = hf;
	W[last] = rw; T[last] = rt; F[last] = rf;
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
function neighbourTable(ids, n, edges) {
	var nbr = new Int32Array(3 * n).fill(-1);
	var counts = edges.counts, t0 = edges.t0, t1 = edges.t1, va = edges.va, vb = edges.vb;
	for (var s = 0; s < edges.size; s++) {
		if (counts[s] !== 2) continue;
		var f = t0[s], g = t1[s], a = va[s], b = vb[s];
		nbr[3 * f + edgeIndex(ids, f, a, b)] = g;
		nbr[3 * g + edgeIndex(ids, g, a, b)] = f;
	}
	return nbr;
}

// which edge of triangle t (edge k runs vertex k to k+1) joins vertex ids a and b, in either order
function edgeIndex(ids, t, a, b) {
	var p = ids[3 * t], q = ids[3 * t + 1], r = ids[3 * t + 2];
	if ((p === a && q === b) || (p === b && q === a)) return 0;
	if ((q === a && r === b) || (q === b && r === a)) return 1;
	return 2;
}

/**
 * @param {{soup: Array<Object>}} bms - triangles are flipped in place
 * @param {Array<number[]>} [viewpoints] - origin-shifted scanner positions
 * @returns {{perComponent: Array<{triangles: number, method: string, consistent: boolean}>,
 *   orientation: "viewpoint"|"closed"|"unresolved"|"mixed", componentOf: Int32Array}}
 *   componentOf maps each soup triangle to its index in perComponent
 */
export function orientMesh(bms, viewpoints) {
	var soup = bms.soup, n = soup.length;
	var edges = edgesOf(bms);
	var comp = new Int32Array(n).fill(-1);
	var perComponent = [];
	var hasViews = Array.isArray(viewpoints) && viewpoints.length > 0;
	var FN = unitNormals(soup);
	var heap = new Heap(4096);
	// every triangle's vertex ids, kept in step with the flips; v1At is v1 when the table was built
	var ids = new Int32Array(3 * n), v1At = new Int32Array(n);
	for (var i = 0; i < n; i++) {
		var tr = soup[i];
		ids[3 * i] = tr.v0.id; ids[3 * i + 1] = tr.v1.id; ids[3 * i + 2] = tr.v2.id;
		v1At[i] = ids[3 * i + 1];
	}
	var nbr = neighbourTable(ids, n, edges);
	// the triangle across edge e of ti now (see neighbourTable); v1 changed means flipped
	function across(ti, e) { return nbr[3 * ti + (ids[3 * ti + 1] === v1At[ti] ? e : 2 - e)]; }

	// Queue the 2-face neighbours of ti not yet reached, weighted by crease
	function reach(ti) {
		for (var e = 0; e < 3; e++) {
			var nj = across(ti, e);
			if (nj < 0 || comp[nj] !== -1) continue;
			var d = FN[3 * ti] * FN[3 * nj] + FN[3 * ti + 1] * FN[3 * nj + 1] + FN[3 * ti + 2] * FN[3 * nj + 2];
			heap.push(1 - Math.abs(d), nj, ti);
		}
	}

	for (var seed = 0; seed < n; seed++) {
		if (comp[seed] !== -1) continue;
		var id = perComponent.length;
		var members = [seed];
		comp[seed] = id;
		reach(seed);
		while (heap.size > 0) {
			heap.pop();
			var nj = heap.to[heap.size], ti = heap.from[heap.size];
			if (comp[nj] !== -1) continue;
			// the edge the two share, in ti's direction
			for (var e = 0; e < 3; e++) {
				if (across(ti, e) !== nj) continue;
				var a = ids[3 * ti + e], b = ids[3 * ti + (e === 2 ? 0 : e + 1)];
				if (runs(ids, nj, a, b)) flipAt(soup, ids, nj);
				break;
			}
			comp[nj] = id;
			members.push(nj);
			reach(nj);
		}

		// closed: every edge has 2 faces; consistent: every one is run both ways
		var consistent = true, closed = true;
		for (var q = 0; q < members.length; q++) {
			var m = members[q];
			for (var k = 0; k < 3; k++) {
				var g = across(m, k);
				if (g < 0) { closed = false; continue; }
				if (runs(ids, g, ids[3 * m + k], ids[3 * m + (k === 2 ? 0 : k + 1)])) consistent = false;
			}
		}

		var method;
		if (hasViews) {
			if (viewpointScore(soup, members, viewpoints) < 0) members.forEach(function (x) { flipAt(soup, ids, x); });
			method = "viewpoint";
		} else if (closed) {
			var tris = members.map(function (x) { return soup[x]; });
			if (computeSignedVolume(tris) > 0) members.forEach(function (x) { flipAt(soup, ids, x); });
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
