/**
 * Render Homebrew formulae and Scoop manifests for both npm editions and push them to the
 * chandq/homebrew-tap and chandq/scoop-bucket repositories.
 *
 * Run after `npm run publish:editions` has published the new version to the npm registry,
 * because the Homebrew url / Scoop url point at the registry tarball and need its sha256.
 *
 * Usage:
 *   node scripts/publish-package-managers.js            # full run (GitHub Actions only)
 *   node scripts/publish-package-managers.js --dry-run  # print generated files, no network writes
 */
const { createHash } = require('crypto');
const { spawnSync } = require('child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const path = require('path');
const https = require('https');

const root = path.resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

if (process.env.GITHUB_ACTIONS !== 'true' && !dryRun) {
  throw new Error('Publishing to package-manager repositories is restricted to GitHub Actions (or pass --dry-run locally).');
}

const GITHUB_OWNER = 'chandq';
// Overridable for testing or for environments that need a different npm mirror.
const NPM_REGISTRY = (process.env.NPM_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '');
const ROOT_MANIFEST = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const APP_REPO = 'mock-service-cli';
const LIGHT_NAME = ROOT_MANIFEST.name;
const ULTRA_NAME = `${ROOT_MANIFEST.name}-ultra`;
const VERSION = ROOT_MANIFEST.version;
const HOMEPAGE = `https://github.com/${GITHUB_OWNER}/${APP_REPO}`;
const EDITION_DESC =
  'Local Mock/Static/SPA server, HTTP request proxy, API overview page and File explorer';

// Two npm editions share the same `mock-service-cli` binary. `mock-service-cli-ultra` adds the
// RAR/7z/bzip2/xz archive support and cannot be installed side by side with the light edition.
const EDITIONS = [
  {
    packageName: LIGHT_NAME,
    description: EDITION_DESC
  },
  {
    packageName: ULTRA_NAME,
    description: `${EDITION_DESC} (Ultra archive formats)`,
    homebrewConflict: LIGHT_NAME
  }
];

function registryTarballUrl(packageName) {
  // Public (non-scoped) packages use the deterministic <name>/-/<name>-<version>.tgz layout.
  return `${NPM_REGISTRY}/${packageName}/-/${packageName}-${VERSION}.tgz`;
}

// Default and overridable budget for waiting until the freshly published tarball is served by the
// public registry replicas/CDN. npm publish writes to the registry primary; anonymous downloads
// read from asynchronously replicated endpoints, so the very first GET after a publish can 404 for
// a short while. We poll until it succeeds or this budget runs out.
const DEFAULT_MAX_WAIT_MS = 60000;

function maxWaitMs() {
  const raw = Number(process.env.MAX_REGISTRY_WAIT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_WAIT_MS;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Single attempt at downloading the tarball. Never throws; reports an outcome object instead so the
// caller can decide whether to retry.
function downloadSha256Once(url) {
  return new Promise(resolve => {
    const fetch = (currentUrl, redirectsLeft) => {
      // https.get can throw synchronously (e.g. unsupported protocol); never let it escape.
      let request;
      try {
        request = https.get(currentUrl, response => {
          if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
            response.resume();
            if (redirectsLeft <= 0) return resolve({ ok: false, reason: 'too many redirects' });
            return fetch(new URL(response.headers.location, currentUrl).toString(), redirectsLeft - 1);
          }
          if (response.statusCode !== 200) {
            // 404/502/503/429 are exactly what a not-yet-replicated publish looks like.
            response.resume();
            return resolve({ ok: false, reason: `HTTP ${response.statusCode}` });
          }
          const hash = createHash('sha256');
          response.on('data', chunk => hash.update(chunk));
          response.on('end', () => resolve({ ok: true, sha256: hash.digest('hex') }));
          response.on('error', error => resolve({ ok: false, reason: error.message }));
        });
      } catch (error) {
        return resolve({ ok: false, reason: error.message });
      }
      request.on('error', error => resolve({ ok: false, reason: error.message }));
    };
    fetch(url, 5);
  });
}

// Polls the tarball (the exact bytes Homebrew/Scoop will fetch) until it is downloadable, then
// returns its sha256. Backs off between attempts; fails clearly when the wait budget is exhausted.
async function resolveTarballSha256(packageName) {
  const url = registryTarballUrl(packageName);
  const deadline = Date.now() + maxWaitMs();
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const outcome = await downloadSha256Once(url);
    if (outcome.ok) {
      console.log(`Fetched ${packageName}@${VERSION} on attempt ${attempt} (sha256=${outcome.sha256}).`);
      return outcome.sha256;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `The npm artifact ${packageName}@${VERSION} is still not served by the public registry after ` +
          `${maxWaitMs()}ms (last error: ${outcome.reason}). The npm release itself succeeded but ` +
          `tarball replication is lagging behind. Re-run the workflow to retry — the manifest push ` +
          `is idempotent and will skip once the files are up to date. You can raise the wait via ` +
          `MAX_REGISTRY_WAIT_MS if the registry is unusually slow.`
      );
    }
    const backoff = Math.min(250 * 2 ** (attempt - 1), 5000);
    console.log(
      `Artifact ${packageName}@${VERSION} not ready yet (${outcome.reason}); retrying in ${backoff}ms.`
    );
    await sleep(backoff);
  }
}

