import { defineConfig } from "vite";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

var __dirname = dirname(fileURLToPath(import.meta.url));

// GitHub Pages project site: https://<user>.github.io/<repo>/
var GH_PAGES_BASE = "/trimesh-repair-js/";

export default defineConfig(function (ctx) {
	var isBuild = ctx.command === "build";
	return {
		root: resolve(__dirname, "examples"),
		base: isBuild ? GH_PAGES_BASE : "/",
		server: { fs: { allow: [__dirname] } },
		build: {
			target: "esnext",
			outDir: resolve(__dirname, "docs/demo"),
			emptyOutDir: true
		}
	};
});
