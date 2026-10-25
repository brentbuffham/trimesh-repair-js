// trimesh-repair-js src/indexed.js
//=============================================================
// THE INDEXED LEVEL: { positions: Float64Array (world xyz), index: Uint32Array } in and out - the
// form toIndexed returns and Kirra (kirra-design.com) stores. Built on the BMS-level calls beside it;
// never mutates its input. Moved from Kirra's src/meshRepair/indexed.js (0.1.0).
//
// Names: the library level already owns patchLoop / patchLoops (trimesh-build-js signatures), so the
// indexed patch call is patchMeshLoops (aiPlans/20261024-2300, decision 1).
//
// Created: 2026-10-24
//=============================================================

import { ingestToBMS } from "./bms/ingestToBMS.js";
import { orientMesh } from "./bms/orientMesh.js";
import { validateMesh } from "./validate/validateMesh.js";
import { patchLoop } from "./post/patchLoop.js";
import { fillOpenEdgeLoops } from "trimesh-boolean";
import { sortedEdgeKeys, hasRepeatedDirectedEdge } from "./edgeKeys.js";

/** Default weld distance for an indexed mesh: 1 mm (its vertices are already shared by index). */
export var DEFAULT_TOLERANCE = 0.001;

function tol(opts) {
	return opts && opts.tolerance != null ? opts.tolerance : DEFAULT_TOLERANCE;
}

/**
 * A library-level result (as trimesh-build-js's buildMesh returns) from an indexed world mesh:
 * welded into a BMS origin-shifted to its first vertex (Float64 stays exact at UTM), then oriented
 * and validated by the library's own stages. Break-line edges are not known to an indexed mesh.
 * @param {Float64Array} positions world xyz
 * @param {Uint32Array} index
 * @param {number} tolerance weld distance
 * @returns {Object} {pool, soup, origin, constraintPoolEdges, viewpoints, mesh, report}
 */
export function bmsFromIndexed(positions, index, tolerance) {
	var o = { x: positions[0], y: positions[1], z: positions[2] };
	var local = new Float64Array(positions.length);
	for (var i = 0; i < positions.length; i += 3) {
		local[i] = positions[i] - o.x;
		local[i + 1] = positions[i + 1] - o.y;
		local[i + 2] = positions[i + 2] - o.z;
	}
	var bms = ingestToBMS(local, index, tolerance);
	bms.origin = o;
	bms.tolerance = tolerance;
	bms.constraintPoolEdges = new Set();
	var orient = orientMesh(bms, null);
	return {
		pool: bms.pool,
		soup: bms.soup,
		idToPool: bms.idToPool,
		origin: o,
		constraintPoolEdges: bms.constraintPoolEdges,
		viewpoints: null,
		mesh: validateMesh(bms, orient.orientation),
		report: { tolerance: tolerance, foldsRemoved: 0, pointsUsed: positions.length / 3 }
	};
}

/**
 * The mesh facts of a library-level result, with the open loops as world xyz polylines.
 * @param {Object} result
 * @returns {{closed, volume, openLoops, loops: Float64Array[], nonManifoldEdges, boundaryEdges, triangles}}
 */
export function summaryOfResult(result) {
	var mesh = result.mesh;
	var o = result.origin || { x: 0, y: 0, z: 0 };
	var byId = result.pool.getAll();
	var loops = mesh.boundaryLoops.map(function (ids) {
		var a = new Float64Array(3 * ids.length);
		for (var i = 0; i < ids.length; i++) {
			var v = byId[ids[i]];
			a[3 * i] = v.x + o.x;
			a[3 * i + 1] = v.y + o.y;
			a[3 * i + 2] = v.z + o.z;
		}
		return a;
	});
	return {
		triangles: result.soup.length,
		closed: !!mesh.closed,
		volume: mesh.enclosedVolume == null ? null : mesh.enclosedVolume,
		openLoops: loops.length,
		loops: loops,
		nonManifoldEdges: mesh.nonManifoldEdgeCount,
		boundaryEdges: mesh.boundaryEdgeCount
	};
}

