/**
 * B站投稿自动化核心 — 不依赖 DSH，可单独测试。
 * 只负责把表单填好，永远不点发布。
 * @module dsh-bilibili-publisher/browser
 */

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const UPLOAD_URL = 'https://member.bilibili.com/platform/upload/video/frame'
export const LOGIN_URL = 'https://passport.bilibili.com/login'

/** 每个字段的候选选择器，按顺序取第一个可见的。 */
export const SELECTORS = {
  video: ['input[type="file"][accept*="video"]', 'input[type="file"]'],
  title: ['input.input-val[placeholder*="标题"]', 'input[placeholder*="标题"]', '.video-title input'],
  desc: ['.ql-editor[contenteditable="true"]', 'div[contenteditable="true"]'],
  tags: ['input[placeholder*="标签"]', 'input[placeholder*="回车"]', '.tag-input input'],
  cover: ['input[type="file"][accept*="image"]'],
  publish: ['.submit-add', 'button:has-text("立即投稿")', 'button:has-text("发布")'],
}

/** 取第一个可见元素。 */
export async function pick(page, selectors, timeout = 1500) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first()
    if (await loc.isVisible({ timeout }).catch(() => false)) return loc
  }
  return null
}

/** 轮询等待任一选择器出现。 */
export async function waitPick(page, selectors, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const loc = await pick(page, selectors)
    if (loc) return loc
    await page.waitForTimeout(400)
  }
  return null
}

/** 持久化 Chrome 实例，登录态跨会话保留。 */
export class BilibiliBrowser {
  #ctx
  #page
  #closing

  constructor({ profileDir, headless = false } = {}) {
    this.profileDir = resolve(profileDir ?? join(homedir(), '.dsh', 'bilibili-publisher'))
    this.headless = headless
  }

  async page() {
    if (this.#page && !this.#page.isClosed()) return this.#page
    if (!this.#ctx) await this.#launch()
    this.#page = this.#ctx.pages()[0] ?? (await this.#ctx.newPage())
    return this.#page
  }

  /** 优先系统 Chrome，退回 Edge；都不下载浏览器。 */
  async #launch() {
    const { chromium } = await import('playwright-core')
    mkdirSync(this.profileDir, { recursive: true })
    let last
    for (const channel of ['chrome', 'msedge']) {
      try {
        this.#ctx = await chromium.launchPersistentContext(this.profileDir, {
          channel,
          headless: this.headless,
          viewport: { width: 1440, height: 900 },
          args: ['--disable-blink-features=AutomationControlled'],
        })
        return
      } catch (e) {
        last = e
      }
    }
    throw new Error(`找不到 Chrome 或 Edge：${last?.message ?? ''}`, { cause: last })
  }

  /** profile 里是否有 SESSDATA 登录 cookie。 */
  async isLoggedIn() {
    if (!this.#ctx) return false
    try {
      const cookies = await this.#ctx.cookies('https://www.bilibili.com')
      return cookies.some(c => c.name === 'SESSDATA' && c.value)
    } catch {
      return false
    }
  }

  /** 打开登录页等扫码。 */
  async login(timeoutMs = 180_000) {
    const page = await this.page()
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' })
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      if (await this.isLoggedIn()) return { loggedIn: true }
      await page.waitForTimeout(800)
    }
    return { loggedIn: await this.isLoggedIn() }
  }

  /** 上传并预填，返回是否找到发布按钮。绝不提交。 */
  async upload(spec) {
    const timeout = spec.timeoutMs ?? 60_000
    const warnings = []
    const page = await this.page()

    await page.goto(spec.url ?? UPLOAD_URL, { waitUntil: 'domcontentloaded' })
    if (page.url().includes('passport.bilibili.com')) {
      throw new Error('未登录：先调用 bilibili_login')
    }

    const file = await waitPick(page, SELECTORS.video, timeout)
    if (!file) throw new Error('找不到上传控件，投稿页可能已改版')
    await file.setInputFiles(spec.videoPath)

    // 不依赖「上传完成」文案（B站改版频繁）：等标题框出现即视为表单就绪，
    // 上传本身在后台继续，填表与上传并行。
    await waitPick(page, SELECTORS.title, timeout)

    if (spec.title) {
      const el = await waitPick(page, SELECTORS.title, timeout)
      if (el) { await el.click(); await el.fill(spec.title) }
      else warnings.push('找不到标题框')
    }

    if (spec.description) {
      const el = await waitPick(page, SELECTORS.desc, timeout)
      // Quill 编辑器不认 fill()，必须逐字输入才能触发状态更新
      if (el) { await el.click(); await page.keyboard.type(spec.description, { delay: 10 }) }
      else warnings.push('找不到简介框')
    }

    if (spec.tags?.length) {
      const el = await waitPick(page, SELECTORS.tags, timeout)
      if (el) {
        for (const tag of spec.tags) {
          await el.click(); await el.fill(tag)
          await page.keyboard.press('Enter'); await page.waitForTimeout(200)
        }
      } else warnings.push('找不到标签框')
    }

    if (spec.coverPath) {
      const el = await pick(page, SELECTORS.cover)
      if (el) { await el.setInputFiles(spec.coverPath); await page.waitForTimeout(1200) }
      else warnings.push('找不到封面控件')
    }

    const publish = await pick(page, SELECTORS.publish)
    return { publishFound: publish !== null, warnings }
  }

  async close() {
    this.#closing ??= (async () => {
      const ctx = this.#ctx
      this.#ctx = undefined
      this.#page = undefined
      if (ctx) await ctx.close()
    })()
    return this.#closing
  }
}
