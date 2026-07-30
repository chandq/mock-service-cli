const { readFileSync } = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

if (process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('Publishing is restricted to GitHub Actions Trusted Publishing.');
}

function runNpm(args) {
  execFileSync('npm', args, { cwd: root, stdio: 'inherit' });
}

function publishPackage(directory, tag, publishOptions) {
  const packagePath = path.join(root, directory, 'package.json');
  const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8'));
  const versionLookup = spawnSync(
    'npm',
    ['view', `${packageManifest.name}@${packageManifest.version}`, 'version', '--registry', 'https://registry.npmjs.org'],
    { cwd: root, encoding: 'utf8' }
  );
  if (versionLookup.status === 0 && versionLookup.stdout.trim() === packageManifest.version) {
    console.info(`${packageManifest.name}@${packageManifest.version} is already published; skipping.`);
    return;
  }
  runNpm(['publish', `./${directory}`, '--tag', tag].concat(publishOptions));
}

runNpm(['test']);
runNpm(['run', 'test:src']);
runNpm(['run', 'package:editions']);
runNpm(['run', 'verify:packages']);
const publishOptions = ['--access', 'public', '--provenance', '--registry', 'https://registry.npmjs.org'];
publishPackage('release/light', 'latest', publishOptions);
publishPackage('release/ultra', 'latest', publishOptions);
runNpm(['run', 'build:light']);
