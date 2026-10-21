/**
 * DSH 插件入口 — 把 B站投稿能力注册成两个模型可调用的工具。
 * 自动化逻辑在 browser.js；这里只做工具声明。
 * @module dsh-bilibili-publisher
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { BilibiliBrowser } from './browser.js'

export const name = 'dsh-bilibili-publisher'
export const inject = ['tools']

/** 设置页保存的运营配置，与浏览器目录同放一处。 */
const CONFIG_PATH = join(homedir(), '.dsh', 'bilibili-publisher', 'settings.json')

const DEFAULT_CONFIG = Object.freeze({
  defaultTags: '',
  defaultDescription: '',
  autoOpenBrowser: true,
})

/** 读配置；文件缺失或损坏时退回默认值。 */
function readConfig() {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

/** 写配置；返回写入后的完整值。 */
function writeConfig(next) {
  const merged = {
    defaultTags: typeof next.defaultTags === 'string' ? next.defaultTags : DEFAULT_CONFIG.defaultTags,
    defaultDescription: typeof next.defaultDescription === 'string' ? next.defaultDescription : DEFAULT_CONFIG.defaultDescription,
    autoOpenBrowser: next.autoOpenBrowser !== false,
  }
  mkdirSync(dirname(CONFIG_PATH), { recursive: true })
  writeFileSync(CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
  return merged
}

/** 读完请求体并解析 JSON，空体视为 {}。 */
function readJson(req) {
  return new Promise((resolveBody) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      try {
        resolveBody(raw ? JSON.parse(raw) : {})
      } catch {
        resolveBody({})
      }
    })
    req.on('error', () => resolveBody({}))
  })
}

/** 统一 JSON 响应。 */
function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

export function apply(ctx, config = {}) {
  const browser = new BilibiliBrowser({ profileDir: config.profileDir, headless: config.headless })
  ctx.effect(() => () => browser.close(), 'bilibili-publisher')

  // 设置页 API：webServer 可能早于或晚于本插件就绪，两条路径都试一次。
  // 早到就当场注册；晚到用条件注入等它出现。routesReady 挡住重复注册。
  let routesReady = false
  const mountRoutes = (webServer) => {
    if (routesReady || !webServer) return
    routesReady = true
    const routes = [
      {
        kind: 'exact',
        path: '/bilibili/api/status',
        handler: async (_req, res) => {
          const status = await browser.status()
          sendJson(res, 200, status)
        },
      },
      {
        kind: 'exact',
        path: '/bilibili/api/config',
        handler: async (req, res) => {
          if (req.method === 'POST') {
            sendJson(res, 200, writeConfig(await readJson(req)))
            return
          }
          sendJson(res, 200, readConfig())
        },
      },
      {
        kind: 'exact',
        path: '/bilibili/api/login',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'POST only' })
            return
          }
          const { started } = browser.startLogin()
          sendJson(res, 200, { started })
        },
      },
    ]
    for (const route of routes) ctx.effect(() => webServer.register(route), `bilibili-publisher:${route.path}`)
  }

  // 路径一：服务已在场
  mountRoutes(ctx.get('webServer'))
  // 路径二：服务稍后出现
  ctx.inject(['webServer'], (httpCtx) => {
    mountRoutes(httpCtx.get('webServer'))
  })

  ctx.tools.register(defineTool({
    name: 'bilibili_login',
    description: '打开 B站登录页扫码登录，登录态存在本地，后续上传复用。只需一次。',
    parameters: {
      timeoutSeconds: { type: 'integer', required: false, description: '等待扫码秒数，默认 180。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          loggedIn: { type: 'boolean', required: true },
          profileDir: { type: 'string', required: true },
        },
      },
      render: (_a, v) => [{
        type: 'text',
        text: v.loggedIn ? `已登录，登录态保存在 ${v.profileDir}` : '未完成扫码，准备好后重新运行。',
      }],
    },
    async execute(args) {
      const { loggedIn } = await browser.login((args.timeoutSeconds ?? 180) * 1000)
      return { loggedIn, profileDir: browser.profileDir }
    },
    presentCall: () => ({ card: 'generic', title: 'B站登录', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'bilibili_upload',
    description:
      '把本地视频上传到 B站并预填标题、简介、标签、封面，停在发布按钮前等人工确认。'
      + '不会发布视频，用户需在浏览器里自己点发布。',
    parameters: {
      videoPath: { type: 'string', required: true, description: '视频文件绝对路径。' },
      title: { type: 'string', required: true, description: '标题。' },
      description: { type: 'string', required: false, description: '简介。' },
      tags: {
        type: 'array',
        required: false,
        description: '标签，每个元素一个。',
        items: { type: 'string' },
      },
      coverPath: { type: 'string', required: false, description: '封面图绝对路径。' },
      timeoutSeconds: { type: 'integer', required: false, description: '单字段等待秒数，默认 60。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          publishFound: { type: 'boolean', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_a, v) => {
        const lines = [
          v.publishFound
            ? '表单已填好，发布按钮已就位。视频尚未发布。'
            : '表单已填好，但没找到发布按钮。视频尚未发布。',
        ]
        if (v.warnings.length) lines.push(`注意：${v.warnings.join('；')}`)
        lines.push('请在浏览器里检查并自己点发布。')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      // 设置页里的默认值只在调用方没给时才补，显式参数始终优先。
      const saved = readConfig()
      const tags = args.tags?.length
        ? args.tags
        : saved.defaultTags.split(/[,，]/).map(t => t.trim()).filter(Boolean)
      return browser.upload({
        videoPath: args.videoPath,
        title: args.title,
        description: args.description ?? saved.defaultDescription ?? undefined,
        tags,
        coverPath: args.coverPath,
        timeoutMs: (args.timeoutSeconds ?? 60) * 1000,
      })
    },
    presentCall: a => ({ card: 'generic', title: 'B站投稿', kind: 'other', rawInput: { title: a.title } }),
  }))
}
