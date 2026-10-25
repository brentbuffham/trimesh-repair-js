// examples/meshes.js
//=============================================================
// trimesh-repair-js demo: meshes with problems to fix. Each returns an indexed mesh
// { positions: Float64Array, index: Uint32Array } - the library's indexed level.
//=============================================================

// Build an indexed mesh from a vertex list and triangles, keeping only the triangles `keep` allows,
// and dropping vertices no triangle uses.
function indexed(verts, tris, keep) {
	var used = new Map(), pos = [], idx = [];
	function id(v) {
		var i = used.get(v);
		if (i === undefined) { i = pos.length / 3; used.set(v, i); pos.push(verts[3 * v], verts[3 * v + 1], verts[3 * v + 2]); }
		return i;
	}
	for (var t = 0; t < tris.length; t += 3) {
		if (keep && !keep(tris[t], tris[t + 1], tris[t + 2])) continue;
		idx.push(id(tris[t]), id(tris[t + 1]), id(tris[t + 2]));
	}
	return { positions: Float64Array.from(pos), index: Uint32Array.from(idx) };
}

// A closed UV sphere, wound outward, with ONE vertex at each pole; returns raw vertex / triangle arrays
function sphere(r, lat, lon) {
	var v = [0, 0, r], t = [];
	for (var i = 1; i < lat; i++) {
		var th = Math.PI * i / lat;
		for (var j = 0; j < lon; j++) {
			var ph = 2 * Math.PI * j / lon;
			v.push(r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th));
		}
	}
	v.push(0, 0, -r);
	var south = v.length / 3 - 1;
	// ring i (1 .. lat-1), column j; ring 0 is the north pole, ring lat the south pole
	var at = function (i, j) { return i === 0 ? 0 : i === lat ? south : 1 + (i - 1) * lon + (j % lon); };
	for (var a = 0; a < lat; a++) {
		for (var b = 0; b < lon; b++) {
			// the triangle that would have two pole corners is left out
			if (a < lat - 1) t.push(at(a, b), at(a + 1, b), at(a + 1, b + 1));
			if (a > 0) t.push(at(a, b), at(a + 1, b + 1), at(a, b + 1));
		}
	}
	return { v: v, t: t };
}

function centroidDir(v, a, b, c) {
	var x = v[3 * a] + v[3 * b] + v[3 * c], y = v[3 * a + 1] + v[3 * b + 1] + v[3 * c + 1], z = v[3 * a + 2] + v[3 * b + 2] + v[3 * c + 2];
	var l = Math.hypot(x, y, z) || 1;
	return [x / l, y / l, z / l];
}

/** A closed sphere with three holes of different sizes. */
export function sphereWithHoles() {
	var s = sphere(5, 24, 48);
	var holes = [[[1, 0, 0.3], 0.22], [[-0.5, 0.8, -0.2], 0.38], [[0, -0.7, -0.7], 0.55]].map(function (h) {
		var l = Math.hypot(h[0][0], h[0][1], h[0][2]);
		return [[h[0][0] / l, h[0][1] / l, h[0][2] / l], Math.cos(h[1])];
	});
	return indexed(s.v, s.t, function (a, b, c) {
		var d = centroidDir(s.v, a, b, c);
		return !holes.some(function (h) { return d[0] * h[0][0] + d[1] * h[0][1] + d[2] * h[0][2] > h[1]; });
	});
}

/** A terrain sheet with three holes. Its outer rim is a loop too: Patch all with an edge limit leaves it open. */
export function terrainWithHoles() {
	var n = 40, step = 0.5, v = [], t = [];
	for (var j = 0; j <= n; j++) for (var i = 0; i <= n; i++) v.push(i * step, j * step, 1.2 * Math.sin(i / 7) * Math.cos(j / 9));
	var at = function (i, j) { return j * (n + 1) + i; };
	var holes = [[8, 8, 1, 1], [20, 10, 3, 2], [12, 26, 4, 3]];
	for (var y = 0; y < n; y++) {
		for (var x = 0; x < n; x++) {
			var inHole = holes.some(function (h) { return x >= h[0] && x < h[0] + h[2] && y >= h[1] && y < h[1] + h[3]; });
			if (inHole) continue;
			t.push(at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y), at(x + 1, y + 1), at(x, y + 1));
		}
	}
	return indexed(v, t);
}

/** A 4 m cube (each face a 4 x 4 grid), wound outward, with its top face missing. Patched by fan it encloses
 *  64 m³ exactly; fair and auto add points faired into the walls, so the lid bulges and the volume is larger. */
