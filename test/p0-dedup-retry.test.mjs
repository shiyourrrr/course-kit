import test from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateAssets } from '../src/asset-dedup.mjs';
import { renameRetry, renameSyncRetry } from '../src/fs-retry.mjs';

test('deduplicateAssets leaves single-use assets byte-identical', () => {
  const payload = 'data:image/png;base64,' + 'A'.repeat(600);
  const sections = [`<section><div style="background-image: url('${payload}')"></div></section>`];
  const res = deduplicateAssets(sections, []);
  assert.deepEqual(res.sections, sections);
  assert.equal(res.cssRule, '');
  assert.equal(res.bootScript, '');
});

test('deduplicateAssets deduplicates CSS url(data:...) including &quot; and background shorthand', () => {
  const payload = 'data:image/jpeg;base64,' + 'B'.repeat(800);
  const sections = [
    `<section><div style="background: url('${payload}') center/cover no-repeat"></div></section>`,
    `<section><div style="background-image:url(&quot;${payload}&quot;);width:100px"></div></section>`,
  ];
  const res = deduplicateAssets(sections, []);
  assert.equal(res.dedupedCssCount, 1);
  assert.ok(res.cssRule.includes(payload));
  const combined = res.sections.join('\n') + '\n' + res.cssRule;
  assert.equal(combined.split(payload).length - 1, 1);
  assert.ok(res.sections[0].includes('center/cover no-repeat'));
});

test('deduplicateAssets deduplicates cross-carrier <img src> + CSS url() payload to single copy', () => {
  const payload = 'data:image/jpeg;base64,' + 'D'.repeat(1024);
  const sections = [
    `<section><img src="${payload}" style="width:100px"></section>`,
    `<section><div style="background-image: url('${payload}')"></div></section>`,
  ];
  const res = deduplicateAssets(sections, []);
  const combined = res.sections.join('\n') + '\n' + res.cssRule;
  assert.equal(combined.split(payload).length - 1, 1);
  assert.match(res.sections[0], /data-ck-css="--ck-a-[0-9a-f]{8}"/);
  assert.ok(res.bootScript.includes('setProperty'));
});

test('renameRetry and renameSyncRetry recover from transient EPERM/EBUSY', async () => {
  let asyncCalls = 0;
  await renameRetry('a', 'b', {
    delays: [1, 2, 4],
    renameFn: async () => {
      asyncCalls += 1;
      if (asyncCalls < 3) {
        const err = new Error('locked');
        err.code = 'EPERM';
        throw err;
      }
    },
  });
  assert.equal(asyncCalls, 3);

  let syncCalls = 0;
  renameSyncRetry('a', 'b', {
    delays: [1, 2, 4],
    renameFn: () => {
      syncCalls += 1;
      if (syncCalls < 2) {
        const err = new Error('busy');
        err.code = 'EBUSY';
        throw err;
      }
    },
  });
  assert.equal(syncCalls, 2);
});
