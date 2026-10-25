// trimesh-repair-js src/edgeKeys.js - moved from Kirra's src/helpers/EdgeKeys.js (0.1.0)
//=============================================================
// EDGE KEYS - every triangle edge of an indexed mesh as one sortable key, so the same undirected
// edge sits together after a sort: open (used once), shared (twice), non-manifold (more).
// One copy for Kirra's edge census (IndexedSurfaceGeometry's countEdgesIndexed / uniqueEdgesIndexed)
// and the mesh repair front door (src/meshRepair/indexed.js checkMeshIndexed) - moved here from
// IndexedSurfaceGeometry.js (2026-10-25, aiPlans/20261025-0300 Task 6) so the front door, which
// runs in a worker and leaves for trimesh-repair-js, imports nothing that touches the page.
// Pure: no window, no DOM, no Three.js.
//=============================================================

// Largest radix P for which lo * P + hi (hi < P) stays exact in a float64: P * P <= 2^53.
var _MAX_FLOAT_RADIX = 94906265;

/**
 * Every triangle edge as a key, sorted, so equal keys (the same undirected edge) sit together.
 * The key is lo * P + hi in a Float64Array while that is exact; past ~94.9 M vertices two edges
 * could round to ONE float (a phantom shared edge), so it switches to an exact BigUint64Array key
 * lo << 32 | hi (aiPlans/20261025-0300 Review Focus 3). decode(k) gives [lo, hi] back.
 * @param {Uint32Array|ArrayLike<number>} index
 * @param {number} vertexCount
 * @returns {{keys: Float64Array|BigUint64Array, decode: function(*): number[]}}
 */
export function sortedEdgeKeys(index, vertexCount) {
	var T = (index.length / 3) | 0;
	var P = vertexCount + 1;                 // radix base; hi < P
	var n = 0, a, b, c, i;
	if (P <= _MAX_FLOAT_RADIX) {
		var keys = new Float64Array(T * 3);
		for (i = 0; i < T; i++) {
			a = index[i * 3]; b = index[i * 3 + 1]; c = index[i * 3 + 2];
			keys[n++] = (a < b ? a : b) * P + (a < b ? b : a);
			keys[n++] = (b < c ? b : c) * P + (b < c ? c : b);
			keys[n++] = (c < a ? c : a) * P + (c < a ? a : c);
		}
		keys.sort();
		return { keys: keys, decode: function (k) { var hi = k % P; return [(k - hi) / P, hi]; } };
	}
	var big = new BigUint64Array(T * 3);
	function bk(u, v) { return u < v ? (BigInt(u) << 32n) | BigInt(v) : (BigInt(v) << 32n) | BigInt(u); }
	for (i = 0; i < T; i++) {
		a = index[i * 3]; b = index[i * 3 + 1]; c = index[i * 3 + 2];
		big[n++] = bk(a, b);
		big[n++] = bk(b, c);
		big[n++] = bk(c, a);
	}
	big.sort();
	return { keys: big, decode: function (k) { return [Number(k >> 32n), Number(k & 0xffffffffn)]; } };
}


/**
 * Does any DIRECTED edge occur twice? On a coherently wound mesh two triangles sharing an edge
 * traverse it in opposite directions, so each directed edge a->b occurs once; a repeat means a
 * face is wound against its neighbour. Same exact-key rule as sortedEdgeKeys.
 * @param {Uint32Array|ArrayLike<number>} index
 * @param {number} vertexCount
 * @returns {boolean}
 */
export function hasRepeatedDirectedEdge(index, vertexCount) {
	var T = (index.length / 3) | 0;
	var P = vertexCount + 1, n = 0, i, a, b, c;
	var keys;
	if (P <= _MAX_FLOAT_RADIX) {
		keys = new Float64Array(T * 3);
		for (i = 0; i < T; i++) {
			a = index[i * 3]; b = index[i * 3 + 1]; c = index[i * 3 + 2];
			keys[n++] = a * P + b; keys[n++] = b * P + c; keys[n++] = c * P + a;
		}
	} else {
		keys = new BigUint64Array(T * 3);
		for (i = 0; i < T; i++) {
			a = index[i * 3]; b = index[i * 3 + 1]; c = index[i * 3 + 2];
			keys[n++] = (BigInt(a) << 32n) | BigInt(b); keys[n++] = (BigInt(b) << 32n) | BigInt(c); keys[n++] = (BigInt(c) << 32n) | BigInt(a);
		}
	}
	keys.sort();
	for (i = 1; i < n; i++) if (keys[i] === keys[i - 1]) return true;
	return false;
}
