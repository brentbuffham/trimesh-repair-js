// src/bms/edges.js
//=============================================================
// EDGE TABLE over a BMS mega soup
//=============================================================
// Edge key: a NUMBER from the two PoolVertex ids (smaller first),
// min * 2^26 + max, exact in a double for up to 67 million vertices.
// String keys like "a|b" cost hundreds of megabytes and most of the
// run time on a million-triangle mesh.
//
// The table stores, per edge, its face count and first two triangles in
// typed arrays (a third or later face, which only non-manifold edges
// have, goes in a small side map). That replaces a JavaScript array per
// edge, which was most of the memory of a large build.
//
// The table is cached on the bms object (edgesOf) and kept current by
// the stages that append triangles (markCurrent), so it is built once.
//=============================================================

var ID_SPAN = 67108864; // 2^26

/**
 * Order-independent edge key for two PoolVertex ids.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function poolEdgeKey(a, b) {
	return a < b ? a * ID_SPAN + b : b * ID_SPAN + a;
}

/**
 * Edges of a triangle soup: face count and incident triangles per edge.
 *
 * Lookup is an open-addressing hash table over the two vertex ids, in typed
 * arrays. (A Map keyed by the combined double key allocated and hashed a heap
 * number per lookup, and was half of orientMesh's time.) The key-based methods
 * remain; slot / addEdge / counts / t0 / t1 take the ids and skip the key.
 * @param {number} [capacity] - expected edges
 */
export function EdgeTable(capacity) {
	var cap = Math.max(16, capacity || 0);
	this.va = new Int32Array(cap);   // smaller vertex id
	this.vb = new Int32Array(cap);   // larger vertex id
	this.counts = new Uint32Array(cap);
	this.t0 = new Int32Array(cap);
	this.t1 = new Int32Array(cap);
	this.extra = new Map();          // slot -> triangles after the second
	this.size = 0;
	this._table = null;
	this._mask = 0;
	this._rehash(cap);
}

// slots of the hash table: a power of two, at most half full
EdgeTable.prototype._rehash = function (cap) {
	var n = 32;
	while (n < 2 * cap) n *= 2;
	var table = new Int32Array(n).fill(-1), mask = n - 1;
	for (var s = 0; s < this.size; s++) {
		var h = hashOf(this.va[s], this.vb[s]) & mask;
		while (table[h] !== -1) h = (h + 1) & mask;
		table[h] = s;
	}
	this._table = table;
	this._mask = mask;
};

function hashOf(a, b) {
	var h = Math.imul(a, 0x9E3779B1) ^ Math.imul(b + 0x7F4A7C15 | 0, 0x85EBCA6B);
	return h ^ (h >>> 15);
}

EdgeTable.prototype._grow = function () {
	var cap = this.va.length * 2;
	function bigger(Ctor, old) { var a = new Ctor(cap); a.set(old); return a; }
	this.va = bigger(Int32Array, this.va);
	this.vb = bigger(Int32Array, this.vb);
	this.counts = bigger(Uint32Array, this.counts);
	this.t0 = bigger(Int32Array, this.t0);
	this.t1 = bigger(Int32Array, this.t1);
	this._rehash(cap);
};

/** @returns {number} the slot of edge (a, b) in either order, or -1 */
EdgeTable.prototype.slot = function (a, b) {
	var lo = a < b ? a : b, hi = a < b ? b : a;
	var table = this._table, mask = this._mask, va = this.va, vb = this.vb;
	var h = hashOf(lo, hi) & mask, s;
	while ((s = table[h]) !== -1) {
		if (va[s] === lo && vb[s] === hi) return s;
		h = (h + 1) & mask;
	}
	return -1;
};

