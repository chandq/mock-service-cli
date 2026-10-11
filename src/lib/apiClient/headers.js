const managedHeaders = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'proxy-connection',
  'trailer',
  'te'
]);

const isManagedHeader = name => managedHeaders.has(name.toLowerCase());

module.exports = { isManagedHeader };