export function cubeMissingFace() {
	var n = 4, size = 4, v = [], t = [], key = new Map();
	function vert(x, y, z) {
		var k = x + "," + y + "," + z, i = key.get(k);
		if (i === undefined) { i = v.length / 3; key.set(k, i); v.push(x * size / n, y * size / n, z * size / n); }
		return i;
	}
	// a face: origin o, axes u and w (u x w = outward normal)
	function face(o, u, w) {
		for (var a = 0; a < n; a++) {
			for (var b = 0; b < n; b++) {
				var p = function (da, db) { return vert(o[0] + u[0] * (a + da) + w[0] * (b + db), o[1] + u[1] * (a + da) + w[1] * (b + db), o[2] + u[2] * (a + da) + w[2] * (b + db)); };
				t.push(p(0, 0), p(1, 0), p(1, 1), p(0, 0), p(1, 1), p(0, 1));
			}
		}
	}
	face([0, 0, 0], [0, 1, 0], [1, 0, 0]); // bottom, -z
	face([0, 0, 0], [1, 0, 0], [0, 0, 1]); // y = 0, -y
	face([n, n, 0], [-1, 0, 0], [0, 0, 1]); // y = n, +y
	face([0, n, 0], [0, -1, 0], [0, 0, 1]); // x = 0, -x
	face([n, 0, 0], [0, 1, 0], [0, 0, 1]); // x = n, +x
	return indexed(v, t); // the top (z = n) is left out
}

/** A closed sphere whose upper half is wound the other way: the fold edges run round its middle. Orient fixes it. */
export function insideOutHalf() {
	var s = sphere(5, 20, 40), t = s.t.slice();
	for (var k = 0; k < t.length; k += 3) {
		if (centroidDir(s.v, t[k], t[k + 1], t[k + 2])[2] > 0.05) { var tmp = t[k + 1]; t[k + 1] = t[k + 2]; t[k + 2] = tmp; }
	}
	return indexed(s.v, t);
}

/** A Möbius band: a twisted strip no winding can make consistent. Repair folds cuts it. */
export function mobius() {
	var N = 48, v = [], t = [];
	for (var i = 0; i < N; i++) {
		var phi = 2 * Math.PI * i / N, th = Math.PI * i / N; // half a turn over the band
		var c = [10 * Math.cos(phi), 10 * Math.sin(phi), 0];
		var d = [Math.cos(th) * Math.cos(phi), Math.cos(th) * Math.sin(phi), Math.sin(th)];
		v.push(c[0] + 2 * d[0], c[1] + 2 * d[1], c[2] + 2 * d[2], c[0] - 2 * d[0], c[1] - 2 * d[1], c[2] - 2 * d[2]);
	}
	for (var s = 0; s < N; s++) {
		var a = 2 * s, b = 2 * s + 1;
		// c2 / d2: the next rung's top and bottom. The last rung joins the first with its ends
		// swapped - after half a turn the first rung's bottom is where the top would be.
		var last = s === N - 1, c2 = last ? 1 : 2 * (s + 1), d2 = last ? 0 : 2 * (s + 1) + 1;
		t.push(a, b, d2, a, d2, c2);
	}
	return indexed(v, t);
}

/** Read a Wavefront OBJ (v / f lines; polygons fanned to triangles). */
export function parseObj(text) {
	var pos = [], idx = [];
	text.split(/\r?\n/).forEach(function (line) {
		var p = line.trim().split(/\s+/);
		if (p[0] === "v" && p.length >= 4) pos.push(Number(p[1]), Number(p[2]), Number(p[3]));
		else if (p[0] === "f" && p.length >= 4) {
			var ids = p.slice(1).map(function (s) { var n = parseInt(s.split("/")[0], 10); return n < 0 ? pos.length / 3 + n : n - 1; });
			for (var k = 1; k + 1 < ids.length; k++) idx.push(ids[0], ids[k], ids[k + 1]);
		}
	});
	return { positions: Float64Array.from(pos), index: Uint32Array.from(idx) };
}

export var MESHES = {
	sphereHoles: { label: "Sphere with three holes", make: sphereWithHoles },
	terrain: { label: "Terrain with holes (open rim)", make: terrainWithHoles },
	cube: { label: "Cube missing its top", make: cubeMissingFace },
	insideOut: { label: "Sphere, upper half inside out", make: insideOutHalf },
	mobius: { label: "Möbius band (a fold)", make: mobius }
};
