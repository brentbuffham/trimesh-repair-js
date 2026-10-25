// src/output/toIndexed.js
//=============================================================
// TO INDEXED — BMS soup to { positions, index } for Kirra
//=============================================================
// Positions are world coordinates in Float64 (origin added back),
// which is what Kirra's addGeneratedSurface({ positions, index })
// takes. Vertices are numbered in first-use order.
//=============================================================

/**
 * @param {{soup: Array<Object>, origin?: {x: number, y: number, z: number}}} bms
 * @param {{x: number, y: number, z: number}} [origin] - default bms.origin, else no shift
 * @returns {{positions: Float64Array, index: Uint32Array}}
 */
export function toIndexed(bms, origin) {
	var o = origin || bms.origin || { x: 0, y: 0, z: 0 };
	var soup = bms.soup;
	var slot = new Map();
	var pos = [];
	var index = new Uint32Array(3 * soup.length);
	for (var t = 0; t < soup.length; t++) {
		var vs = [soup[t].v0, soup[t].v1, soup[t].v2];
		for (var k = 0; k < 3; k++) {
			var v = vs[k];
			var s = slot.get(v.id);
			if (s === undefined) {
				s = pos.length / 3;
				slot.set(v.id, s);
				pos.push(v.x + o.x, v.y + o.y, v.z + o.z);
			}
			index[3 * t + k] = s;
		}
	}
	return { positions: Float64Array.from(pos), index: index };
}
