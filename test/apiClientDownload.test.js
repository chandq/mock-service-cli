const { test } = require('tap');
const { responseFilename } = require('../src/lib/apiClient/download');

test('response filenames follow attachment names and media types safely', t => {
  const cases = [
    [{ 'content-type': 'application/json; charset=utf-8' }, 'response.json'],
    [{ 'content-type': 'application/problem+json' }, 'response.json'],
    [{ 'content-type': 'text/plain' }, 'response.txt'],
    [{ 'content-type': 'application/xml' }, 'response.xml'],
    [{ 'content-type': 'image/png' }, 'response.png'],
    [{ 'content-type': 'application/pdf' }, 'response.pdf'],
    [{ 'content-type': 'unknown/type' }, 'response.bin'],
    [{}, 'response.bin'],
    [{ 'content-disposition': 'attachment; filename="report.csv"' }, 'report.csv'],
    [
      { 'content-disposition': "attachment; filename=fallback.txt; filename*=UTF-8''%E6%8A%A5%E5%91%8A.json" },
      '报告.json'
    ],
    [{ 'content-disposition': 'attachment; filename="../../report.json"' }, 'report.json'],
    [{ 'content-disposition': 'attachment; filename="..\\\\report.json"' }, 'report.json'],
    [{ 'content-disposition': 'attachment; filename="CON.txt"' }, '_CON.txt'],
    [{ 'content-disposition': 'attachment; filename="bad:name?.txt"' }, 'bad_name_.txt'],
    [{ 'content-disposition': 'attachment; filename=".."', 'content-type': 'application/json' }, 'response.json'],
    [{ 'content-disposition': 'invalid;', 'content-type': 'text/plain' }, 'response.txt'],
    [{ 'content-disposition': "attachment; filename*=UTF-8''bad%0D%0Aname.txt" }, 'bad__name.txt']
  ];
  for (const [headers, expected] of cases) t.equal(responseFilename(headers), expected);
  t.end();
});
