// src/post/fairFill.js
//=============================================================
// FAIR FILL — Liepa 2003, "Filling Holes in Meshes"
//=============================================================
// A flat fan across a long cave loop closes it but cuts through the
// passage: wrong volume, and folds. Liepa's three steps instead:
//   1. triangulateHole - minimum-weight triangulation of the loop on its
//      own vertices (dynamic programming, O(n^3)). Weight: the sharpest
//      crease first, then area. Creases count against the mesh triangle
//      on each loop edge too, so the patch carries on the surface.
//      Diagonals that already exist in the mesh are never used. Loops of
//      more than 400 edges start from a centroid fan instead.
//   2. refine - split patch triangles bigger than the mesh around the
//      hole (centroid split when sqrt(2) x centroid-to-corner distance
//      exceeds the local scale sigma at both), then swap patch edges to
//      be locally Delaunay; repeat until nothing splits. Loop edges are
//      never split, so the mesh is untouched.
//   3. fair - move the new points to minimise bending energy: least
//      squares on the umbrella (uniform Laplacian) at every new point
//      and every loop vertex, with the loop and one ring of mesh around
//      it fixed (conjugate gradients). The patch meets the surface
//      without a crease and bulges with it.
// Winding: a patch triangle runs each loop edge against the loop's
// direction (the loop runs as its mesh triangles do).
//=============================================================

var ALPHA = Math.SQRT2;    // Liepa's density factor
var MAX_SPLITS = 200000;   // safety cap on new points per hole
var ROUND_ITERS = 100;     // fairing iterations per axis each time refinement doubles the points
var FINAL_ITERS = 300;     // ... and at the end
var EXACT_EDGES = 400;     // longer loops start from a centroid fan (the exact triangulation is O(n^3))
var KEY = 2097152;         // 2^21: local vertex indices stay below this

function key(a, b) { return a < b ? a * KEY + b : b * KEY + a; }

// unit normal of (a, b, c) into out[o..o+2]; returns twice the area
function normalInto(P, a, b, c, out, o) {
	var ax = P[3 * b] - P[3 * a], ay = P[3 * b + 1] - P[3 * a + 1], az = P[3 * b + 2] - P[3 * a + 2];
	var bx = P[3 * c] - P[3 * a], by = P[3 * c + 1] - P[3 * a + 1], bz = P[3 * c + 2] - P[3 * a + 2];
	var nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
	var l = Math.sqrt(nx * nx + ny * ny + nz * nz);
	if (l > 0) { out[o] = nx / l; out[o + 1] = ny / l; out[o + 2] = nz / l; }
	else { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; }
	return l;
}

// crease between two unit normals: 0 flat .. 2 folded back (1 - cos)
function crease(N, i, M, j) {
	if (N[i] === 0 && N[i + 1] === 0 && N[i + 2] === 0) return 2;
	if (M[j] === 0 && M[j + 1] === 0 && M[j + 2] === 0) return 0;
	return 1 - (N[i] * M[j] + N[i + 1] * M[j + 1] + N[i + 2] * M[j + 2]);
}

/**
 * Minimum-weight triangulation of a closed loop (Liepa 2003 / Barequet-Sharir).
 * @param {Float64Array} P - loop coordinates, 3 per vertex, in loop order
 * @param {Float64Array|null} outer - unit normal of the mesh triangle on each loop
 *   edge e -> e + 1, signed as a patch triangle across it would face; null: none
 * @param {function(number, number): boolean|null} forbidden - true when the
 *   diagonal (i, k) already exists in the mesh
 * @returns {Array<number[]>|null} triangles as loop indices, each running the loop
 *   edges it uses against the loop direction; null when there is none
 */
