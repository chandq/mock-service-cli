const path = require('path');
const { existsSync, lstatSync } = require('fs');
const archiveProvider = require('./archiveProvider');
const { createArchiveFile, extractArchiveFile } = require('./archiveTask');

// Flags that select a long-running server mode; one-shot archive commands must
// not silently ignore them.
const SERVER_MODE_FLAGS = [
  'e',
  'explorer',
  'R',
  'static-server',
  'api-client',
  'D',
  'web-dir',
  'd',
  'f',
  'file',
  'static-config',
  'S',
  'socket-server',
  'edit',
  'auth',
  'P',
  'web-port',
  'b',
  'web-baseurl',
  'spa-fallback',
  'watch',
  'watch-depth',
  'watch-interval',
  'p',
  'port',
  'o',
  'cors-origin',
  'H',
  'cors-headers',
  'A',
  'append-headers',
  'O',
  'proxy-options',
  'r',
  'rewrite',
  'a',
  'api-stat',
  't',
  'track',
  'host',
  'windows-hidden',
  'w',
  'open',
  'v',
  'version'
];

class ArchiveUsageError extends Error {}

function singleValue(value, flag) {
  if (value === undefined) return undefined;
  if (value === true || value === false) throw new ArchiveUsageError(`${flag} requires a value`);
  if (Array.isArray(value)) throw new ArchiveUsageError(`${flag} accepts a single value`);
  return String(value);
}

function collectCreateSources(value, positionals) {
  const sources = [];
  if (typeof value === 'string') sources.push(value);
  else if (typeof value === 'number') sources.push(String(value));
  else if (Array.isArray(value)) {
    value.forEach(item => {
      if (typeof item === 'string' || typeof item === 'number') sources.push(String(item));
    });
  } else if (value !== undefined && value !== true && value !== false) {
    throw new ArchiveUsageError('-c/--create requires file or directory paths');
  }
  positionals.forEach(item => {
    if (typeof item === 'string' || typeof item === 'number') sources.push(String(item));
  });
  return sources;
}

function defaultArchiveName(sourcePaths) {
  if (sourcePaths.length !== 1) return 'archive';
  const base = path.basename(sourcePaths[0]);
  return base.replace(/\.[^.]+$/, '') || base;
}

// Returns null when the command line targets a server mode. Throws
// ArchiveUsageError for invalid archive command combinations.
function getArchiveCommand(argv) {
  const extractValue = argv.x !== undefined ? argv.x : argv.extract;
  const createValue = argv.c !== undefined ? argv.c : argv.create;
  if (extractValue === undefined && createValue === undefined) return null;
  if (extractValue !== undefined && createValue !== undefined) {
    throw new ArchiveUsageError('-x/--extract and -c/--create cannot be combined');
  }

  const conflict = SERVER_MODE_FLAGS.find(key => argv[key] !== undefined && argv[key] !== false);
  if (conflict) {
    const flag = conflict.length === 1 ? `-${conflict}` : `--${conflict}`;
    throw new ArchiveUsageError(`-x/--extract and -c/--create cannot be combined with ${flag}`);
  }

  const outValue = singleValue(argv.out, '--out');
  const destinationPath = path.resolve(process.cwd(), outValue || '.');
  if (!existsSync(destinationPath) || !lstatSync(destinationPath).isDirectory()) {
    throw new ArchiveUsageError(`Output directory not found or not a directory: ${destinationPath}`);
  }

  const silent = Boolean(argv.s || argv.silent);

  if (extractValue !== undefined) {
    const archive = singleValue(extractValue, '-x/--extract');
    if (argv._.length) {
      throw new ArchiveUsageError(`Unexpected arguments: ${argv._.join(' ')}`);
    }
    return {
      mode: 'extract',
      archivePath: path.resolve(process.cwd(), archive),
      destinationPath,
      silent
    };
  }

  const sources = collectCreateSources(createValue, argv._);
  if (!sources.length) throw new ArchiveUsageError('-c/--create requires at least one file or directory');
  const format = singleValue(argv.format, '--format') || 'zip';
  if (!archiveProvider.capabilities.createFormats.includes(format)) {
    const formats = archiveProvider.capabilities.createFormats.join(', ');
    throw new ArchiveUsageError(`Unsupported format: ${format}. Supported formats: ${formats}`);
  }
  const name = singleValue(argv.name, '--name');
  const sourcePaths = sources.map(source => path.resolve(process.cwd(), source));
  return {
    mode: 'create',
    sourcePaths,
    destinationPath,
    format,
    name: name || defaultArchiveName(sourcePaths),
    silent
  };
}

async function runArchiveCommand(command) {
  const job = {
    progress: { processedEntries: 0, totalEntries: 0 },
    cancelled: false,
    child: null,
    archive: null
  };
  let interrupted = false;
  let forceExitHandler = null;
  const onSigint = () => {
    if (interrupted) return;
    interrupted = true;
    job.cancelled = true;
    if (job.child && typeof job.child.kill === 'function') job.child.kill('SIGTERM');
    if (job.archive && typeof job.archive.abort === 'function') job.archive.abort();
    forceExitHandler = () => process.exit(130);
    process.once('SIGINT', forceExitHandler);
  };
  process.once('SIGINT', onSigint);

  try {
    if (command.mode === 'extract') {
      await extractArchiveFile({
        sourcePath: command.archivePath,
        destinationPath: command.destinationPath,
        job
      });
      if (!command.silent) {
        console.log(`Extracted ${job.progress.totalEntries} entries to ${command.destinationPath}`);
      }
      return 0;
    }
    const result = await createArchiveFile({
      sourcePaths: command.sourcePaths,
      destinationPath: command.destinationPath,
      name: command.name,
      format: command.format,
      job
    });
    if (!command.silent) console.log(`Created ${result.path}`);
    return 0;
  } catch (error) {
    if (job.cancelled) {
      console.error('Archive operation cancelled');
      return 130;
    }
    console.error(`Archive ${command.mode} failed: ${error.message}`);
    return 1;
  } finally {
    process.removeListener('SIGINT', onSigint);
    if (forceExitHandler) process.removeListener('SIGINT', forceExitHandler);
  }
}

module.exports = { ArchiveUsageError, getArchiveCommand, runArchiveCommand };
