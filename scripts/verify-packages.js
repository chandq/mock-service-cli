const { existsSync, readFileSync } = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const editions = {
  light: { name: 'mock-service-cli', forbidden: ['7zip-bin', 'node-unrar-js'] },
  ultra: { name: 'mock-service-cli-ultra', required: ['7zip-bin', 'node-unrar-js'] }
};

function fail(message) {
  throw new Error(`Package verification failed: ${message}`);
}

function packListing(directory) {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: directory,
    encoding: 'utf8'
  });
  if (result.status !== 0) fail(result.stderr || `npm pack failed for ${directory}`);
  try {
    return JSON.parse(result.stdout)[0];
  } catch (error) {
    fail(`could not parse npm pack output for ${directory}: ${error.message}`);
  }
}

Object.entries(editions).forEach(([edition, expectations]) => {
  const directory = path.join(root, 'release', edition);
  const manifestPath = path.join(directory, 'package.json');
  if (!existsSync(manifestPath)) fail(`${edition} package has not been prepared`);

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== expectations.name) fail(`${edition} package name is ${manifest.name}`);
  (expectations.required || []).forEach(name => {
    if (!manifest.dependencies[name]) fail(`${edition} package is missing ${name}`);
  });
  (expectations.forbidden || []).forEach(name => {
    if (manifest.dependencies[name]) fail(`${edition} package unexpectedly depends on ${name}`);
  });

  const packed = packListing(directory);
  const packedNames = packed.files.map(file => file.path);
  if (!packedNames.includes('dist/runtime.js')) fail(`${edition} package is missing dist/runtime.js`);
  const runtime = readFileSync(path.join(directory, 'dist/runtime.js'), 'utf8');
  (expectations.forbidden || []).forEach(name => {
    if (runtime.includes(name)) fail(`${edition} runtime still references ${name}`);
  });
  (expectations.required || []).forEach(name => {
    if (!runtime.includes(name)) fail(`${edition} runtime does not reference ${name}`);
  });
  console.log(`Verified ${edition} package (${packed.size} bytes packed)`);
});
