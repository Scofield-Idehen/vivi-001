// Bundles a Node service (API or worker) into one file with esbuild.
//
// Workspace packages (@v01/*) ship TypeScript source, so they are bundled in.
// npm packages stay external and are loaded from node_modules at runtime. After building,
// every external import is checked to be installed for this app, so a missing dependency
// fails the build here instead of crashing the service on deploy.
//
//   node ../../scripts/build-node.mjs src/server.ts dist/server.js

import { existsSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';

const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error('Usage: build-node.mjs <entry> <outfile>');
  process.exit(1);
}

const appDir = process.cwd();
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function installedFrom(dir, name) {
  for (let current = dir; ; current = dirname(current)) {
    if (existsSync(join(current, 'node_modules', name, 'package.json'))) return true;
    if (dirname(current) === current) return false;
  }
}

const externals = new Set();
const keepNpmExternal = {
  name: 'keep-npm-external',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@v01/')) return null;
      if (!builtins.has(args.path)) externals.add(packageName(args.path));
      return { path: args.path, external: true };
    });
  },
};

await build({
  entryPoints: [resolve(appDir, entry)],
  outfile: resolve(appDir, outfile),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'warning',
  plugins: [keepNpmExternal],
});

const missing = [...externals].filter((name) => !installedFrom(appDir, name));
if (missing.length) {
  console.error(
    `Missing runtime dependencies for ${appDir}:\n  ${missing.join('\n  ')}\n` +
      'Add them to this app\'s "dependencies" (workspace packages use them, so the app must install them).',
  );
  process.exit(1);
}
console.log(`Built ${outfile} (${externals.size} external packages, all installed).`);