export function triangulateHole(P, outer, forbidden) {
	var n = P.length / 3;
	if (n < 3) return null;
	var W = new Float64Array(n * n).fill(Infinity);  // sharpest crease
	var A = new Float64Array(n * n);                  // area
	var L = new Int32Array(n * n).fill(-1);           // apex
	var N = new Float64Array(3 * n * n);              // normal of the apex triangle
	var tn = new Float64Array(3);
	var ZERO = new Float64Array(3);
	var O = outer || ZERO;
	for (var i0 = 0; i0 + 1 < n; i0++) W[i0 * n + i0 + 1] = 0;

	for (var len = 2; len < n; len++) {
		for (var i = 0; i + len < n; i++) {
			var k = i + len, ik = i * n + k;
			if (len < n - 1 && forbidden && forbidden(i, k)) continue;
			var bw = Infinity, ba = Infinity, bm = -1, bx = 0, by = 0, bz = 0;
			for (var m = i + 1; m < k; m++) {
				var wim = W[i * n + m], wmk = W[m * n + k];
				if (wim === Infinity || wmk === Infinity) continue;
				// (k, m, i): runs i+1 -> i when m = i + 1, against the loop
				var area2 = normalInto(P, k, m, i, tn, 0);
				// the triangle across each edge: its sub-solution, or the mesh on a loop edge
				var c1 = m === i + 1 ? crease(tn, 0, O, outer ? 3 * i : 0) : crease(tn, 0, N, 3 * (i * n + m));
				var c2 = k === m + 1 ? crease(tn, 0, O, outer ? 3 * m : 0) : crease(tn, 0, N, 3 * (m * n + k));
				var w = Math.max(wim, wmk, c1, c2);
				if (len === n - 1 && outer) w = Math.max(w, crease(tn, 0, outer, 3 * (n - 1)));
				var a = A[i * n + m] + A[m * n + k] + area2;
				if (w < bw || (w === bw && a < ba)) { bw = w; ba = a; bm = m; bx = tn[0]; by = tn[1]; bz = tn[2]; }
			}
			if (bm < 0) continue;
			W[ik] = bw; A[ik] = ba; L[ik] = bm;
			N[3 * ik] = bx; N[3 * ik + 1] = by; N[3 * ik + 2] = bz;
		}
	}
	if (L[n - 1] < 0) return null;
	var out = [], stack = [[0, n - 1]];
	while (stack.length) {
		var s = stack.pop(), a0 = s[0], k0 = s[1];
		if (k0 - a0 < 2) continue;
		var m0 = L[a0 * n + k0];
		out.push([k0, m0, a0]);
		stack.push([a0, m0], [m0, k0]);
	}
	return out;
}

// The patch as a small editable triangle mesh over local indices
function Patch(P, n) {
	this.X = Array.from(P);     // coordinates; loop vertices are 0..n-1
	this.n = n;
	this.tris = [];             // [a, b, c] or null when removed
	this.edges = new Map();     // key -> triangle indices
}
Patch.prototype.add = function (a, b, c) {
	var t = this.tris.length;
	this.tris.push([a, b, c]);
	var e = [[a, b], [b, c], [c, a]];
	for (var i = 0; i < 3; i++) {
		var k = key(e[i][0], e[i][1]), l = this.edges.get(k);
		if (l) l.push(t); else this.edges.set(k, [t]);
	}
	return t;
};
Patch.prototype.remove = function (t) {
	var tr = this.tris[t], e = [[tr[0], tr[1]], [tr[1], tr[2]], [tr[2], tr[0]]];
	for (var i = 0; i < 3; i++) {
		var k = key(e[i][0], e[i][1]), l = this.edges.get(k);
		l.splice(l.indexOf(t), 1);
		if (!l.length) this.edges.delete(k);
	}
	this.tris[t] = null;
};
Patch.prototype.point = function (x, y, z) {
	this.X.push(x, y, z);
	return this.X.length / 3 - 1;
};

function dist(X, a, b) {
	return Math.hypot(X[3 * a] - X[3 * b], X[3 * a + 1] - X[3 * b + 1], X[3 * a + 2] - X[3 * b + 2]);
}

// Is d inside the smallest sphere through a, b, c (their circumcircle's sphere)?
function inCircumsphere(X, a, b, c, d) {
	var ax = X[3 * a], ay = X[3 * a + 1], az = X[3 * a + 2];
	var ux = X[3 * b] - ax, uy = X[3 * b + 1] - ay, uz = X[3 * b + 2] - az;
	var vx = X[3 * c] - ax, vy = X[3 * c + 1] - ay, vz = X[3 * c + 2] - az;
	var wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
	var w2 = wx * wx + wy * wy + wz * wz;
	if (!(w2 > 0)) return false;
	var u2 = ux * ux + uy * uy + uz * uz, v2 = vx * vx + vy * vy + vz * vz;
	// circumcentre offset from a: (u2 (v x w) + v2 (w x u)) / (2 |w|^2)
	var cx = (u2 * (vy * wz - vz * wy) + v2 * (wy * uz - wz * uy)) / (2 * w2);
	var cy = (u2 * (vz * wx - vx * wz) + v2 * (wz * ux - wx * uz)) / (2 * w2);
	var cz = (u2 * (vx * wy - vy * wx) + v2 * (wx * uy - wy * ux)) / (2 * w2);
	var r2 = cx * cx + cy * cy + cz * cz;
	var dx = X[3 * d] - ax - cx, dy = X[3 * d + 1] - ay - cy, dz = X[3 * d + 2] - az - cz;
	return dx * dx + dy * dy + dz * dz < r2 * (1 - 1e-9);
}

