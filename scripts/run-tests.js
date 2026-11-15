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

  process.exit(result.status === null ? 1 : result.status);
}

// Windows Node 18/20 can exceed tap's 30s default on archive fixtures
// (thousands of temp files plus antivirus); a killed child surfaces as a
// misleading "test count !== plan" error.
const TAP_TIMEOUT_SECONDS = '120';

const allTests = listTestFiles();

if (mode === 'smoke') {
  runTap(['--no-coverage', '--reporter=spec', `--timeout=${TAP_TIMEOUT_SECONDS}`, path.join(testDir, 'cli-entry.test.js')]);
} else if (mode === 'unit') {
  const unitTests = allTests.filter(file => path.basename(file) !== 'cli-entry.test.js');
  runTap(['--cov', '--coverage-report=lcov', '--reporter=spec', `--timeout=${TAP_TIMEOUT_SECONDS}`, ...unitTests]);
} else {
  console.error(`Unknown test mode: ${mode}`);
  process.exit(1);
}
