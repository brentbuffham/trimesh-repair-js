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
 * @param {number} [capacity] - expected edges
 */
export function EdgeTable(capacity) {
	var cap = Math.max(16, capacity || 0);
	this.index = new Map();          // key -> slot
	this.keys = new Float64Array(cap);
	this.counts = new Uint32Array(cap);
	this.t0 = new Int32Array(cap);
	this.t1 = new Int32Array(cap);
	this.extra = new Map();          // slot -> triangles after the second
	this.size = 0;
}

EdgeTable.prototype._grow = function () {
	var cap = this.keys.length * 2;
	function bigger(Ctor, old) { var a = new Ctor(cap); a.set(old); return a; }
	this.keys = bigger(Float64Array, this.keys);
	this.counts = bigger(Uint32Array, this.counts);
	this.t0 = bigger(Int32Array, this.t0);
	this.t1 = bigger(Int32Array, this.t1);
};

/** Add triangle t to edge key. */
EdgeTable.prototype.add = function (key, t) {
	var s = this.index.get(key);
	if (s === undefined) {
		if (this.size === this.keys.length) this._grow();
		s = this.size++;
		this.index.set(key, s);
		this.keys[s] = key;
		this.counts[s] = 1;
		this.t0[s] = t;
		return;
	}
	var n = this.counts[s]++;
	if (n === 1) this.t1[s] = t;
	else {
		var list = this.extra.get(s);
		if (list) list.push(t); else this.extra.set(s, [t]);
	}
};

/** @returns {number} faces on edge key (0 when absent) */
EdgeTable.prototype.count = function (key) {
	var s = this.index.get(key);
	return s === undefined ? 0 : this.counts[s];
};

/** @returns {boolean} */
EdgeTable.prototype.has = function (key) {
	return this.index.has(key);
};

/** @returns {number} the i-th triangle on edge key (-1 when there is none) */
EdgeTable.prototype.tri = function (key, i) {
	var s = this.index.get(key);
	if (s === undefined || i >= this.counts[s]) return -1;
	if (i === 0) return this.t0[s];
	if (i === 1) return this.t1[s];
	return this.extra.get(s)[i - 2];
};

/**
 * Visit every edge in insertion order.
 * @param {function(number, number, number, number): void} fn - (count, key, t0, t1)
 */
EdgeTable.prototype.forEach = function (fn) {
	for (var s = 0; s < this.size; s++) fn(this.counts[s], this.keys[s], this.t0[s], this.t1[s]);
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
		table.add(poolEdgeKey(i0, i1), t);
		table.add(poolEdgeKey(i1, i2), t);
		table.add(poolEdgeKey(i2, i0), t);
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
	if (!c || c.soup !== bms.soup || c.length !== bms.soup.length) {
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