function formulaClassName(packageName) {
  return packageName
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function renderHomebrewFormula(edition, sha256) {
  const className = formulaClassName(edition.packageName);
  const conflicts = edition.homebrewConflict ? `  conflicts_with "${edition.homebrewConflict}"\n\n` : '';
  return `class ${className} < Formula
  desc "${edition.description}"
  homepage "${HOMEPAGE}"
  url "${registryTarballUrl(edition.packageName)}"
  sha256 "${sha256}"
  license "MIT"

  depends_on "node"

${conflicts}  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "v#{version}", shell_output("#{bin}/mock-service-cli --version")
  end
end
`;
}

function renderScoopManifest(edition, sha256) {
  const tarballUrl = registryTarballUrl(edition.packageName);
  return JSON.stringify(
    {
      version: VERSION,
      description: edition.description,
      homepage: HOMEPAGE,
      license: 'MIT',
      depends: 'nodejs-lts',
      url: tarballUrl,
      hash: sha256,
      extract_dir: 'package',
      // Installs the runtime dependencies (archiver/chokidar/multer/nodemon/ua-parser-js) into
      // "$dir/node_modules"; the extracted package already contains the pre-built dist/.
      installer: {
        script: 'npm install --omit=dev --ignore-scripts --prefix "$dir"'
      },
      bin: [['bin/mock-service-cli.cmd', 'mock-service-cli']],
      checkver: {
        github: HOMEPAGE,
        regex: 'v([\\d.]+)'
      },
      autoupdate: {
        url: `${NPM_REGISTRY}/${edition.packageName}/-/${edition.packageName}-$version.tgz`
      }
    },
    null,
    2
  );
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

async function pushTargetRepo(repoName, files) {
  const token = process.env.RELEASE_TOKEN;
  if (!token) throw new Error('RELEASE_TOKEN environment variable is missing.');
  const workDir = mkdtempSync(path.join(tmpdir(), `msc-${repoName}-`));
  try {
    const remoteUrl = `https://x-access-token:${token}@github.com/${GITHUB_OWNER}/${repoName}.git`;
    git(['clone', '--depth', '1', remoteUrl, workDir], tmpdir());
    Object.entries(files).forEach(([fileName, content]) => {
      writeFileSync(path.join(workDir, fileName), content);
    });
    if (git(['status', '--porcelain'], workDir) === '') {
      console.log(`No changes for ${repoName}; skipping push.`);
      return;
    }
    git(['add', '-A'], workDir);
    git(
      [
        '-c',
        'user.name=github-actions[bot]',
        '-c',
        'user.email=github-actions[bot]@users.noreply.github.com',
        'commit',
        '-m',
        `chore: bump mock-service-cli to ${VERSION}`
      ],
      workDir
    );
    git(['push', 'origin', 'HEAD'], workDir);
    console.log(`Pushed ${repoName}@${VERSION}.`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log(
    `Syncing package-manager manifests for mock-service-cli@${VERSION} ` +
      `(waiting up to ${maxWaitMs()}ms for the registry to serve the fresh tarballs).`
  );
  const rendered = {};

  // Resolve both editions in parallel so a slow registry costs one wait budget, not two.
  await Promise.all(
    EDITIONS.map(async edition => {
      const sha256 = await resolveTarballSha256(edition.packageName);
      rendered[edition.packageName] = {
        homebrew: {
          fileName: `${edition.packageName}.rb`,
          content: renderHomebrewFormula(edition, sha256)
        },
        scoop: {
          fileName: `${edition.packageName}.json`,
          content: `${renderScoopManifest(edition, sha256)}\n`
        }
      };
    })
  );

  const homebrewFiles = Object.fromEntries(
    Object.values(rendered).map(({ homebrew }) => [homebrew.fileName, homebrew.content])
  );
  const scoopFiles = Object.fromEntries(
    Object.values(rendered).map(({ scoop }) => [scoop.fileName, scoop.content])
  );

  if (dryRun) {
    console.log('\n--- dry run: generated files ---');
    [...Object.entries(homebrewFiles), ...Object.entries(scoopFiles)].forEach(([fileName, content]) => {
      console.log(`\n===== ${fileName} =====`);
      process.stdout.write(content);
    });
    return;
  }

  await pushTargetRepo('homebrew-tap', homebrewFiles);
  await pushTargetRepo('scoop-bucket', scoopFiles);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
