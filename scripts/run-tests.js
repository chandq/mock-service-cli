const { readdirSync } = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const mode = process.argv[2] || 'unit';
const root = path.resolve(__dirname, '..');
const tapBin = require.resolve('tap/bin/run.js');
const testDir = path.join(root, 'test');

function listTestFiles() {
  return readdirSync(testDir)
    .filter(file => file.endsWith('.test.js'))
    .map(file => path.join(testDir, file));
}

function runTap(args) {
  const result = spawnSync(process.execPath, [tapBin, ...args], {
    cwd: root,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status == null ? 1 : result.status);
}

const allTests = listTestFiles();

if (mode === 'smoke') {
  runTap(['--no-coverage', '--reporter=spec', path.join(testDir, 'cli-entry.test.js')]);
} else if (mode === 'unit') {
  const unitTests = allTests.filter(file => path.basename(file) !== 'cli-entry.test.js');
  runTap(['--cov', '--coverage-report=lcov', '--reporter=spec', ...unitTests]);
} else {
  console.error(`Unknown test mode: ${mode}`);
  process.exit(1);
}
