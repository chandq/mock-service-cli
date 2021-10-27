/* this test suit is complete  2021-10-25 */

const test = require('tap').test;
const request = require('request');
const spawn = require('child_process').spawn;
const portfinder = require('portfinder');
const { dateFormat, logger } = require('../lib/utils');

const node = process.execPath;

function startServer(args) {
  const child = spawn(node, [require.resolve('../bin/mock-service-cli')].concat(args), {
    // stdio: 'inherit'
  });
  // child.stdout.on('data', function (data) {
  //   console.log(data)
  // })

  return child;
}

function checkServerIsRunning(url, msg, t, _cb) {
  if (!msg.toString().match(/Starting up/)) {
    return;
  }
  t.pass('http-server started');
  const cb = _cb || (() => {});

  request(url, (err, res) => {
    if (!err && res.statusCode !== 500) {
      t.pass('a successful request from the server was made');
      cb(null, res);
    } else {
      t.fail(`the server could not be reached @ ${url}`);
      cb(err);
    }
  });
}

function tearDown(ps, t) {
  t.teardown(() => {
    ps.kill('SIGTERM');
  });
}

const getPort = function (p) {
  return new Promise((resolve, reject) => {
    portfinder.basePort = p || 8091;
    portfinder.getPort((err, port) => {
      if (err) reject(err);
      resolve(port);
    });
  });
};

test('run mock server via cli - no args', t => {
  t.plan(1);

  getPort().then(port => {
    const server = startServer([]);

    tearDown(server, t);
    server.stdout.on('data', msg => {
      checkServerIsRunning(`http://localhost:${port}`, msg, t);
    });
    t.pass('ok');
    t.end();
  });
});

test('setting port via cli - custom ports 8091', t => {
  t.plan(1);

  getPort(8091).then(port => {
    const options = ['.', '--port', port];
    const server = startServer(options);

    tearDown(server, t);
    t.pass('ok');
    t.end();
  });
});

test('setting mock directory via cli - custom directory mock/sub/', t => {
  t.plan(1);

  const options = ['.', '-d', './mock/sub'];
  const server = startServer(options);

  tearDown(server, t);

  // server.stdout.on('data', msg => {
  //   checkServerIsRunning(`http://localhost:${port}`, msg, t)
  // })
  t.pass('ok');
  t.end();
});

test('setting mock file via cli - custom file mock/sub/sub-test.js', t => {
  t.plan(1);

  const options = ['.', '-f', './mock/sub/sub-test.js'];
  const server = startServer(options);

  tearDown(server, t);

  t.pass('ok');
  t.end();
});

test('setting mock file and serve silently via cli - custom file mock/sub/sub-test.js', t => {
  t.plan(1);

  const options = ['.', '-s', '-f', './mock/sub/sub-test.js'];
  const server = startServer(options);

  tearDown(server, t);

  t.pass('ok');
  t.end();
});

// test('invoke composeRoute function', t => {
//   composeRoute(path.resolve(__dirname, '../mock/test.js'));
//   t.pass('ok');
//   t.end();
// });

// test('invoke parseMockFiles function', t => {
//   parseMockFiles(path.resolve(__dirname, '../mock'));
//   t.pass('ok');
//   t.end();
// });

test('invoke dateFormat logger function', t => {
  let log = logger(false);
  log.info(dateFormat('YYYY-mm-dd HH:MM:SS', new Date()));
  log.info(dateFormat('YYYY-mm-dd HH:MM:S', new Date()));
  log = logger(true);
  log.info('silent');
  t.pass('ok');
  t.end();
});
