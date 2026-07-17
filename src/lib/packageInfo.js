const { readFileSync } = require('fs');
const path = require('path');

function getPackageVersion() {
  const packagePaths = [
    path.resolve(__dirname, '../package.json'),
    path.resolve(__dirname, '../../package.json')
  ];

  for (const packagePath of packagePaths) {
    try {
      return JSON.parse(readFileSync(packagePath, 'utf8')).version;
    } catch (error) {
      // Try the next package location. Bundled code runs from dist, source from src/lib.
    }
  }

  return 'unknown';
}

module.exports = {
  getPackageVersion
};