/**
 * Is it closed, what volume does it enclose, where are its open loops.
 * @param {{positions: Float64Array, index: Uint32Array}} mesh
 * @param {{tolerance?: number}} [opts]
 */
export function checkMesh(mesh, opts) {
	return summaryOfResult(bmsFromIndexed(mesh.positions, mesh.index, tol(opts)));
}

/** The open boundary loops, as world xyz polylines. */
export function findOpenLoops(mesh, opts) {
	return checkMesh(mesh, opts).loops;
}

/**
 * Patch open loops of an indexed mesh and return the patched mesh (the input is not changed).
 * @param {{positions: Float64Array, index: Uint32Array}} mesh
 * @param {number|number[]|Array|"all"} which a loop index (checkMesh order), a list of them, world
 *   points along one loop, or "all" (every loop of at most opts.maxEdges edges)
 * @param {{method?: string, maxEdges?: number, tolerance?: number}} [opts] method: auto | fair | fan |
 *   centroid | vertexFan (default auto)
 * @returns {{mesh: {positions, index}, patched: number, refused: Array<{loop, reason}>, methods: Object}}
 */
export function patchMeshLoops(mesh, which, opts) {
	// Through patchMeshLoopsLocal: the caller's triangles are kept as they are and the patch is wound
	// with its neighbours. The whole-mesh path re-oriented EVERYTHING with trimesh-build's cave
	// convention (closed = normals inward), so an outward solid came back inside-out (Phase A final
	// review I4). A loop index is in findOpenLoops order; each listed loop is patched in turn.
	opts = opts || {};
	if (typeof which === "number") which = [which];
	var indexList = Array.isArray(which) && which.length > 0 && which.every(function (w) { return Number.isInteger(w); });
	if (!indexList) {
		var r = patchMeshLoopsLocal(mesh, which, opts);
		return { mesh: r.mesh, patched: r.patched, refused: r.refused, methods: r.methods };
	}
	var loops = findOpenLoops(mesh), cur = mesh, patched = 0, refused = [], methods = {};
	which.forEach(function (i) {
		var lp = loops[i];
		if (!lp) { refused.push({ loop: i, reason: "No open loop " + i + "." }); return; } // i18n-ignore: library text, shown as the reason
		var pts = [];
		for (var k = 0; k + 2 < lp.length; k += 3) pts.push([lp[k], lp[k + 1], lp[k + 2]]);
		var one = patchMeshLoopsLocal(cur, pts, opts);
		cur = one.mesh;
		patched += one.patched;
		refused = refused.concat(one.refused);
		Object.keys(one.methods).forEach(function (m) { methods[m] = (methods[m] || 0) + one.methods[m]; });
	});
	return { mesh: cur, patched: patched, refused: refused, methods: methods };
}

// Soup ({v0, v1, v2}, the form trimesh-boolean's repairs take) <-> indexed. A corner shared by index is
// one vertex object; back from a soup, corners at the SAME xyz are one vertex (exact, no tolerance).
export function soupOfIndexed(positions, index) {
	var pts = new Array(positions.length / 3);
	for (var p = 0, k = 0; p < positions.length; p += 3, k++) pts[k] = { x: positions[p], y: positions[p + 1], z: positions[p + 2] };
	var soup = new Array(index.length / 3);
	for (var t = 0, m = 0; t < index.length; t += 3, m++) soup[m] = { v0: pts[index[t]], v1: pts[index[t + 1]], v2: pts[index[t + 2]] };
	return soup;
}

export function indexedOfSoup(soup) {
	var ids = new Map(), xyz = [], index = new Uint32Array(3 * soup.length);
	function id(v) {
		var my = ids.get(v.x); if (!my) { my = new Map(); ids.set(v.x, my); }
		var mz = my.get(v.y); if (!mz) { mz = new Map(); my.set(v.y, mz); }
		var i = mz.get(v.z);
		if (i === undefined) { i = xyz.length / 3; mz.set(v.z, i); xyz.push(v.x, v.y, v.z); }
		return i;
	}
	for (var t = 0; t < soup.length; t++) {
		index[3 * t] = id(soup[t].v0);
		index[3 * t + 1] = id(soup[t].v1);
		index[3 * t + 2] = id(soup[t].v2);
	}
	return { positions: Float64Array.from(xyz), index: index };
}