// Step 2: refine to the local scale, keeping patch edges locally Delaunay
// afterRound(): called after each round of splits (fairFill fairs the patch there)
function refine(patch, sigma, forbidden, afterRound) {
	var X = patch.X, n = patch.n;
	var nrm = new Float64Array(12);
	function isLoopEdge(a, b) {
		if (a >= n || b >= n) return false;
		var d = Math.abs(a - b);
		return d === 1 || d === n - 1;
	}
	// swap edge (a, b) when it is not locally Delaunay; true when swapped
	function relax(a, b) {
		if (isLoopEdge(a, b)) return false;
		var l = patch.edges.get(key(a, b));
		if (!l || l.length !== 2) return false;
		var t1 = patch.tris[l[0]], t2 = patch.tris[l[1]];
		// t1 runs a -> b with apex c; t2 runs b -> a with apex d
		var ia = t1.indexOf(a);
		if (t1[(ia + 1) % 3] !== b) { var tmp = t1; t1 = t2; t2 = tmp; ia = t1.indexOf(a); }
		var c = t1[(ia + 2) % 3], ib = t2.indexOf(b), d = t2[(ib + 2) % 3];
		if (c === d || patch.edges.has(key(c, d))) return false;
		if (c < n && d < n && forbidden && forbidden(c, d)) return false;
		if (!inCircumsphere(X, a, b, c, d)) return false;
		// new triangles (a, d, c) and (d, b, c) must face as the old pair did
		var s1 = normalInto(X, a, b, c, nrm, 0), s2 = normalInto(X, b, a, d, nrm, 3);
		var s3 = normalInto(X, a, d, c, nrm, 6), s4 = normalInto(X, d, b, c, nrm, 9);
		if (!(s1 > 0 && s2 > 0 && s3 > 0 && s4 > 0)) return false;
		var ox = nrm[0] + nrm[3], oy = nrm[1] + nrm[4], oz = nrm[2] + nrm[5];
		if (nrm[6] * ox + nrm[7] * oy + nrm[8] * oz <= 0 || nrm[9] * ox + nrm[10] * oy + nrm[11] * oz <= 0) return false;
		if (nrm[6] * nrm[9] + nrm[7] * nrm[10] + nrm[8] * nrm[11] <= 0) return false;
		patch.remove(l[1]); patch.remove(l[0]);
		patch.add(a, d, c); patch.add(d, b, c);
		queue.push(a, d, d, b, b, c, c, a);
		return true;
	}
	// Edges waiting to be checked, as pairs; a swap queues the quad's four sides
	var queue = [];
	function relaxQueued() {
		for (var guard = 0; queue.length && guard < 50 * MAX_SPLITS; guard++) {
			var b = queue.pop(), a = queue.pop();
			relax(a, b);
		}
		queue.length = 0;
	}
	function relaxAll() {
		patch.edges.forEach(function (l, k) { var a = Math.floor(k / KEY); queue.push(a, k - a * KEY); });
		relaxQueued();
	}

	var splits = 0;
	relaxAll();
	for (;;) {
		var any = false, count = patch.tris.length;
		for (var t = 0; t < count; t++) {
			var tr = patch.tris[t];
			if (!tr) continue;
			var a = tr[0], b = tr[1], c = tr[2];
			var cx = (X[3 * a] + X[3 * b] + X[3 * c]) / 3, cy = (X[3 * a + 1] + X[3 * b + 1] + X[3 * c + 1]) / 3, cz = (X[3 * a + 2] + X[3 * b + 2] + X[3 * c + 2]) / 3;
			var sc = (sigma[a] + sigma[b] + sigma[c]) / 3, split = true;
			for (var q = 0; q < 3 && split; q++) {
				var v = tr[q];
				var dv = ALPHA * Math.hypot(cx - X[3 * v], cy - X[3 * v + 1], cz - X[3 * v + 2]);
				if (!(dv > sc && dv > sigma[v])) split = false;
			}
			if (!split) continue;
			var p = patch.point(cx, cy, cz);
			sigma.push(sc);
			patch.remove(t);
			patch.add(a, b, p); patch.add(b, c, p); patch.add(c, a, p);
			queue.push(a, b, b, c, c, a);
			relaxQueued();
			any = true;
			if (++splits >= MAX_SPLITS) return;
		}
		// every edge a split or swap touched was queued, so no full pass is needed
		if (!any) return;
		if (afterRound) afterRound();
	}
}

