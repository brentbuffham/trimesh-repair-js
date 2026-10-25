// examples/main.js
//=============================================================
// trimesh-repair-js demo: a mesh with problems, and the library's tools to fix them.
// The mesh is held indexed ({positions, index}, world coordinates); checkMeshIndexed reports on it
// after every step. Patching runs patchMeshLoopsLocal on the indexed mesh; Fill gaps, Repair folds
// and Orient go through the BMS level (bmsFromIndexed -> the stage -> toIndexed).
// Meshes are small, so everything runs on the main thread.
//=============================================================

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
	checkMeshIndexed, patchMeshLoopsLocal, bmsFromIndexed, fillGaps, repairFolds, orientMesh,
	validateMesh, toIndexed, DEFAULT_TOLERANCE
} from "../src/index.js";
import { MESHES, parseObj } from "./meshes.js";
import pkg from "../package.json";

// ── Version badge, read from package.json so it cannot go stale ──
var vEl = document.getElementById("lib-version");
if (vEl) vEl.textContent = "v" + pkg.version;

var $ = function (id) { return document.getElementById(id); };

// ── Scene ──
var viewport = $("viewport");
var renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
viewport.appendChild(renderer.domElement);
var scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);
var camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000);
camera.up.set(0, 0, 1);
var controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
var sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1, -2, 3);
scene.add(sun);
var head = new THREE.DirectionalLight(0xffffff, 0.8);
camera.add(head);
scene.add(camera);

var group = new THREE.Group();
scene.add(group);

function resize() {
	var w = viewport.clientWidth, h = viewport.clientHeight;
	renderer.setSize(w, h);
	camera.aspect = w / Math.max(1, h);
	camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();
renderer.setAnimationLoop(function () { controls.update(); renderer.render(scene, camera); });

// ── State ──
var original = null;   // the mesh as made / opened, for Reset
var mesh = null;       // the current indexed mesh, world coordinates
var report = null;     // checkMeshIndexed(mesh)
var added = null;      // world xyz of the triangles the last step added (9 per triangle)
var history = [];      // earlier meshes, for Undo
var selected = -1;     // selected loop index in report.loops
var origin = { x: 0, y: 0, z: 0 }; // render origin: world minus this, so Float32 stays exact

// ── Report ──
function log(text, cls) {
	var d = document.createElement("div");
	d.textContent = text;
	if (cls) d.className = cls;
	$("log").prepend(d);
}

// edges both of whose triangles run them the same way: a fold, or two parts wound apart
function foldEdges(m) {
	var count = new Map(), idx = m.index, V = m.positions.length / 3, out = [];
	for (var t = 0; t < idx.length; t += 3) {
		for (var e = 0; e < 3; e++) {
			var a = idx[t + e], b = idx[t + (e + 1) % 3], k = a * V + b;
			count.set(k, (count.get(k) || 0) + 1);
		}
	}
	count.forEach(function (n, k) { if (n > 1) out.push(Math.floor(k / V), k % V); });
	return out;
}

function showReport() {
	var r = report, folds = foldEdges(mesh).length / 2;
	var rows = [
		"triangles: <b>" + r.triangles + "</b>",
		"closed: " + (r.closed ? '<span class="good">yes</span>' : '<span class="bad">no</span>'),
		"volume: <b>" + (r.volume != null ? r.volume.toFixed(2) + " m³" : "—") + "</b>",
		"open loops: <b>" + r.openLoops + "</b>" + (r.openLoops ? " (" + r.loops.map(function (l) { return l.length / 3; }).join(", ") + " edges)" : ""),
		"boundary edges: <b>" + r.boundaryEdges + "</b>",
		"non-manifold edges: " + (r.nonManifoldEdges ? '<span class="bad">' + r.nonManifoldEdges + "</span>" : "<b>0</b>"),
		"fold edges: " + (folds ? '<span class="bad">' + folds + "</span>" : "<b>0</b>"),
		"selected loop: <b>" + (selected >= 0 ? "#" + selected + ", " + r.loops[selected].length / 3 + " edges" : "none") + "</b>"
	];
	$("report").innerHTML = rows.join("<br>");
	$("undo").disabled = history.length === 0;
	$("patchSel").disabled = selected < 0;
	$("patchAll").disabled = r.openLoops === 0;
}

// ── Drawing ──
function clearGroup() {
	while (group.children.length) {
		var c = group.children.pop();
		if (c.geometry) c.geometry.dispose();
		if (c.material) c.material.dispose();
	}
}

function local(xyz) {
	var out = new Float32Array(xyz.length);
	for (var i = 0; i < xyz.length; i += 3) { out[i] = xyz[i] - origin.x; out[i + 1] = xyz[i + 1] - origin.y; out[i + 2] = xyz[i + 2] - origin.z; }
	return out;
}

function segments(xyz, colour, name) {
	var g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.BufferAttribute(local(xyz), 3));
	var l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: colour, depthTest: false, transparent: true }));
	l.renderOrder = 2;
	l.name = name;
	return l;
}

