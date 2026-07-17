const { chmodSync, copyFileSync, mkdirSync, readdirSync, rmSync } = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const srcLibDir = path.join(root, 'src/lib');

const commonOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node16',
  external: ['fsevents', 'nodemon'],
  logLevel: 'info'
};

function getLibEntries() {
  return readdirSync(srcLibDir)
    .filter(file => file.endsWith('.js'))
    .map(file => path.join(srcLibDir, file));
}

async function build() {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  await esbuild.build({
    ...commonOptions,
    entryPoints: [path.join(root, 'src/bin/mock-service-cli')],
    outfile: path.join(distDir, 'cli.js')
  });

  await esbuild.build({
    ...commonOptions,
    entryPoints: getLibEntries(),
    outdir: distDir,
    entryNames: '[name]'
  });

  copyFileSync(path.join(srcLibDir, 'api-overview.html'), path.join(distDir, 'api-overview.html'));
  copyFileSync(path.join(srcLibDir, 'file-explorer.html'), path.join(distDir, 'file-explorer.html'));
  chmodSync(path.join(root, 'bin/mock-service-cli'), 0o755);
}

build().catch(error => {
  console.error(error);
  process.exit(1);
});