// Step 3: least-squares umbrella fairing of the new points (CG on the normal equations)
// maxIter: conjugate-gradient iterations per axis
function fair(patch, ring, maxIter) {
	var X = patch.X, n = patch.n, total = X.length / 3;
	var free = total - n;
	if (free <= 0) return;
	// neighbours over local indices; the mesh ring gets indices after the patch
	var nb = [];
	for (var v = 0; v < total; v++) nb.push(new Set());
	patch.tris.forEach(function (t) {
		if (!t) return;
		for (var e = 0; e < 3; e++) { nb[t[e]].add(t[(e + 1) % 3]); nb[t[(e + 1) % 3]].add(t[e]); }
	});
	var fixedXYZ = X.slice(0);
	for (var b = 0; b < n; b++) {
		var r = ring[b] || [];
		for (var j = 0; j < r.length; j++) {
			var id = r[j];
			if (typeof id === "number") { nb[b].add(id); continue; }  // another loop vertex
			fixedXYZ.push(id[0], id[1], id[2]);
			nb[b].add(fixedXYZ.length / 3 - 1);
		}
	}
	// rows: every vertex whose umbrella involves a free point
	var rowsOf = [];
	for (var w = 0; w < total; w++) {
		if (w >= n) { rowsOf.push(w); continue; }
		var touches = false;
		nb[w].forEach(function (k) { if (k >= n && k < total) touches = true; });
		if (touches) rowsOf.push(w);
	}
	var R = rowsOf.length;
	var start = new Int32Array(R + 1), cols = [], vals = [], cst = new Float64Array(3 * R);
	// Scale-dependent umbrella (Liepa; Desbrun et al. 1999): neighbour weights
	// 1 / edge length, from the refined positions. Uniform weights let a long
	// loop edge count as much as a short mesh edge and tilt the patch inward.
	function len(a, b) {
		return Math.hypot(fixedXYZ[3 * a] - fixedXYZ[3 * b], fixedXYZ[3 * a + 1] - fixedXYZ[3 * b + 1], fixedXYZ[3 * a + 2] - fixedXYZ[3 * b + 2]) || 1e-12;
	}
	for (var ri = 0; ri < R; ri++) {
		var j0 = rowsOf[ri], wsum = 0;
		nb[j0].forEach(function (k) { wsum += 1 / len(j0, k); });
		start[ri] = cols.length;
		nb[j0].forEach(function (k) {
			var wk = 1 / len(j0, k) / wsum;
			if (k >= n && k < total) { cols.push(k - n); vals.push(wk); }
			else for (var a = 0; a < 3; a++) cst[3 * ri + a] += fixedXYZ[3 * k + a] * wk;
		});
		if (j0 >= n) { cols.push(j0 - n); vals.push(-1); }
		else for (var a2 = 0; a2 < 3; a2++) cst[3 * ri + a2] -= fixedXYZ[3 * j0 + a2];
	}
	start[R] = cols.length;
	var C = Int32Array.from(cols), V = Float64Array.from(vals);
	var y = new Float64Array(R);
	function apply(x, out) {   // out = A^T A x
		for (var r1 = 0; r1 < R; r1++) {
			var s = 0;
			for (var q = start[r1]; q < start[r1 + 1]; q++) s += V[q] * x[C[q]];
			y[r1] = s;
		}
		out.fill(0);
		for (var r2 = 0; r2 < R; r2++) for (var q2 = start[r2]; q2 < start[r2 + 1]; q2++) out[C[q2]] += V[q2] * y[r2];
	}
	var x = new Float64Array(free), rhs = new Float64Array(free), res = new Float64Array(free);
	var dir = new Float64Array(free), Ad = new Float64Array(free), z = new Float64Array(free);
	// Jacobi preconditioner: the diagonal of A^T A
	var D = new Float64Array(free);
	for (var q0 = 0; q0 < C.length; q0++) D[C[q0]] += V[q0] * V[q0];
	for (var d0 = 0; d0 < free; d0++) D[d0] = D[d0] > 0 ? 1 / D[d0] : 1;
	for (var axis = 0; axis < 3; axis++) {
		// rhs = -A^T c
		rhs.fill(0);
		for (var r3 = 0; r3 < R; r3++) for (var q3 = start[r3]; q3 < start[r3 + 1]; q3++) rhs[C[q3]] -= V[q3] * cst[3 * r3 + axis];
		for (var f = 0; f < free; f++) x[f] = X[3 * (n + f) + axis];
		apply(x, Ad);
		// preconditioned conjugate gradients
		var rr = 0, bb = 0, rz = 0;
		for (var f2 = 0; f2 < free; f2++) {
			res[f2] = rhs[f2] - Ad[f2]; z[f2] = res[f2] * D[f2]; dir[f2] = z[f2];
			rr += res[f2] * res[f2]; rz += res[f2] * z[f2]; bb += rhs[f2] * rhs[f2];
		}
		var tol = 1e-12 * Math.max(bb, 1e-30);
		for (var it = 0; it < maxIter && rr > tol; it++) {
			apply(dir, Ad);
			var dAd = 0;
			for (var f3 = 0; f3 < free; f3++) dAd += dir[f3] * Ad[f3];
			if (!(dAd > 0)) break;
			var alpha = rz / dAd, rz2 = 0;
			rr = 0;
			for (var f4 = 0; f4 < free; f4++) {
				x[f4] += alpha * dir[f4]; res[f4] -= alpha * Ad[f4]; z[f4] = res[f4] * D[f4];
				rr += res[f4] * res[f4]; rz2 += res[f4] * z[f4];
			}
			var beta = rz2 / rz;
			rz = rz2;
			for (var f5 = 0; f5 < free; f5++) dir[f5] = z[f5] + beta * dir[f5];
		}
		for (var f6 = 0; f6 < free; f6++) X[3 * (n + f6) + axis] = x[f6];
	}
}

