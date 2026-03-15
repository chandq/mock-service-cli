const test = require('tap').test;
const AsyncTaskQueue = require('../lib/asyncTaskQueue');

test('AsyncTaskQueue constructor - basic initialization', t => {
  t.plan(5);

  const queue = new AsyncTaskQueue();

  t.ok(queue.list, 'list exists');
  t.equal(queue.index, 0, 'index starts at 0');
  t.equal(queue.isStop, false, 'isStop is false');
  t.equal(queue.isParallel, false, 'isParallel is false');
  t.equal(queue.isSaveItem, false, 'isSaveItem is false');

  t.end();
});

test('AsyncTaskQueue constructor - with saveItem', t => {
  t.plan(1);

  const queue = new AsyncTaskQueue(true);

  t.equal(queue.isSaveItem, true, 'isSaveItem is true');

  t.end();
});

test('AsyncTaskQueue add method - single task', t => {
  t.plan(1);

  const queue = new AsyncTaskQueue();
  const task = next => next();

  queue.add(task);

  t.equal(queue.list.length, 1, 'task added');

  t.end();
});

test('AsyncTaskQueue add method - multiple tasks', t => {
  t.plan(1);

  const queue = new AsyncTaskQueue();
  const task1 = next => next();
  const task2 = next => next();
  const task3 = next => next();

  queue.add(task1, task2, task3);

  t.equal(queue.list.length, 3, 'multiple tasks added');

  t.end();
});

test('AsyncTaskQueue run method - sequential execution', t => {
  t.plan(1);

  const queue = new AsyncTaskQueue();
  let count = 0;

  const task1 = next => {
    count++;
    next();
  };

  const task2 = next => {
    count++;
    next();
  };

  queue.add(task1, task2);
  queue.run();

  setTimeout(() => {
    t.equal(count, 2, 'both tasks executed');
    t.end();
  }, 50);
});

test('AsyncTaskQueue next method - with saveItem', t => {
  t.plan(2);

  const queue = new AsyncTaskQueue(true);
  let count = 0;

  const task1 = next => {
    count++;
    next();
  };

  const task2 = next => {
    count++;
    next();
  };

  queue.add(task1, task2);
  queue.run();

  setTimeout(() => {
    t.equal(count, 2, 'both tasks executed');
    t.equal(queue.list.length, 2, 'tasks are saved');
    t.end();
  }, 50);
});

test('AsyncTaskQueue parallelRun method - parallel execution', t => {
  t.plan(2);

  const queue = new AsyncTaskQueue();
  let count = 0;

  const task1 = next => {
    count++;
    next();
  };

  const task2 = next => {
    count++;
    next();
  };

  queue.add(task1, task2);
  queue.parallelRun();

  t.equal(queue.isParallel, true, 'isParallel is true');

  setTimeout(() => {
    t.ok(count >= 1, 'at least one task executed');
    t.end();
  }, 50);
});

test('AsyncTaskQueue stop and goOn methods', t => {
  t.plan(3);

  const queue = new AsyncTaskQueue();
  let count = 0;

  const task1 = next => {
    count++;
    queue.stop();
    next();
  };

  const task2 = next => {
    count++;
    next();
  };

  queue.add(task1, task2);
  queue.run();

  t.equal(queue.isStop, true, 'isStop is true');

  setTimeout(() => {
    t.equal(count, 1, 'only first task executed');

    queue.goOn();

    setTimeout(() => {
      t.equal(count, 2, 'second task executed after goOn');
      t.end();
    }, 50);
  }, 50);
});

test('AsyncTaskQueue retry method - with fix', t => {
  t.plan(1);

  const queue = new AsyncTaskQueue();
  let count = 0;

  const task1 = next => {
    count++;
    next();
  };

  queue.add(task1);
  queue.stop();

  queue.retry();

  setTimeout(() => {
    t.pass('retry method called');
    t.end();
  }, 50);
});

test('AsyncTaskQueue - edge cases', t => {
  t.plan(4);

  const queue = new AsyncTaskQueue();

  queue.next();
  t.pass('next on empty queue');

  queue.run();
  t.pass('run on empty queue');

  queue.parallelRun();
  t.pass('parallelRun on empty queue');

  queue.goOn();
  t.pass('goOn on stopped queue');

  t.end();
});