// a closed polyline (xyz) as segment pairs
function loopPairs(loop) {
	var n = loop.length / 3, out = new Float64Array(6 * n);
	for (var i = 0; i < n; i++) {
		var j = (i + 1) % n;
		out.set([loop[3 * i], loop[3 * i + 1], loop[3 * i + 2], loop[3 * j], loop[3 * j + 1], loop[3 * j + 2]], 6 * i);
	}
	return out;
}

function draw() {
	clearGroup();
	var g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.BufferAttribute(local(mesh.positions), 3));
	g.setIndex(new THREE.BufferAttribute(mesh.index, 1));
	g.computeVertexNormals();
	var front = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x8fa8c8, side: THREE.FrontSide, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
	var back = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xd08030, side: THREE.BackSide, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
	group.add(front, back);
	if ($("showWire").checked) {
		var w = new THREE.LineSegments(new THREE.WireframeGeometry(g), new THREE.LineBasicMaterial({ color: 0x222222 }));
		group.add(w);
	}
	if ($("showAdded").checked && added && added.length) {
		var ag = new THREE.BufferGeometry();
		ag.setAttribute("position", new THREE.BufferAttribute(local(added), 3));
		var am = new THREE.Mesh(ag, new THREE.MeshBasicMaterial({ color: 0xffdd00, side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false }));
		am.renderOrder = 1;
		group.add(am);
	}
	if ($("showLoops").checked) {
		report.loops.forEach(function (lp, i) { group.add(segments(loopPairs(lp), i === selected ? 0x44ff44 : 0xff3333, "loop")); });
	}
	if ($("showFolds").checked) {
		var f = foldEdges(mesh);
		if (f.length) {
			var fx = new Float64Array(3 * f.length);
			for (var i = 0; i < f.length; i++) fx.set(mesh.positions.subarray(3 * f[i], 3 * f[i] + 3), 3 * i);
			group.add(segments(fx, 0x33ddff, "folds"));
		}
	}
	if ($("showNormals").checked) {
		var idx = mesh.index, P = mesh.positions, nx = new Float64Array(6 * idx.length / 3), len = 0.04 * size();
		for (var t = 0; t < idx.length; t += 3) {
			var a = 3 * idx[t], b = 3 * idx[t + 1], c = 3 * idx[t + 2];
			var cx = (P[a] + P[b] + P[c]) / 3, cy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
			var ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
			var vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
			var n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], l = Math.hypot(n[0], n[1], n[2]) || 1;
			nx.set([cx, cy, cz, cx + len * n[0] / l, cy + len * n[1] / l, cz + len * n[2] / l], 2 * t);
		}
		group.add(segments(nx, 0x44cc66, "normals"));
	}
	showReport();
}

function size() {
	var b = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(local(mesh.positions), 3));
	return b.getSize(new THREE.Vector3()).length() || 1;
}

function frame() {
	var b = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(local(mesh.positions), 3));
	var c = b.getCenter(new THREE.Vector3()), r = b.getSize(new THREE.Vector3()).length() || 1;
	controls.target.copy(c);
	camera.position.set(c.x + 0.6 * r, c.y - 0.9 * r, c.z + 0.6 * r);
	camera.near = r / 1000;
	camera.far = r * 100;
	camera.updateProjectionMatrix();
}

