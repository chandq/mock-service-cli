const { parentPort, workerData } = require('worker_threads');
const { readFileSync } = require('fs');
const { evaluate } = require('./model');

// This module runs only in a resource-limited worker, never on the HTTP event loop.
let json;
try {
  json = JSON.parse(readFileSync(workerData.file, 'utf8'));
} catch {
  // Non-JSON bodies can still be checked using status, timing and headers.
}
parentPort.postMessage(evaluate(workerData.rules, workerData.result, json));
