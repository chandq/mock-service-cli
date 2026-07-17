const moduleLoaders = {
  cli: () => require('./bin/mock-service-cli'),
  mockServer: () => require('./lib/mockServer'),
  staticServer: () => require('./lib/staticServer'),
  fileExplorerServer: () => require('./lib/fileExplorerServer'),
  manageMockFiles: () => require('./lib/manageMockFiles'),
  utils: () => require('./lib/utils'),
  asyncTaskQueue: () => require('./lib/asyncTaskQueue'),
  packageInfo: () => require('./lib/packageInfo')
};

function load(moduleName) {
  const loader = moduleLoaders[moduleName];

  if (!loader) {
    throw new Error(`Unknown runtime module: ${moduleName}`);
  }

  return loader();
}

module.exports = {
  load
};
