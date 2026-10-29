// The orientation walk's heap: it grows, and pops in exactly the order the swapping version did,
// ties included (the walk's order, and so the winding it chooses, depends on it).
import { describe, it, expect } from "vitest";
import { Heap } from "../src/bms/orientMesh.js";

// the heap as it was: three parallel arrays, swapped level by level
function SwapHeap(capacity) {
	this.w = new Float64Array(capacity); this.to = new Int32Array(capacity); this.from = new Int32Array(capacity); this.size = 0;
}
SwapHeap.prototype._swap = function (i, j) {
	var w = this.w[i]; this.w[i] = this.w[j]; this.w[j] = w;
	var t = this.to[i]; this.to[i] = this.to[j]; this.to[j] = t;
	var f = this.from[i]; this.from[i] = this.from[j]; this.from[j] = f;
};
SwapHeap.prototype.push = function (w, to, from) {
	var i = this.size++;
	this.w[i] = w; this.to[i] = to; this.from[i] = from;
	while (i > 0) { var p = (i - 1) >> 1; if (this.w[p] <= this.w[i]) break; this._swap(p, i); i = p; }
};
SwapHeap.prototype.pop = function () {
	var last = --this.size;
	this._swap(0, last);
	var i = 0;
	for (;;) {
		var l = 2 * i + 1, r = l + 1, s = i;
		if (l < last && this.w[l] < this.w[s]) s = l;
		if (r < last && this.w[r] < this.w[s]) s = r;
		if (s === i) break;
		this._swap(s, i); i = s;
	}
};

function rng(seed) { return function () { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }

describe("orientMesh Heap", function () {
	it("grows from a tiny start and pops in sorted order", function () {
		var h = new Heap(1), r = rng(1), n = 20000, ws = [];
		for (var i = 0; i < n; i++) { var w = r(); ws.push(w); h.push(w, i, i + 1); }
		expect(h.size).toBe(n);
		ws.sort(function (a, b) { return a - b; });
		for (var j = 0; j < n; j++) { h.pop(); expect(h.w[h.size]).toBe(ws[j]); }
		expect(h.size).toBe(0);
	});

	// few distinct weights, so almost every comparison is a tie; mixed pushes and pops
	[2, 5, 1000].forEach(function (distinct) {
		it("pops exactly as the swapping heap did, with " + distinct + " distinct weights", function () {
			var a = new Heap(1), b = new SwapHeap(60000), r = rng(distinct), id = 0, steps = 0;
			while (steps++ < 40000) {
				if (b.size === 0 || r() < 0.6) {
					var w = Math.floor(r() * distinct) / distinct;
					a.push(w, id, id * 3); b.push(w, id, id * 3); id++;
				} else {
					a.pop(); b.pop();
					expect([a.w[a.size], a.to[a.size], a.from[a.size]]).toEqual([b.w[b.size], b.to[b.size], b.from[b.size]]);
				}
			}
			expect(a.size).toBe(b.size);
		});
	});

	it("a single entry pops and leaves the heap empty", function () {
		var h = new Heap(1);
		h.push(0.5, 7, 3);
		h.pop();
		expect([h.size, h.w[0], h.to[0], h.from[0]]).toEqual([0, 0.5, 7, 3]);
	});
});
