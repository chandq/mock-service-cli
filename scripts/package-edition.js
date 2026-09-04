const { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const edition = process.argv[2];
if (!['light', 'ultra'].includes(edition)) {
  throw new Error('Usage: node scripts/package-edition.js <light|ultra>');
}

const root = path.resolve(__dirname, '..');
const rootManifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const outputDir = path.join(root, 'release', edition);
const commonDependencies = ['archiver', 'chokidar', 'is-hidden-file', 'multer', 'nodemon', 'ua-parser-js'];
const ultraDependencies = ['7zip-bin', 'node-unrar-js'];

function dependencyVersions(names) {
  return names.reduce((dependencies, name) => {
    const version =
      (rootManifest.dependencies && rootManifest.dependencies[name]) ||
      (rootManifest.devDependencies && rootManifest.devDependencies[name]);
    if (!version) throw new Error(`Missing version for ${name}`);
    dependencies[name] = version;
    return dependencies;
  }, {});
}

function buildEdition() {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/build.js'), `--edition=${edition}`], {
    cwd: root,
    stdio: 'inherit'
  });
  if (result.status !== 0) throw new Error(`Failed to build ${edition} edition`);
}

function copy(relativePath) {
  const source = path.join(root, relativePath);
  if (!existsSync(source)) return;
  cpSync(source, path.join(outputDir, relativePath), { recursive: true });
}

function createManifest() {
  const manifest = {
    name: edition === 'light' ? rootManifest.name : `${rootManifest.name}-ultra`,
    version: rootManifest.version,
    description:
      edition === 'light'
        ? rootManifest.description
        : `${rootManifest.description} (Ultra archive formats)`,
    main: rootManifest.main,
    bin: rootManifest.bin,
    files: ['bin', 'dist', 'docs/static-server.config.example.json', 'README.md', 'LICENSE'],
    engines: rootManifest.engines,
    author: rootManifest.author,
    keywords: edition === 'light' ? rootManifest.keywords : [...rootManifest.keywords, 'archive', '7z', 'rar'],
    repository: rootManifest.repository,
    license: rootManifest.license,
    homepage: rootManifest.homepage,
    bugs: rootManifest.bugs,
    dependencies: dependencyVersions([...commonDependencies, ...(edition === 'ultra' ? ultraDependencies : [])])
  };
  return manifest;
}

buildEdition();
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
['bin', 'dist', 'README.md', 'LICENSE', 'docs/static-server.config.example.json'].forEach(copy);
writeFileSync(path.join(outputDir, 'package.json'), `${JSON.stringify(createManifest(), null, 2)}\n`);
console.log(`Prepared ${edition} package in ${path.relative(root, outputDir)}`);
