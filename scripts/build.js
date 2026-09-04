const { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const srcLibDir = path.join(root, 'src/lib');
const editions = new Set(['light', 'ultra']);

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
  target: 'node18',
  external: ['fsevents', 'nodemon', '7zip-bin', 'archiver', 'chokidar', 'node-unrar-js', 'is-hidden-file'],
  logLevel: 'info',
  minifyWhitespace: true,
  minifySyntax: true,
  legalComments: 'none'
};

function getEdition() {
  const directValue = process.argv.find(argument => argument.startsWith('--edition='));
  const splitIndex = process.argv.indexOf('--edition');
  let edition = 'light';
  if (directValue) {
    edition = directValue.slice('--edition='.length);
  } else if (splitIndex >= 0) {
    edition = process.argv[splitIndex + 1];
  }
  if (!editions.has(edition)) {
    throw new Error(`Unknown build edition: ${edition}. Use light or ultra.`);
  }
  return edition;
}

function writeRuntimeWrapper(fileName, moduleName) {
  writeFileSync(
    path.join(distDir, `${fileName}.js`),
    `module.exports = require('./runtime').load('${moduleName}');\n`
  );
}

async function build() {
  const edition = getEdition();
  const archiveProviderPath = path.join(srcLibDir, 'archiveProviders', `${edition}.js`);
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  const result = await esbuild.build(Object.assign({}, commonOptions, {
    entryPoints: [path.join(root, 'src/runtime.js')],
    outfile: path.join(distDir, 'runtime.js'),
    metafile: true,
    plugins: [
      {
        name: 'archive-edition-provider',
        setup(buildOptions) {
          buildOptions.onResolve({ filter: /^\.\/archiveProvider$/ }, args => {
            if (args.importer === path.join(srcLibDir, 'archiveService.js')) {
              return { path: archiveProviderPath };
            }
            return null;
          });
        }
      }
    ]
  }));

  Object.keys(wrappers).forEach(fileName => {
    writeRuntimeWrapper(fileName, wrappers[fileName]);
  });

  copyFileSync(path.join(srcLibDir, 'api-overview.html'), path.join(distDir, 'api-overview.html'));
  copyFileSync(path.join(srcLibDir, 'file-explorer.html'), path.join(distDir, 'file-explorer.html'));
  copyFileSync(path.join(srcLibDir, 'file-explorer-login.html'), path.join(distDir, 'file-explorer-login.html'));
  copyFileSync(path.join(srcLibDir, 'favicon-api-overview.svg'), path.join(distDir, 'favicon-api-overview.svg'));
  copyFileSync(path.join(srcLibDir, 'favicon-file-explorer.svg'), path.join(distDir, 'favicon-file-explorer.svg'));
  copyFileSync(path.join(srcLibDir, 'favicon-file-explorer-login.svg'), path.join(distDir, 'favicon-file-explorer-login.svg'));
  copyFileSync(path.join(srcLibDir, 'favicon-static-server.svg'), path.join(distDir, 'favicon-static-server.svg'));
  writeFileSync(path.join(distDir, 'meta.json'), JSON.stringify(result.metafile, null, 2));
  writeFileSync(path.join(distDir, 'edition.json'), JSON.stringify({ edition }));
  chmodSync(path.join(root, 'bin/mock-service-cli'), 0o755);
  console.log(`Built ${edition} edition`);
}

build().catch(error => {
  console.error(error);
  process.exit(1);
});
