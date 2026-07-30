const { readFileSync } = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const ultraPackageName = `${manifest.name}-ultra`;

if (process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('Publishing is restricted to GitHub Actions Trusted Publishing.');
}

function runNpm(args) {
  execFileSync('npm', args, { cwd: root, stdio: 'inherit' });
}

runNpm(['test']);
runNpm(['run', 'test:src']);
runNpm(['run', 'package:editions']);
runNpm(['run', 'verify:packages']);
const publishOptions = ['--access', 'public', '--provenance', '--registry', 'https://registry.npmjs.org'];
runNpm(['publish', './release/light', '--tag', 'latest'].concat(publishOptions));
runNpm(['publish', './release/ultra', '--tag', 'latest'].concat(publishOptions));
runNpm(['dist-tag', 'add', `${ultraPackageName}@${manifest.version}`, 'ultra', '--registry', 'https://registry.npmjs.org']);
runNpm(['run', 'build:light']);
