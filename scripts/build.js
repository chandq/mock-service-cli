const { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const srcLibDir = path.join(root, 'src/lib');

const wrappers = {
  cli: 'cli',
  mockServer: 'mockServer',
  staticServer: 'staticServer',
  fileExplorerServer: 'fileExplorerServer',
  manageMockFiles: 'manageMockFiles',
  utils: 'utils',
  asyncTaskQueue: 'asyncTaskQueue',
  packageInfo: 'packageInfo'
};

const commonOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node16',
  external: ['fsevents', 'nodemon'],
  logLevel: 'info',
  minifyWhitespace: true,
  minifySyntax: true,
  legalComments: 'none'
};

function writeRuntimeWrapper(fileName, moduleName) {
  writeFileSync(
    path.join(distDir, `${fileName}.js`),
    `module.exports = require('./runtime').load('${moduleName}');\n`
  );
}

async function build() {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  const result = await esbuild.build({
    ...commonOptions,
    entryPoints: [path.join(root, 'src/runtime.js')],
    outfile: path.join(distDir, 'runtime.js'),
    metafile: true
  });

  Object.keys(wrappers).forEach(fileName => {
    writeRuntimeWrapper(fileName, wrappers[fileName]);
  });

  copyFileSync(path.join(srcLibDir, 'api-overview.html'), path.join(distDir, 'api-overview.html'));
  copyFileSync(path.join(srcLibDir, 'file-explorer.html'), path.join(distDir, 'file-explorer.html'));
  writeFileSync(path.join(distDir, 'meta.json'), JSON.stringify(result.metafile, null, 2));
  chmodSync(path.join(root, 'bin/mock-service-cli'), 0o755);
}

build().catch(error => {
  console.error(error);
  process.exit(1);
});
