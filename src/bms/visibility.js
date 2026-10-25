// src/bms/visibility.js
//=============================================================
// VISIBILITY — which side of an open surface is the void
//=============================================================
// A component with no viewpoints that is not closed has no sign
// from orientMesh. Inside a cave, drive or hole, rays cast into the
// void come back off the opposite wall; rays cast into the rock
// escape. So from sampled triangles cast rays into both hemispheres
// and point the normals at the side whose rays come back (after
// Takayama, Jacobson & Sorkine 2014, who cast rays to fix facet
// orientation). Rays test every triangle, not only the component's:
// holes often split a cave into separate wall pieces.
//
//   grid:  sparse uniform cells over the triangles' boxes (a Map
//          from cell key to a CSR slot), so a stray far triangle
//          costs one cell instead of coarsening every cell
//   rays:  3D DDA through the cells (Amanatides & Woo 1987),
//          Moller-Trumbore per triangle, any hit in (tMin, tMax]
//          counts; tMax is twice the component's own size
//=============================================================

// Cell keys ix + nx (iy + ny iz) stay exact below 2^52
var MAX_KEY = 4503599627370496;

/**
 * Mean length over every triangle's three edges.
 * @param {Array<{v0, v1, v2}>} soup
 * @returns {number}
 */
export function meanEdgeLength(soup) {
	var sum = 0;
	for (var i = 0; i < soup.length; i++) {
		var a = soup[i].v0, b = soup[i].v1, c = soup[i].v2;
		sum += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) + Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z) + Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z);
	}
	return soup.length ? sum / (3 * soup.length) : 0;
}

/**
 * Sparse uniform grid over the triangles' bounding boxes. A triangle is
 * listed in every cell its box overlaps; only cells that hold a triangle
 * are stored, so the cell size stays as asked whatever the extent.
 * @param {Array<{v0, v1, v2}>} soup
 * @param {number} cellSize
 * @returns {Object} grid: min, cell, n (cells per axis over the box), slot (Map key -> cell), start (CSR offsets), tris, P (9 coords per triangle), stamp, ray
 */
export function buildTriangleGrid(soup, cellSize) {
	var T = soup.length, P = new Float64Array(9 * T);
	var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
	for (var i = 0; i < T; i++) {
		var vs = [soup[i].v0, soup[i].v1, soup[i].v2];
		for (var k = 0; k < 3; k++) {
			var x = vs[k].x, y = vs[k].y, z = vs[k].z;
			P[9 * i + 3 * k] = x; P[9 * i + 3 * k + 1] = y; P[9 * i + 3 * k + 2] = z;
			if (x < lo[0]) lo[0] = x; if (x > hi[0]) hi[0] = x;
			if (y < lo[1]) lo[1] = y; if (y > hi[1]) hi[1] = y;
			if (z < lo[2]) lo[2] = z; if (z > hi[2]) hi[2] = z;
		}
	}
	if (T === 0) { lo = [0, 0, 0]; hi = [0, 0, 0]; }
	var pad = 1e-9 * Math.max(Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), 1);
	for (var d = 0; d < 3; d++) { lo[d] -= pad; hi[d] += pad; }

	var cell = cellSize > 0 ? cellSize : 1, n;
	for (;;) {
		n = [0, 1, 2].map(function (a) { return Math.max(1, Math.ceil((hi[a] - lo[a]) / cell)); });
		if (n[0] * n[1] * n[2] <= MAX_KEY) break;
		cell *= Math.cbrt(n[0] * n[1] * n[2] / MAX_KEY) * 1.0001;
	}

	// each triangle's cell box, then a count per occupied cell
	var nx = n[0], ny = n[1], box = new Int32Array(6 * T), slot = new Map(), counts = [];
	for (var t = 0; t < T; t++) {
		for (var a = 0; a < 3; a++) {
			var mn = Math.min(P[9 * t + a], P[9 * t + 3 + a], P[9 * t + 6 + a]);
			var mx = Math.max(P[9 * t + a], P[9 * t + 3 + a], P[9 * t + 6 + a]);
			box[6 * t + a] = Math.min(n[a] - 1, Math.max(0, Math.floor((mn - lo[a]) / cell)));
			box[6 * t + 3 + a] = Math.min(n[a] - 1, Math.max(0, Math.floor((mx - lo[a]) / cell)));
		}
		for (var cz = box[6 * t + 2]; cz <= box[6 * t + 5]; cz++)
			for (var cy = box[6 * t + 1]; cy <= box[6 * t + 4]; cy++)
				for (var cx = box[6 * t]; cx <= box[6 * t + 3]; cx++) {
					var key = cx + nx * (cy + ny * cz), sl = slot.get(key);
					if (sl === undefined) { sl = counts.length; slot.set(key, sl); counts.push(0); }
					counts[sl]++;
				}
	}
	var C = counts.length, start = new Int32Array(C + 1);
	for (var c = 0; c < C; c++) start[c + 1] = start[c] + counts[c];
	var tris = new Int32Array(start[C]), fill = start.slice(0, C);
	for (var u = 0; u < T; u++) {
		for (var zz = box[6 * u + 2]; zz <= box[6 * u + 5]; zz++)
			for (var yy = box[6 * u + 1]; yy <= box[6 * u + 4]; yy++)
				for (var xx = box[6 * u]; xx <= box[6 * u + 3]; xx++) tris[fill[slot.get(xx + nx * (yy + ny * zz))]++] = u;
	}
	return { min: lo, cell: cell, n: n, slot: slot, start: start, tris: tris, P: P, stamp: new Int32Array(T), ray: 0 };
}

