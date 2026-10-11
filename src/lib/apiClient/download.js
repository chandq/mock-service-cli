const contentDisposition = require('content-disposition');
const mime = require('mime-types');

function responseFilename(headers) {
  let name;
  try {
    name = contentDisposition.parse(headers['content-disposition']).parameters.filename;
  } catch {
    // Missing or malformed attachment names fall back to the response media type.
  }
  if (typeof name === 'string') {
    name = name
      .split(/[/\\]/)
      .pop()
      // eslint-disable-next-line no-control-regex -- Strip control characters from untrusted filenames.
      .replace(/[\u0000-\u001f\u007f-\u009f<>:"|?*\u202a-\u202e\u2066-\u2069]/g, '_')
      .replace(/^[. ]+|[. ]+$/g, '');
    if (name && name.length <= 180) {
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
      return name;
    }
  }
  const type = String(headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const extension = type.endsWith('+json') ? 'json' : type.endsWith('+xml') ? 'xml' : mime.extension(type);
  return `response.${extension || 'bin'}`;
}

module.exports = { responseFilename };
