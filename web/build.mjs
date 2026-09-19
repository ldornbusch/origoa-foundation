import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");
mkdirSync("dist", { recursive: true });
cpSync("index.html", "dist/index.html");
cpSync("src/styles.css", "dist/styles.css");
const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: !watch,
  sourcemap: true,
  outfile: "dist/main.js",
  logLevel: "info",
};
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