/**
 * Fill every closed open loop on an indexed mesh: trimesh-boolean's fillOpenEdgeLoops caps each one.
 * @param {{positions: Float64Array, index: Uint32Array}} mesh
 * @returns {{positions: Float64Array, index: Uint32Array}}
 */
export function fillOpenEdges(mesh) {
	return indexedOfSoup(fillOpenEdgeLoops(soupOfIndexed(mesh.positions, mesh.index)));
}

// ---------------------------------------------------------------------------------------------
// The report without a BMS (aiPlans/20261025-0300 Task 6, issue #138). Phase 1: the BMS read of
// the 8.6 M-triangle WALL mesh took 61 s and ~1 GB to find ONE 30-edge loop.
//   1. edge census on the raw indices (sorted keys, EdgeKeys.js);
//   2. weld at the tolerance ONLY the vertices on open edges - a crack can close only where open
//      edges meet - and recount just those edges (two open edges welded together are shared);
//   3. chain the open edges into loops; closed = no open and no non-manifold edge;
//   4. volume when closed: the signed sum over the index (origin-shifted, Float64). A face wound
//      against its neighbour makes that sum meaningless - then the BMS read (which orients) answers.
// Same result shape as summaryOfResult; loopIds (vertex ids per loop) feed patchMeshLoopsLocal.
// ---------------------------------------------------------------------------------------------

// Weld the given vertices within tol (first come wins; cells of 2 x tol, 27 neighbours searched).
// Cell keys are numbers; past 2^17 cells an axis two cells can share a key - that only adds
// candidates, every candidate is distance-checked.
function weldSome(positions, ids, tol) {
	var rep = new Map(), cells = new Map(), tolSq = tol * tol, cs = tol * 2;
	if (!ids.length) return rep;
	var x0 = positions[3 * ids[0]], y0 = positions[3 * ids[0] + 1], z0 = positions[3 * ids[0] + 2];
	function key(cx, cy, cz) { return (cx * 131072 + cy) * 131072 + cz; }
	for (var i = 0; i < ids.length; i++) {
		var v = ids[i], x = positions[3 * v], y = positions[3 * v + 1], z = positions[3 * v + 2];
		var cx = Math.floor((x - x0) / cs), cy = Math.floor((y - y0) / cs), cz = Math.floor((z - z0) / cs);
		var found = -1;
		for (var dx = -1; dx <= 1 && found < 0; dx++) for (var dy = -1; dy <= 1 && found < 0; dy++) for (var dz = -1; dz <= 1 && found < 0; dz++) {
			var list = cells.get(key(cx + dx, cy + dy, cz + dz));
			if (!list) continue;
			for (var k = 0; k < list.length; k++) {
				var u = list[k], ex = positions[3 * u] - x, ey = positions[3 * u + 1] - y, ez = positions[3 * u + 2] - z;
				if (ex * ex + ey * ey + ez * ez <= tolSq) { found = u; break; }
			}
		}
		if (found >= 0) { rep.set(v, found); continue; }
		rep.set(v, v);
		var kk = key(cx, cy, cz), l = cells.get(kk);
		if (!l) { l = []; cells.set(kk, l); }
		l.push(v);
	}
	return rep;
}

