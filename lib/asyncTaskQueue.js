/*
 * @description: 异步任务队列
 * @Date: 2022-01-04 10:46:20
 * @LastEditors: chendq
 * @LastEditTime: 2022-01-05 18:45:36
 * @Author: chendq
 */
// const { getDataType } = require('./utils');
class AsyncTaskQueue {
  constructor() {
    this.list = [];
    this.index = 0;
    this.isStop = false;
    this.isParallel = false;
  }

  next() {
    // 加限制
    if (this.index >= this.list.length - 1 || this.isStop) return;
    const cur = this.list[++this.index];
    cur(this.next.bind(this));
  }
  /**
   * @description: 增加异步任务
   * @param {array} fn
   */
  add(...fn) {
    this.list.push(...fn);
  }
  /**
   * @description: 按序执行异步任务
   */
  run() {
    const cur = this.list[this.index];
    typeof cur === 'function' && cur(this.next.bind(this));
  }

  /**
   * @description: 并发执行异步任务
   */
  parallelRun() {
    this.isParallel = true;
    for (const fn of this.list) {
      fn(this.next.bind(this));
    }
  }

  /**
   * @description: 暂停执行异步任务
   */
  stop() {
    this.isStop = true;
  }

  /**
   * @description: 重试执行异步任务
   */
  retry() {
    this.isStop = false;
    run();
  }
  /**
   * @description: 继续执行下一个异步任务
   */
  goOn() {
    this.isStop = false;
    this.next();
  }
}
module.exports = AsyncTaskQueue;
