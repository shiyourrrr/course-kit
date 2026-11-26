import fs from 'node:fs/promises';
import { renameSync } from 'node:fs';

const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const DEFAULT_DELAYS = [20, 40, 80];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sleepSync = (ms) => {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/**
 * Windows 下杀软/索引/预览偶发短时锁住临时文件或目标文件导致 EPERM/EBUSY，
 * 最多重试 3 次（默认 20/40/80ms 退避），仍失败则原样抛出。
 */
export async function renameRetry(src, dst, options = {}) {
  const delays = options.delays ?? DEFAULT_DELAYS;
  const renameFn = options.renameFn ?? fs.rename;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await renameFn(src, dst);
    } catch (error) {
      if (!RETRY_CODES.has(error?.code) || attempt >= delays.length) throw error;
      await sleep(delays[attempt]);
    }
  }
}

export function renameSyncRetry(src, dst, options = {}) {
  const delays = options.delays ?? DEFAULT_DELAYS;
  const renameFn = options.renameFn ?? renameSync;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return renameFn(src, dst);
    } catch (error) {
      if (!RETRY_CODES.has(error?.code) || attempt >= delays.length) throw error;
      sleepSync(delays[attempt]);
    }
  }
}