// Moller-Trumbore: ray parameter t of the hit on triangle i, or -1
function hitT(P, i, ox, oy, oz, dx, dy, dz) {
	var b = 9 * i;
	var e1x = P[b + 3] - P[b], e1y = P[b + 4] - P[b + 1], e1z = P[b + 5] - P[b + 2];
	var e2x = P[b + 6] - P[b], e2y = P[b + 7] - P[b + 1], e2z = P[b + 8] - P[b + 2];
	var px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
	var det = e1x * px + e1y * py + e1z * pz;
	var eps = 1e-12 * Math.hypot(e1x, e1y, e1z) * Math.hypot(e2x, e2y, e2z);
	if (!(Math.abs(det) > eps)) return -1;
	var inv = 1 / det;
	var tx = ox - P[b], ty = oy - P[b + 1], tz = oz - P[b + 2];
	var u = (tx * px + ty * py + tz * pz) * inv;
	if (u < 0 || u > 1) return -1;
	var qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
	var v = (dx * qx + dy * qy + dz * qz) * inv;
	if (v < 0 || u + v > 1) return -1;
	return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

/**
 * Does the ray o + t d hit any triangle other than skip at tMin < t <= tMax?
 * Pass a unit d so that tMin and tMax are distances; tMax defaults to
 * the edge of the grid.
 * @returns {boolean}
 */
export function rayHits(grid, soup, ox, oy, oz, dx, dy, dz, tMin, skip, tMax) {
	var tEnd = tMax > 0 ? tMax : Infinity;
	var lo = grid.min, cell = grid.cell, n = grid.n, nx = n[0], ny = n[1], nz = n[2];
	var ix = Math.floor((ox - lo[0]) / cell), iy = Math.floor((oy - lo[1]) / cell), iz = Math.floor((oz - lo[2]) / cell);
	if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return false;
	var ray = ++grid.ray, stamp = grid.stamp, slot = grid.slot, start = grid.start, tris = grid.tris, P = grid.P;
	var sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0, sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
	if (!sx && !sy && !sz) return false;
	var tmx = sx ? (lo[0] + (ix + (sx > 0 ? 1 : 0)) * cell - ox) / dx : Infinity;
	var tmy = sy ? (lo[1] + (iy + (sy > 0 ? 1 : 0)) * cell - oy) / dy : Infinity;
	var tmz = sz ? (lo[2] + (iz + (sz > 0 ? 1 : 0)) * cell - oz) / dz : Infinity;
	var tdx = sx ? cell / Math.abs(dx) : Infinity, tdy = sy ? cell / Math.abs(dy) : Infinity, tdz = sz ? cell / Math.abs(dz) : Infinity;
	for (;;) {
		var c = slot.get(ix + nx * (iy + ny * iz));
		if (c !== undefined) {
			for (var k = start[c]; k < start[c + 1]; k++) {
				var t = tris[k];
				if (stamp[t] === ray) continue;
				stamp[t] = ray;
				if (t === skip) continue;
				var th = hitT(P, t, ox, oy, oz, dx, dy, dz);
				if (th > tMin && th <= tEnd) return true;
			}
		}
		// step into the next cell; stop once it starts past tEnd
		if (tmx <= tmy && tmx <= tmz) { if (tmx > tEnd) return false; ix += sx; tmx += tdx; if (ix < 0 || ix >= nx) return false; }
		else if (tmy <= tmz) { if (tmy > tEnd) return false; iy += sy; tmy += tdy; if (iy < 0 || iy >= ny) return false; }
		else { if (tmz > tEnd) return false; iz += sz; tmz += tdz; if (iz < 0 || iz >= nz) return false; }
	}
}

// Seeded random source (mulberry32): the same mesh gets the same vote
function mulberry32(seed) {
	var a = seed >>> 0;
	return function () {
		a = (a + 0x6D2B79F5) >>> 0;
		var t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function crossOf(t) {
	var ax = t.v1.x - t.v0.x, ay = t.v1.y - t.v0.y, az = t.v1.z - t.v0.z;
	var bx = t.v2.x - t.v0.x, by = t.v2.y - t.v0.y, bz = t.v2.z - t.v0.z;
	return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

function flip(t) {
	var x = t.v1; t.v1 = t.v2; t.v2 = x;
}

var MIN_HITS = 0.1;

/**
 * Give each "unresolved" component of an orientMesh result a sign by
 * the ray vote: normals point to the side whose rays come back. The
 * winding is changed in place; perComponent entries the vote decides get
 * method "visibility", and every voted entry gets margin
 * |H+ - H-| / (H+ + H-). A component stays "unresolved" when
 * margin < minMargin or neither side's rays come back 10% of the time.
 * @param {{soup: Array<Object>}} bms - oriented by orientMesh
 * @param {ReturnType<import("./orientMesh.js").orientMesh>} orientation - its result (needs componentOf)
 * @param {{samples?: number, rays?: number, minMargin?: number}} [options] - defaults 1000, 8, 0.2
 * @returns {ReturnType<import("./orientMesh.js").orientMesh>} the same object, updated
 */
export function orientByVisibility(bms, orientation, options) {
	var opts = options || {};
	var samples = opts.samples > 0 ? opts.samples : 1000;
	var rays = opts.rays > 0 ? opts.rays : 8;
	var minMargin = typeof opts.minMargin === "number" ? opts.minMargin : 0.2;
	var pc = orientation.perComponent, compOf = orientation.componentOf, soup = bms.soup;
	var todo = [];
	for (var c = 0; c < pc.length; c++) if (pc[c].method === "unresolved") todo.push(c);
	if (todo.length === 0) return orientation;

	var members = todo.map(function () { return []; }), slot = new Int32Array(pc.length).fill(-1);
	todo.forEach(function (c, k) { slot[c] = k; });
	for (var t = 0; t < soup.length; t++) { var s = slot[compOf[t]]; if (s >= 0) members[s].push(t); }

	var mean = meanEdgeLength(soup);
	var grid = buildTriangleGrid(soup, 2 * mean);
	var rnd = mulberry32(12345);

	todo.forEach(function (c, k) {
		var mem = members[k], cum = new Float64Array(mem.length), total = 0;
		for (var i = 0; i < mem.length; i++) {
			var n = crossOf(soup[mem[i]]);
			total += Math.hypot(n[0], n[1], n[2]);
			cum[i] = total;
		}
		if (!(total > 0)) return;
		// rays reach twice the component's own size: its opposite wall is
		// within that, and a far stray triangle is not walked to
		var bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
		for (var b = 0; b < mem.length; b++) {
			var w = soup[mem[b]], vv = [w.v0, w.v1, w.v2];
			for (var e = 0; e < 3; e++) {
				var p = vv[e];
				if (p.x < bx0) bx0 = p.x; if (p.x > bx1) bx1 = p.x;
				if (p.y < by0) by0 = p.y; if (p.y > by1) by1 = p.y;
				if (p.z < bz0) bz0 = p.z; if (p.z > bz1) bz1 = p.z;
			}
		}
		var reach = Math.max(2 * Math.hypot(bx1 - bx0, by1 - by0, bz1 - bz0), 4 * mean);
		var m = Math.min(samples, mem.length), hp = 0, hm = 0;
		for (var j = 0; j < m; j++) {
			// draw a triangle by area
			var r = rnd() * total, lo = 0, hi = mem.length - 1;
			while (lo < hi) { var mid = (lo + hi) >> 1; if (cum[mid] > r) hi = mid; else lo = mid + 1; }
			var ti = mem[lo], tr = soup[ti], nn = crossOf(tr), len = Math.hypot(nn[0], nn[1], nn[2]);
			var nx = nn[0] / len, ny = nn[1] / len, nz = nn[2] / len;
			// frame e1, e2 perpendicular to n
			var ax = Math.abs(nx) < 0.9 ? 1 : 0, ay = ax ? 0 : 1;
			var e1x = ny * 0 - nz * ay, e1y = nz * ax - nx * 0, e1z = nx * ay - ny * ax;
			var el = Math.hypot(e1x, e1y, e1z); e1x /= el; e1y /= el; e1z /= el;
			var e2x = ny * e1z - nz * e1y, e2y = nz * e1x - nx * e1z, e2z = nx * e1y - ny * e1x;
			var ox = (tr.v0.x + tr.v1.x + tr.v2.x) / 3, oy = (tr.v0.y + tr.v1.y + tr.v2.y) / 3, oz = (tr.v0.z + tr.v1.z + tr.v2.z) / 3;
			for (var side = 1; side >= -1; side -= 2) {
				var hits = 0;
				for (var q = 0; q < rays; q++) {
					// cosine-weighted direction in the hemisphere around side * n
					var u1 = rnd(), phi = 2 * Math.PI * rnd(), rr = Math.sqrt(u1), h = side * Math.sqrt(1 - u1);
					var dx = rr * Math.cos(phi) * e1x + rr * Math.sin(phi) * e2x + h * nx;
					var dy = rr * Math.cos(phi) * e1y + rr * Math.sin(phi) * e2y + h * ny;
					var dz = rr * Math.cos(phi) * e1z + rr * Math.sin(phi) * e2z + h * nz;
					if (rayHits(grid, soup, ox, oy, oz, dx, dy, dz, mean, ti, reach)) hits++;
				}
				if (side > 0) hp += hits / rays; else hm += hits / rays;
			}
		}
		hp /= m; hm /= m;
		var margin = hp + hm > 0 ? Math.abs(hp - hm) / (hp + hm) : 0;
		pc[c].margin = Math.round(margin * 1000) / 1000;
		if (Math.max(hp, hm) < MIN_HITS || margin < minMargin) return;
		if (hm > hp) mem.forEach(function (ti) { flip(soup[ti]); });
		pc[c].method = "visibility";
	});

	var methods = new Set(pc.map(function (p) { return p.method; }));
	orientation.orientation = methods.size === 1 ? pc[0].method : methods.size === 0 ? "unresolved" : "mixed";
	return orientation;
}
