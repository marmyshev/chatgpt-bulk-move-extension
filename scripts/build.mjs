import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const watch = process.argv.includes("--watch");
const outdir = path.resolve("dist");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await cp("public", outdir, { recursive: true });

const options = {
  entryPoints: {
    popup: "src/popup.ts",
    content: "src/content.ts"
  },
  bundle: true,
  outdir,
  format: "iife",
  platform: "browser",
  target: "chrome114",
  sourcemap: true,
  logLevel: "info"
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("Watching...");
} else {
  await build(options);
}