// ── Steps ──
// world-coordinate keys of each triangle, to find the ones a step added
function triKeys(m) {
	var set = new Set(), P = m.positions, idx = m.index;
	var key = function (v) { return P[3 * v].toFixed(6) + "," + P[3 * v + 1].toFixed(6) + "," + P[3 * v + 2].toFixed(6); };
	for (var t = 0; t < idx.length; t += 3) set.add([key(idx[t]), key(idx[t + 1]), key(idx[t + 2])].sort().join("|"));
	return set;
}

function newTriangles(before, after) {
	var old = triKeys(before), P = after.positions, idx = after.index, out = [];
	var key = function (v) { return P[3 * v].toFixed(6) + "," + P[3 * v + 1].toFixed(6) + "," + P[3 * v + 2].toFixed(6); };
	for (var t = 0; t < idx.length; t += 3) {
		if (old.has([key(idx[t]), key(idx[t + 1]), key(idx[t + 2])].sort().join("|"))) continue;
		for (var c = 0; c < 3; c++) out.push(P[3 * idx[t + c]], P[3 * idx[t + c] + 1], P[3 * idx[t + c] + 2]);
	}
	return Float64Array.from(out);
}

function setMesh(m, keepHistory) {
	if (keepHistory && mesh) history.push(mesh);
	added = keepHistory && mesh ? newTriangles(mesh, m) : null;
	mesh = m;
	report = checkMeshIndexed(mesh);
	selected = -1;
	draw();
}

function step(name, fn) {
	$("error").textContent = "";
	try {
		var t0 = performance.now();
		var res = fn();
		if (!res) return;
		var before = report;
		setMesh(res.mesh, true);
		log(name + ": " + res.text + " (" + (performance.now() - t0).toFixed(0) + " ms) - loops " + before.openLoops + " -> " + report.openLoops);
	} catch (err) {
		$("error").textContent = name + " failed: " + (err && err.message ? err.message : err);
		console.error(err);
	}
}

// a BMS-level stage on the current mesh; back to indexed, world coordinates
function viaBMS(fn) {
	var bms = bmsFromIndexed(mesh.positions, mesh.index, DEFAULT_TOLERANCE);
	var text = fn(bms);
	return { mesh: toIndexed(bms, bms.origin), text: text };
}

function patch(which) {
	var res = patchMeshLoopsLocal(mesh, which, { method: $("patchMethod").value, maxEdges: Number($("patchMax").value), report: report });
	var methods = Object.keys(res.methods).map(function (k) { return k + " " + res.methods[k]; }).join(", ");
	var text = res.patched + " loop(s) patched" + (methods ? " [" + methods + "]" : "");
	if (res.refused.length) text += ", " + res.refused.length + " refused (" + res.refused.map(function (r) { return r.reason; }).join("; ") + ")";
	if (!res.patched) { log("Patch: nothing patched" + (res.refused.length ? " - " + text : ""), "bad"); return null; }
	return { mesh: res.mesh, text: text };
}

$("patchSel").addEventListener("click", function () {
	if (selected < 0) return;
	step("Patch loop #" + selected, function () { return patch([selected]); });
});
$("patchAll").addEventListener("click", function () {
	step("Patch all ≤ " + $("patchMax").value, function () { return patch("all"); });
});
$("fillGaps").addEventListener("click", function () {
	step("Fill gaps ≤ " + $("gapMax").value, function () {
		return viaBMS(function (bms) {
			var r = fillGaps(bms, bms.mesh, Number($("gapMax").value));
			orientMesh(bms, null); // fillGaps leaves the new triangles' winding to the orient
			return r.filled + " gap(s) filled, " + r.triangles + " triangle(s)";
		});
	});
});
$("repairFolds").addEventListener("click", function () {
	step("Repair folds", function () {
		return viaBMS(function (bms) {
			var r = repairFolds(bms, {});
			return r.removed + " triangle(s) removed in " + r.passes + " pass(es)" + (r.kept ? ", " + r.kept + " kept" : "");
		});
	});
});
$("orient").addEventListener("click", function () {
	step("Orient", function () {
		return viaBMS(function (bms) {
			var r = orientMesh(bms, null);
			validateMesh(bms, r.orientation);
			return r.perComponent.length + " part(s), " + r.orientation;
		});
	});
});
$("undo").addEventListener("click", function () {
	if (!history.length) return;
	mesh = history.pop();
	added = null;
	report = checkMeshIndexed(mesh);
	selected = -1;
	draw();
	log("Undo");
});
$("reset").addEventListener("click", function () { load(original, $("source").selectedOptions[0].textContent); });
["showWire", "showLoops", "showFolds", "showAdded", "showNormals"].forEach(function (id) { $(id).addEventListener("change", draw); });

