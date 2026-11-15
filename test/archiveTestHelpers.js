// tap 15's promise assertions can end an async test before the awaited
// assertion is processed on Windows, which corrupts the TAP plan of the rest
// of the file. These helpers keep the same checks without tap's Waiter.
async function expectRejection(t, promise, pattern, message) {
  let error = null;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  const actual = error ? String(error.message) : '';
  t.ok(Boolean(error) && pattern.test(actual), message, {
    found: error ? actual : 'promise resolved'
  });
}

module.exports = { expectRejection };