/** Add triangle t to edge (a, b). */
EdgeTable.prototype.addEdge = function (a, b, t) {
	var lo = a < b ? a : b, hi = a < b ? b : a;
	// the key methods and poolEdgeKey pack both ids into one double, exact only below ID_SPAN
	if (hi >= ID_SPAN) throw new RangeError("a mesh of " + (hi + 1).toLocaleString("en-US") + " or more vertices is too large for one edge table (limit " + ID_SPAN.toLocaleString("en-US") + "); mesh it in tiles");
	var table = this._table, mask = this._mask, va = this.va, vb = this.vb;
	var h = hashOf(lo, hi) & mask, s;
	while ((s = table[h]) !== -1) {
		if (va[s] === lo && vb[s] === hi) {
			var n = this.counts[s]++;
			if (n === 1) this.t1[s] = t;
			else {
				var list = this.extra.get(s);
				if (list) list.push(t); else this.extra.set(s, [t]);
			}
			return;
		}
		h = (h + 1) & mask;
	}
	if (this.size === this.va.length) {
		this._grow();
		this.addEdge(lo, hi, t);
		return;
	}
	s = this.size++;
	table[h] = s;
	this.va[s] = lo;
	this.vb[s] = hi;
	this.counts[s] = 1;
	this.t0[s] = t;
};

// ids back out of a combined key
function slotOfKey(table, key) {
	var hi = Math.floor(key / ID_SPAN);
	return table.slot(hi, key - hi * ID_SPAN);
}

/** Add triangle t to edge key. */
EdgeTable.prototype.add = function (key, t) {
	var hi = Math.floor(key / ID_SPAN);
	this.addEdge(hi, key - hi * ID_SPAN, t);
};

/** @returns {number} faces on edge key (0 when absent) */
EdgeTable.prototype.count = function (key) {
	var s = slotOfKey(this, key);
	return s === -1 ? 0 : this.counts[s];
};

/** @returns {boolean} */
EdgeTable.prototype.has = function (key) {
	return slotOfKey(this, key) !== -1;
};

/** @returns {number} the i-th triangle on edge key (-1 when there is none) */
EdgeTable.prototype.tri = function (key, i) {
	var s = slotOfKey(this, key);
	if (s === -1 || i >= this.counts[s]) return -1;
	if (i === 0) return this.t0[s];
	if (i === 1) return this.t1[s];
	return this.extra.get(s)[i - 2];
};

/**
 * Visit every edge in insertion order.
 * @param {function(number, number, number, number): void} fn - (count, key, t0, t1)
 */
EdgeTable.prototype.forEach = function (fn) {
	for (var s = 0; s < this.size; s++) fn(this.counts[s], this.va[s] * ID_SPAN + this.vb[s], this.t0[s], this.t1[s]);
};

/**
 * @param {Array<{v0: {id: number}, v1: {id: number}, v2: {id: number}}>} soup
 * @returns {EdgeTable}
 */
export function buildEdgeMap(soup) {
	var table = new EdgeTable(Math.ceil(soup.length * 1.6));
	for (var t = 0; t < soup.length; t++) {
		var tri = soup[t];
		var i0 = tri.v0.id, i1 = tri.v1.id, i2 = tri.v2.id;
		table.addEdge(i0, i1, t);
		table.addEdge(i1, i2, t);
		table.addEdge(i2, i0, t);
	}
	return table;
}

/**
 * The edge table for bms.soup, built once and reused while the soup only
 * has triangles appended (markCurrent) or flipped in place. A soup that
 * was replaced, or shrank (an undo), gets a fresh table.
 * @param {{soup: Array<Object>}} bms
 * @returns {EdgeTable}
 */
export function edgesOf(bms) {
	var c = bms._edges;
	// a table from another copy or version of this library has another shape: rebuild it
	if (!c || !(c.map instanceof EdgeTable) || c.soup !== bms.soup || c.length !== bms.soup.length) {
		c = { soup: bms.soup, length: bms.soup.length, map: buildEdgeMap(bms.soup) };
		// not enumerable: a result stays printable and cloneable
		Object.defineProperty(bms, "_edges", { value: c, writable: true, configurable: true, enumerable: false });
	}
	return c.map;
}

/**
 * After a stage has appended triangles to bms.soup AND added their edges
 * to the table it got from edgesOf, mark the cached table current again.
 * @param {{soup: Array<Object>}} bms
 * @param {EdgeTable} map
 */
export function markCurrent(bms, map) {
	var c = bms._edges;
	if (c && c.map === map && c.soup === bms.soup) c.length = bms.soup.length;
}