// ── Loading ──
function load(m, label) {
	original = m;
	history = [];
	origin = { x: m.positions[0] || 0, y: m.positions[1] || 0, z: m.positions[2] || 0 };
	mesh = null;
	setMesh(m, false);
	frame();
	log("Loaded " + label + ": " + report.triangles + " triangles, " + report.openLoops + " open loop(s)");
}

var source = $("source");
Object.keys(MESHES).forEach(function (k) {
	var o = document.createElement("option");
	o.value = k;
	o.textContent = MESHES[k].label;
	source.appendChild(o);
});
source.addEventListener("change", function () { load(MESHES[source.value].make(), MESHES[source.value].label); });
$("openFile").addEventListener("click", function () { $("file").click(); });
$("file").addEventListener("change", function () {
	var f = $("file").files[0];
	if (!f) return;
	f.text().then(function (text) {
		var m = parseObj(text);
		if (!m.index.length) { $("error").textContent = f.name + ": no faces found"; return; }
		load(m, f.name);
	});
	$("file").value = "";
});
$("exportObj").addEventListener("click", function () {
	var lines = ["# trimesh-repair-js demo export"], P = mesh.positions, idx = mesh.index;
	for (var i = 0; i < P.length; i += 3) lines.push("v " + P[i] + " " + P[i + 1] + " " + P[i + 2]);
	for (var t = 0; t < idx.length; t += 3) lines.push("f " + (idx[t] + 1) + " " + (idx[t + 1] + 1) + " " + (idx[t + 2] + 1));
	var a = document.createElement("a");
	a.href = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/plain" }));
	a.download = "repaired.obj";
	a.click();
	setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
});

// ── Picking a loop: the nearest loop segment within 24 px of a click (not a drag) ──
var down = null;
renderer.domElement.addEventListener("pointerdown", function (e) { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener("pointerup", function (e) {
	if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down = null; return; }
	down = null;
	var rect = renderer.domElement.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
	var v = new THREE.Vector3(), best = -1, bestD = 24;
	var screen = function (x, y, z) {
		v.set(x - origin.x, y - origin.y, z - origin.z).project(camera);
		return [(v.x + 1) / 2 * rect.width, (1 - v.y) / 2 * rect.height, v.z];
	};
	report.loops.forEach(function (lp, li) {
		var n = lp.length / 3;
		for (var i = 0; i < n; i++) {
			var j = (i + 1) % n;
			var a = screen(lp[3 * i], lp[3 * i + 1], lp[3 * i + 2]), b = screen(lp[3 * j], lp[3 * j + 1], lp[3 * j + 2]);
			if (a[2] > 1 || b[2] > 1) continue;
			var dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
			var s = L > 0 ? Math.max(0, Math.min(1, ((mx - a[0]) * dx + (my - a[1]) * dy) / L)) : 0;
			var d = Math.hypot(a[0] + s * dx - mx, a[1] + s * dy - my);
			if (d < bestD) { bestD = d; best = li; }
		}
	});
	selected = best;
	draw();
});
window.addEventListener("keydown", function (e) {
	if (e.key === "Enter" && selected >= 0 && document.activeElement.tagName !== "INPUT") $("patchSel").click();
});

load(MESHES[source.value].make(), MESHES[source.value].label);
