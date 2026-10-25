// test/fixtures/synthetic.js
//=============================================================
// SYNTHETIC CLOUDS — seeded, roughly even spacing, for tests
//=============================================================
// Each generator returns las-laz-js style columns:
//   { count, positions: Float64Array(3 * count) }
// Shapes stand in for real underground scans: a closed void
// (sphere), an open drive (tunnel, half-pipe), close parallel
// walls (bridging guard) and a void with a missing cap (holes).
//=============================================================

/**
 * Seeded PRNG (mulberry32). Returns a function giving floats in [0, 1).
 * @param {number} seed
 * @returns {function(): number}
 */
export function mulberry32(seed) {
	var a = seed >>> 0;
	return function () {
		a = (a + 0x6D2B79F5) >>> 0;
		var t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function toCols(list) {
	var n = list.length / 3;
	return { count: n, positions: Float64Array.from(list) };
}

/**
 * Evenly spread points on a sphere (Fibonacci lattice).
 * @param {number} n
 * @param {number} r
 * @param {[number, number, number]} [centre]
 */
export function fibonacciSphere(n, r, centre) {
	var c = centre || [0, 0, 0];
	var out = [];
	var golden = Math.PI * (3 - Math.sqrt(5));
	for (var i = 0; i < n; i++) {
		var y = 1 - (2 * (i + 0.5)) / n;
		var rad = Math.sqrt(1 - y * y);
		var th = golden * i;
		out.push(c[0] + r * rad * Math.cos(th), c[1] + r * y, c[2] + r * rad * Math.sin(th));
	}
	return toCols(out);
}

/**
 * Fibonacci sphere with the polar cap (angle from +Y below capAngle) removed.
 * @param {number} n
 * @param {number} r
 * @param {number} capAngle - radians
 */
export function sphereWithCap(n, r, capAngle) {
	var full = fibonacciSphere(n, r);
	var out = [];
	var p = full.positions;
	for (var i = 0; i < full.count; i++) {
		var y = p[3 * i + 1] / r;
		if (Math.acos(Math.max(-1, Math.min(1, y))) < capAngle) continue;
		out.push(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
	}
	return toCols(out);
}

/**
 * Cylinder open at both ends, axis along +X from x = 0 to x = length.
 * Points sit on a jittered ring grid.
 */
export function cylinderTunnel(radius, length, spacing, seed) {
	var rnd = mulberry32(seed);
	var nRing = Math.max(8, Math.round((2 * Math.PI * radius) / spacing));
	var nLen = Math.max(2, Math.round(length / spacing) + 1);
	var dx = length / (nLen - 1);
	var out = [];
	for (var i = 0; i < nLen; i++) {
		for (var j = 0; j < nRing; j++) {
			var jit = (rnd() - 0.5) * 0.2;
			var th = ((j + (i % 2) * 0.5 + jit) / nRing) * 2 * Math.PI;
			var x = i * dx + (i > 0 && i < nLen - 1 ? (rnd() - 0.5) * 0.2 * dx : 0);
			out.push(x, radius * Math.cos(th), radius * Math.sin(th));
		}
	}
	return toCols(out);
}

/**
 * Upper half of a cylinder (an arched drive), axis along +X.
 * The crown is the line y = 0, z = radius.
 */
export function halfPipe(radius, length, spacing, seed) {
	var rnd = mulberry32(seed);
	var nArc = Math.max(4, Math.round((Math.PI * radius) / spacing));
	var nLen = Math.max(2, Math.round(length / spacing) + 1);
	var dx = length / (nLen - 1);
	var out = [];
	for (var i = 0; i < nLen; i++) {
		for (var j = 0; j <= nArc; j++) {
			var off = (i % 2) * 0.5;
			var t = (j + off) / nArc;
			if (t > 1) continue;
			if (j > 0 && j < nArc) t += (rnd() - 0.5) * 0.2 / nArc;
			var th = t * Math.PI;
			var x = i * dx + (i > 0 && i < nLen - 1 ? (rnd() - 0.5) * 0.2 * dx : 0);
			out.push(x, radius * Math.cos(th), radius * Math.sin(th));
		}
	}
	return toCols(out);
}

/**
 * Two square walls, z = 0 and z = gap, each size x size, jittered grid.
 */
export function parallelWalls(gap, size, spacing, seed) {
	var rnd = mulberry32(seed);
	var n = Math.round(size / spacing) + 1;
	var out = [];
	for (var w = 0; w < 2; w++) {
		for (var i = 0; i < n; i++) {
			for (var j = 0; j < n; j++) {
				out.push(
					i * spacing + (rnd() - 0.5) * 0.2 * spacing,
					j * spacing + (rnd() - 0.5) * 0.2 * spacing,
					w * gap
				);
			}
		}
	}
	return toCols(out);
}

/**
 * Regular planar grid in z = 0 (no jitter). Handy for exact spacing checks.
 */
export function planarGrid(nx, ny, spacing) {
	var out = [];
	for (var i = 0; i < nx; i++) for (var j = 0; j < ny; j++) out.push(i * spacing, j * spacing, 0);
	return toCols(out);
}