/**
 * Liepa fill of one loop.
 * @param {Float64Array} P - loop coordinates, 3 per vertex, in loop order
 * @param {{outer?: Float64Array|null, forbidden?: function(number, number): boolean,
 *   ring?: Array<Array<number|number[]>>, maxEdges?: number}} opts -
 *   outer: as triangulateHole; forbidden: diagonal (i, k) exists in the mesh;
 *   ring[i]: loop vertex i's mesh neighbours, as [x, y, z] (fixed points) or a loop index
 * @returns {{tris: Array<number[]>, points: Float64Array}|{reason: string}}
 *   tris over loop indices 0..n-1 then new points n.., wound as triangulateHole;
 *   points: the new points, 3 per point
 */
export function fairFill(P, opts) {
	var o = opts || {};
	var n = P.length / 3;
	var maxEdges = o.maxEdges || 5000;
	if (n > maxEdges) return { reason: "the loop has more than " + maxEdges + " edges" };
	var patch = new Patch(P, n);
	if (n <= EXACT_EDGES) {
		var tris = triangulateHole(P, o.outer || null, o.forbidden || null);
		if (!tris) return { reason: "every triangulation uses an edge the mesh already has" };
		tris.forEach(function (t) { patch.add(t[0], t[1], t[2]); });
	} else {
		// too long for the O(n^3) triangulation: start from a centroid fan
		// (all its edges are new); refining and fairing reshape it
		var cx = 0, cy = 0, cz = 0;
		for (var c = 0; c < n; c++) { cx += P[3 * c] / n; cy += P[3 * c + 1] / n; cz += P[3 * c + 2] / n; }
		var mid = patch.point(cx, cy, cz);
		for (var f = 0; f < n; f++) patch.add((f + 1) % n, f, mid);
	}
	// local scale (Liepa's sigma): mean length of the mesh edges at each loop
	// vertex. Not the loop edges alone: the mesh often reaches into a hole
	// with long triangles, so its loop edges are several spacings long.
	var sigma = [], ring = o.ring || [];
	for (var i = 0; i < n; i++) {
		var r = ring[i], sum = 0, cnt = 0;
		for (var j = 0; r && j < r.length; j++) {
			var q = r[j];
			sum += typeof q === "number" ? dist(patch.X, i, q) : Math.hypot(q[0] - P[3 * i], q[1] - P[3 * i + 1], q[2] - P[3 * i + 2]);
			cnt++;
		}
		sigma.push(cnt ? sum / cnt : (dist(patch.X, i, (i + 1) % n) + dist(patch.X, i, (i + n - 1) % n)) / 2);
	}
	if (patch.X.length > 3 * n) sigma.push(sigma.reduce(function (s, v) { return s + v; }, 0) / n);  // the fan's centroid
	// Fair each time refinement has doubled the new points, not only at the
	// end: later points then start on an already faired surface, and the
	// last solve starts close to its answer (a cascade, like multigrid). One
	// solve on the finest patch alone crawls: thousands of iterations,
	// mostly sliding points within the surface.
	var ringPts = o.ring || [], lastFair = 32;
	refine(patch, sigma, o.forbidden || null, function () {
		var added = patch.X.length / 3 - n;
		if (added < 2 * lastFair) return;
		fair(patch, ringPts, ROUND_ITERS);
		lastFair = added;
	});
	fair(patch, ringPts, FINAL_ITERS);
	return {
		tris: patch.tris.filter(function (t) { return t; }),
		points: Float64Array.from(patch.X.slice(3 * n))
	};
}
