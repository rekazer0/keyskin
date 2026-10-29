// 检查更新：版本号按语义化版本比较，beta 版之间、beta 与正式版之间都能判断出新旧。
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkForUpdate } from '../src/update.ts'

const api = (tag) => async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ tag_name: tag }) })
const html = (...tags) => async () => ({
  ok: true, status: 200,
  text: async () => tags.map((tag) => `<a href="/rekazer0/BdiEditor/releases/tag/${tag}">${tag}</a>`).join('\n'),
})

test('a newer beta, and the release a beta leads to, are offered as updates', async () => {
  assert.equal((await checkForUpdate('2.0.0-beta6', api('v2.0.0-beta7'))).status, 'available')
  assert.equal((await checkForUpdate('2.0.0-beta9', api('v2.0.0-beta10'))).status, 'available')
  const release = await checkForUpdate('2.0.0-beta6', api('v2.0.0'))
  assert.deepEqual([release.status, release.latestVersion, release.url], ['available', '2.0.0', 'https://github.com/rekazer0/BdiEditor/releases/tag/v2.0.0'])
})

test('the same or an older version is reported as latest', async () => {
  assert.equal((await checkForUpdate('2.0.0-beta6', api('v2.0.0-beta6'))).status, 'latest')
  assert.equal((await checkForUpdate('2.0.0', api('v2.0.0-beta6'))).status, 'latest')
  assert.equal((await checkForUpdate('2.0.0-beta6', api('v1.9.109'))).status, 'latest')
})

test('the releases page lists beta tags too', async () => {
  const result = await checkForUpdate('2.0.0-beta6', html('v2.0.0-beta5', 'v2.0.0-beta7', 'v1.9.109'))
  assert.deepEqual([result.status, result.latestVersion], ['available', '2.0.0-beta7'])
})