// Chain undirected edges (pairs) into closed loops of vertex ids; consumes EDGES, so a pinch vertex
// where two loops touch gives two loops (as extractBoundaryLoopsIndexed does).
function chainLoops(pairs) {
	var inc = new Map(), used = new Uint8Array(pairs.length / 2), loops = [];
	function add(v, e) { var a = inc.get(v); if (!a) { a = []; inc.set(v, a); } a.push(e); }
	for (var e = 0; e < pairs.length / 2; e++) { add(pairs[2 * e], e); add(pairs[2 * e + 1], e); }
	for (var s = 0; s < used.length; s++) {
		if (used[s]) continue;
		used[s] = 1;
		var start = pairs[2 * s], loop = [start], cur = pairs[2 * s + 1], closed = false, guard = used.length + 1;
		var at = new Map([[start, 0]]);
		while (guard-- > 0) {
			if (cur === start) { closed = true; break; }
			if (at.has(cur)) {
				// back at a pinch vertex already on this walk: the part since then is a loop of its own
				var j = at.get(cur), cycle = loop.slice(j);
				if (cycle.length >= 3) loops.push(cycle);
				for (var c = j + 1; c < loop.length; c++) at.delete(loop[c]);
				loop.length = j + 1;
			} else {
				at.set(cur, loop.length);
				loop.push(cur);
			}
			var list = inc.get(cur), next = -1;
			for (var i = 0; list && i < list.length; i++) if (!used[list[i]]) { next = list[i]; break; }
			if (next < 0) break;
			used[next] = 1;
			cur = pairs[2 * next] === cur ? pairs[2 * next + 1] : pairs[2 * next];
		}
		if (closed && loop.length >= 3) loops.push(loop);
	}
	return loops;
}

/**
 * The repair report of an indexed mesh, from its typed arrays (no BMS unless the winding is not
 * coherent on a closed mesh).
 * @param {{positions: Float64Array, index: Uint32Array}} mesh
 * @param {{tolerance?: number}} [opts]
 * @returns {{triangles, closed, volume, openLoops, loops: Float64Array[], loopIds: number[][], nonManifoldEdges, boundaryEdges}}
 */
