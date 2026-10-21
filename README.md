# dsh-bilibili-publisher

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 用的 B 站投稿助手。

**上传视频、填好标题/简介/标签/封面，然后停在「发布」按钮前——由你自己点发布。**

不做全自动代发，不碰验证码，不做批量矩阵号。

## 安装

```sh
dsh plugin --profile <你的profile> add github:<你的用户名>/dsh-bilibili-publisher
```

装完重启 dsh，模型就多出两个工具。

## 用

```
bilibili_login        扫码登录（只需一次，登录态存在 ~/.dsh/bilibili-publisher）
bilibili_upload       上传 + 预填，参数：videoPath / title / description / tags / coverPath
```

直接跟模型说：

> 把 D:\videos\demo.mp4 传到 B 站，标题「X」，标签「A,B」

模型会先查你登录没有，没登录会让你扫码；登录了就上传填表，然后提示你去点发布。

## 实现

| 文件 | 作用 |
|---|---|
| `index.js` | 注册两个工具（约 100 行） |
| `browser.js` | Playwright 自动化核心（约 160 行） |
| `cordis.patch.yml` | 把插件挂进 profile |
| `selftest.mjs` | 离线自测，不需要账号 |

- 用**系统 Chrome**（退化到 Edge），不下载浏览器
- 每个字段配多个候选选择器，B 站改版时自动降级
- 简介是 Quill 编辑器，逐字输入才能触发状态
- 登录态是本地 Chrome profile，不进仓库

## 自测

```sh
npm install
node selftest.mjs
```

起一个本地 mock 投稿页，跑真实的 `upload()`，断言页面自己的 JS 事件真的收到了
标题、简介、标签、视频和封面。

## 边界

- 不点发布、不提交表单、不绕过验证码/滑块
- B 站没有官方投稿 API，本项目走浏览器自动化，处在平台条款灰区
- 高频发布会被风控；请每次人工确认

## License

MIT
