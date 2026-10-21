/**
 * 离线自测：不需要账号、不连 B站，用本地 mock 页跑真实的 upload() 逻辑。
 * 页面自己的 JS 事件证明值真的写进去了，而不是只看自动化报告成功。
 *
 * 运行：node selftest.mjs
 */

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BilibiliBrowser } from './browser.js'
import { chromium } from 'playwright-core'

const MOCK = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>mock</title></head>
<body>
  <input id="video" type="file" accept="video/*">
  <input id="title" class="input-val" type="text" placeholder="请输入稿件标题">
  <div id="desc" class="ql-editor" contenteditable="true"></div>
  <div class="tag-input"><input id="tag" type="text" placeholder="按回车键Enter创建标签"></div>
  <input id="cover" type="file" accept="image/*">
  <button class="submit-add" type="button">立即投稿</button>
  <script>
    window.__state = { title: '', desc: '', tags: [], video: false, cover: false };
    document.getElementById('title').addEventListener('input', e => { window.__state.title = e.target.value });
    document.getElementById('desc').addEventListener('input', e => { window.__state.desc = e.target.textContent });
    document.getElementById('tag').addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.value) { window.__state.tags.push(e.target.value); e.target.value = '' }
    });
    document.getElementById('video').addEventListener('change', () => {
      window.__state.video = true;
    });
    document.getElementById('cover').addEventListener('change', () => { window.__state.cover = true });
  </script>
</body></html>`

const dir = mkdtempSync(join(tmpdir(), 'bili-selftest-'))
const mockFile = join(dir, 'mock.html')
writeFileSync(mockFile, MOCK, 'utf8')
const videoPath = join(dir, 'a.mp4')
writeFileSync(videoPath, Buffer.alloc(1024))
const coverPath = join(dir, 'a.jpg')
writeFileSync(coverPath, Buffer.alloc(512))

const browser = new BilibiliBrowser({ profileDir: join(dir, 'profile'), headless: true })

try {
  const result = await browser.upload({
    url: pathToFileURL(mockFile).href,
    videoPath,
    title: '自测标题',
    description: '自测简介',
    tags: ['标签甲', '标签乙'],
    coverPath,
    timeoutMs: 5000,
  })

  const page = await browser.page()
  const state = await page.evaluate(() => window.__state)

  assert.equal(state.video, true, '视频文件要真的进入 input')
  assert.equal(state.title, '自测标题', '标题要真的写进页面')
  assert.equal(state.desc, '自测简介', '简介要真的写进页面')
  assert.deepEqual(state.tags, ['标签甲', '标签乙'], '标签要按顺序成为 chip')
  assert.equal(state.cover, true, '封面要真的进入 input')
  assert.equal(result.publishFound, true, '要能找到发布按钮')
  assert.deepEqual(result.warnings, [], '不应有警告')

  console.log('PASS  视频文件注入')
  console.log('PASS  标题写入')
  console.log('PASS  简介逐字输入')
  console.log('PASS  标签依次成 chip')
  console.log('PASS  封面注入')
  console.log('PASS  发布按钮已定位（且未点击）')
  console.log('\n自测通过，全程无账号、无网络。')
} finally {
  await browser.close().catch(() => {})
}