export function checkMeshIndexed(mesh, opts) {
	var positions = mesh.positions, index = mesh.index;
	var V = Math.floor(positions.length / 3), T = Math.floor(index.length / 3);
	var out = { triangles: T, closed: false, volume: null, openLoops: 0, loops: [], loopIds: [], nonManifoldEdges: 0, boundaryEdges: 0 };
	if (T === 0) return out;
	// 1. raw census
	var e = sortedEdgeKeys(index, V), keys = e.keys, n = keys.length;
	var open = [], nm = 0, i = 0;
	while (i < n) {
		var k = keys[i], run = 1;
		while (i + run < n && keys[i + run] === k) run++;
		if (run === 1) { var lh = e.decode(k); open.push(lh[0], lh[1]); }
		else if (run > 2) nm++;
		i += run;
	}
	keys = null;
	// 2. weld the open edges' vertices, recount those edges
	var weldMap = null; // from -> to, only for the vertices the weld moved
	if (open.length) {
		var seen = new Set(), ids = [];
		for (i = 0; i < open.length; i++) if (!seen.has(open[i])) { seen.add(open[i]); ids.push(open[i]); }
		var rep = weldSome(positions, ids, tol(opts));
		rep.forEach(function (to, from) { if (to !== from) { if (!weldMap) weldMap = new Map(); weldMap.set(from, to); } });
		var counts = new Map(), welded = [];
		for (i = 0; i < open.length; i += 2) {
			var a = rep.get(open[i]), b = rep.get(open[i + 1]);
			if (a === b) continue; // collapsed by the weld: no edge left
			var lo = a < b ? a : b, hi = a < b ? b : a, kk = lo * (V + 1) + hi;
			var c = counts.get(kk);
			if (!c) counts.set(kk, c = { lo: lo, hi: hi, n: 0 });
			c.n++;
		}
		counts.forEach(function (c) {
			if (c.n === 1) welded.push(c.lo, c.hi);
			else if (c.n > 2) nm++;
		});
		open = welded;
	}
	out.boundaryEdges = open.length / 2;
	out.nonManifoldEdges = nm;
	// 3. loops
	var loops = open.length ? chainLoops(open) : [];
	out.loopIds = loops;
	out.openLoops = loops.length;
	out.loops = loops.map(function (ids) {
		var a = new Float64Array(3 * ids.length);
		for (var j = 0; j < ids.length; j++) { a[3 * j] = positions[3 * ids[j]]; a[3 * j + 1] = positions[3 * ids[j] + 1]; a[3 * j + 2] = positions[3 * ids[j] + 2]; }
		return a;
	});
	out.closed = out.boundaryEdges === 0 && nm === 0;
	// 4. volume
	if (out.closed) {
		// closed only through the weld: winding and volume are judged on the welded index
		var rawIndex = index;
		if (weldMap) {
			var widx = new Uint32Array(index.length);
			for (i = 0; i < index.length; i++) { var w = weldMap.get(index[i]); widx[i] = w !== undefined ? w : index[i]; }
			index = widx;
		}
		if (hasRepeatedDirectedEdge(index, V)) {
			out.volume = summaryOfResult(bmsFromIndexed(positions, rawIndex, tol(opts))).volume;
		} else {
			var ox = positions[0], oy = positions[1], oz = positions[2], vol = 0;
			for (var t = 0; t < T; t++) {
				var p = 3 * index[3 * t], q = 3 * index[3 * t + 1], r = 3 * index[3 * t + 2];
				var ax = positions[p] - ox, ay = positions[p + 1] - oy, az = positions[p + 2] - oz;
				var bx = positions[q] - ox, by = positions[q + 1] - oy, bz = positions[q + 2] - oz;
				var cx = positions[r] - ox, cy = positions[r + 1] - oy, cz = positions[r + 2] - oz;
				vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
			}
			out.volume = Math.abs(vol) / 6;
		}
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// Patch from the hole's surroundings (aiPlans/20261025-0300 Task 7, issue #138). Each target loop:
// the triangles within `rings` rings of its vertices make a small mesh; the library patches THAT
// (bmsFromIndexed + patchLoop, as patchMeshLoops does for the whole mesh); the triangles it added
// are mapped back (same pool vertex -> same mesh vertex; new points appended) and wound with their
// neighbours. A patch that would change the triangles around the hole is refused - only added
// triangles ever leave here. Each loop's ring is taken from the ORIGINAL mesh: two holes whose rings
// overlap are each patched once, the other hole reading as open in the ring (Review Focus 4).
// ---------------------------------------------------------------------------------------------

// vertex -> triangles, as CSR over a typed index
function vertexTriangles(index, V) {
	var T = index.length / 3, count = new Uint32Array(V + 1), i;
	for (i = 0; i < index.length; i++) count[index[i] + 1]++;
	for (i = 0; i < V; i++) count[i + 1] += count[i];
	var fill = count.slice(0, V), list = new Uint32Array(index.length);
	for (var t = 0; t < T; t++) for (var c = 0; c < 3; c++) { var v = index[3 * t + c]; list[fill[v]++] = t; }
	return { start: count, list: list };
}

function pointsOf(which) {
	return which.map(function (p) { return Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : p; });
}

function triKey(tv) { var s = tv.slice().sort(function (a, b) { return a - b; }); return s[0] + "," + s[1] + "," + s[2]; }

// the key of a triangle over pool vertices; null when two corners are one pool vertex (degenerate)
function poolTriKey(a, b, c) {
	if (!a || !b || !c || a.id === b.id || b.id === c.id || c.id === a.id) return null;
	return triKey([a.id, b.id, c.id]);
}

// true: the patch traverses a shared edge opposite to its existing neighbour (wound together);
// false: the same way (flip the patch); null: no shared edge found
function windsWithNeighbour(added, trisAt, triOf) {
	var mine = new Set(added.map(triKey));
	for (var i = 0; i < added.length; i++) {
		for (var e = 0; e < 3; e++) {
			var a = added[i][e], b = added[i][(e + 1) % 3];
			var near = trisAt(a);
			for (var k = 0; k < near.length; k++) {
				var tv = triOf(near[k]);
				if (mine.has(triKey(tv))) continue;
				for (var j = 0; j < 3; j++) {
					var p = tv[j], q = tv[(j + 1) % 3];
					if (p === b && q === a) return true;
					if (p === a && q === b) return false;
				}
			}
		}
	}
	return null;
}

/**
 * Patch open loops of an indexed mesh from each loop's surroundings; the input is not changed.
 * @param {{positions: Float64Array, index: Uint32Array}} mesh
 * @param {number[]|Array|"all"} which - loop indices (checkMeshIndexed order), world points along ONE
 *   loop ([x,y,z] or {x,y,z}), or "all" (every loop of at most opts.maxEdges edges)
 * @param {{method?: string, maxEdges?: number, tolerance?: number, rings?: number, report?: Object}} [opts]
 *   report: a checkMeshIndexed result for this mesh, if the caller has one
 * @returns {{mesh: {positions, index}, added: Float64Array, patched: number, refused: Array<{loop, reason}>,
 *   methods: Object, stats: {largestSubmesh: number}}} added: 9 world coordinates per added triangle
 */
export function patchMeshLoopsLocal(mesh, which, opts) {
	opts = opts || {};
	var method = opts.method || "auto", rings = opts.rings != null ? opts.rings : 2, tl = tol(opts);
	var positions = mesh.positions, index = mesh.index, V0 = positions.length / 3, T0 = index.length / 3;
	var report = opts.report || checkMeshIndexed(mesh, opts);
	var refused = [], methods = {}, patched = 0, largest = 0;

	// the targets: vertex ids + world points of each loop
	var targets = [];
	if (which === "all") {
		var maxE = opts.maxEdges != null ? opts.maxEdges : Infinity;
		report.loopIds.forEach(function (ids, i) { if (ids.length <= maxE) targets.push({ ids: ids, pts: report.loops[i] }); });
	} else if (Array.isArray(which) && which.length && which.every(function (w) { return Number.isInteger(w); })) {
		which.forEach(function (i) { if (report.loopIds[i]) targets.push({ ids: report.loopIds[i], pts: report.loops[i] }); });
	} else if (Array.isArray(which) && which.length >= 3) {
		// the loop whose vertices the given points sit on (most points within tolerance)
		var pts = pointsOf(which), best = -1, bestHits = 0, tolSq = tl * tl * 4;
		report.loops.forEach(function (lp, i) {
			var hits = 0;
			for (var p = 0; p < pts.length; p++) {
				for (var q = 0; q < lp.length; q += 3) {
					var dx = lp[q] - pts[p].x, dy = lp[q + 1] - pts[p].y, dz = lp[q + 2] - pts[p].z;
					if (dx * dx + dy * dy + dz * dz <= tolSq) { hits++; break; }
				}
			}
			if (hits > bestHits) { bestHits = hits; best = i; }
		});
		if (best >= 0 && bestHits >= 3) targets.push({ ids: report.loopIds[best], pts: report.loops[best] });
		else refused.push({ loop: which, reason: "No open loop at those points." }); // i18n-ignore: worker text, shown as the reason
	}

	// rings come from the original mesh; new points and triangles are collected beside it
	var csr = vertexTriangles(index, V0);
	var newPos = [], newIdx = [];
	function posOf(v) {
		return v < V0 ? [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]] : [newPos[3 * (v - V0)], newPos[3 * (v - V0) + 1], newPos[3 * (v - V0) + 2]];
	}
	function triOf(t) { return [index[3 * t], index[3 * t + 1], index[3 * t + 2]]; }
	function trisAt(v) {
		var out = [];
		if (v < V0) for (var k = csr.start[v]; k < csr.start[v + 1]; k++) out.push(csr.list[k]);
		return out;
	}

	for (var ti = 0; ti < targets.length; ti++) {
		var tg = targets[ti];
		// 1. the ring
		var tris = new Set(), frontier = tg.ids.slice(), seenV = new Set(frontier);
		for (var r = 0; r <= rings; r++) {
			var next = [];
			for (var f = 0; f < frontier.length; f++) {
				trisAt(frontier[f]).forEach(function (t) {
					if (tris.has(t)) return;
					tris.add(t);
					triOf(t).forEach(function (v) { if (!seenV.has(v)) { seenV.add(v); next.push(v); } });
				});
			}
			frontier = next;
		}
		// 2. the small mesh
		var local = new Map(), subPos = [], subIdx = [];
		tris.forEach(function (t) {
			triOf(t).forEach(function (v) {
				if (!local.has(v)) { local.set(v, subPos.length / 3); var p = posOf(v); subPos.push(p[0], p[1], p[2]); }
				subIdx.push(local.get(v));
			});
		});
		largest = Math.max(largest, subIdx.length / 3);
		var res = bmsFromIndexed(Float64Array.from(subPos), Uint32Array.from(subIdx), tl);
		// compare in the library's own vertices (pool ids), not coordinates: a duplicate vertex and a
		// coordinate that does not survive the origin shift exactly both stay the same vertex
		var poolToGlobal = new Map(), inputKeys = new Set();
		local.forEach(function (li, v) { var pv = res.idToPool[li]; if (pv && !poolToGlobal.has(pv.id)) poolToGlobal.set(pv.id, v); });
		for (var si = 0; si < subIdx.length; si += 3) {
			var pk = poolTriKey(res.idToPool[subIdx[si]], res.idToPool[subIdx[si + 1]], res.idToPool[subIdx[si + 2]]);
			if (pk) inputKeys.add(pk);
		}
		var lp = [];
		for (var q = 0; q < tg.pts.length; q += 3) lp.push({ x: tg.pts[q], y: tg.pts[q + 1], z: tg.pts[q + 2] });
		var one = patchLoop(res, lp, { method: method });
		if (!(one.added > 0)) { refused = refused.concat(one.refused.length ? one.refused : [{ loop: lp, reason: "Nothing was added." }]); continue; } // i18n-ignore: worker text
		// 3. back to the growing mesh: a pool vertex from the ring -> its first mesh vertex; a pool
		// vertex the patch made -> a new point
		var freshOf = new Map(), freshPos = [], outKeys = new Set(), added = [];
		function gidOf(pv) {
			if (poolToGlobal.has(pv.id)) return poolToGlobal.get(pv.id);
			if (!freshOf.has(pv.id)) { freshOf.set(pv.id, -1 - freshPos.length / 3); freshPos.push(pv.x + res.origin.x, pv.y + res.origin.y, pv.z + res.origin.z); }
			return freshOf.get(pv.id);
		}
		for (var o = 0; o < res.soup.length; o++) {
			var st = res.soup[o], key = poolTriKey(st.v0, st.v1, st.v2);
			if (!key) continue; // collapsed by the weld: not a triangle
			outKeys.add(key);
			if (!inputKeys.has(key)) added.push([gidOf(st.v0), gidOf(st.v1), gidOf(st.v2)]);
		}
		var changed = false;
		inputKeys.forEach(function (key) { if (!outKeys.has(key)) changed = true; });
		if (changed) { refused.push({ loop: lp, reason: "The patch would change the triangles around the hole." }); continue; } // i18n-ignore: worker text
		// 4. fresh points get their ids; wind the patch with its neighbours
		var base = V0 + newPos.length / 3;
		for (var fp = 0; fp < freshPos.length; fp++) newPos.push(freshPos[fp]);
		added = added.map(function (tr) { return tr.map(function (v) { return v < 0 ? base + (-1 - v) : v; }); });
		if (windsWithNeighbour(added, trisAt, triOf) === false) added = added.map(function (tr) { return [tr[0], tr[2], tr[1]]; });
		added.forEach(function (tr) { newIdx.push(tr[0], tr[1], tr[2]); });
		patched++;
		if (one.method) methods[one.method] = (methods[one.method] || 0) + 1;
	}

	var outPos = new Float64Array(positions.length + newPos.length);
	outPos.set(positions);
	outPos.set(newPos, positions.length);
	var outIdx = new Uint32Array(index.length + newIdx.length);
	outIdx.set(index);
	outIdx.set(newIdx, index.length);
	var addedXYZ = new Float64Array(newIdx.length * 3);
	for (var w = 0; w < newIdx.length; w++) {
		var pp = posOf(newIdx[w]);
		addedXYZ[3 * w] = pp[0];
		addedXYZ[3 * w + 1] = pp[1];
		addedXYZ[3 * w + 2] = pp[2];
	}
	return { mesh: { positions: outPos, index: outIdx }, added: addedXYZ, patched: patched, refused: refused, methods: methods, stats: { largestSubmesh: largest } };
}
