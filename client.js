/**
 * B站投稿助手 — 设置页（浏览器端）。
 *
 * 以 DSH 客户端模块格式直接编写，由宿主在 /plugins/dsh-bilibili-publisher/client.js
 * 提供，浏览器内核加载。通过插件自己的 HTTP API（/bilibili/api/*）与宿主通信，
 * 运行时不引用任何 @deepseek-ai 包。
 *
 * 页面结构：一张状态卡（登录态 + 扫码 + 浏览器目录），下面是可折叠的运营配置组。
 */
window.__ModuleLoader__.load({
	id: "dsh-bilibili-publisher",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		const h = react.createElement;

		const inject = ["slots"];
		const API = "/bilibili/api";

		const CSS = `
.bp_section{display:flex;flex-direction:column;gap:16px;padding:0 24px 24px;max-width:720px}
.bp_card{border:1px solid rgba(128,128,128,.28);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px}
.bp_row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.bp_title{font-weight:600;font-size:14px}
.bp_label{font-size:12px;opacity:.62;min-width:76px}
.bp_value{font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;opacity:.85}
.bp_badge{font-size:11px;padding:2px 9px;border-radius:9px;border:1px solid rgba(128,128,128,.4)}
.bp_badge.ok{color:#2e7d32;border-color:#2e7d32}
.bp_badge.wait{color:#ed6c02;border-color:#ed6c02}
.bp_badge.err{color:#c62828;border-color:#c62828}
.bp_btn{cursor:pointer;font-size:12px;padding:6px 14px;border-radius:8px;border:1px solid rgba(128,128,128,.45);background:transparent;color:inherit}
.bp_btn:hover:not(:disabled){background:rgba(128,128,128,.12)}
.bp_btn:disabled{opacity:.45;cursor:default}
.bp_btn.primary{border-color:var(--dsw-alias-brand-primary,#4c8dff);color:var(--dsw-alias-brand-primary,#4c8dff)}
.bp_hint{font-size:11px;opacity:.55;line-height:1.6}
.bp_group{border:1px solid rgba(128,128,128,.28);border-radius:12px;overflow:hidden}
.bp_group_head{display:flex;align-items:center;gap:8px;padding:12px 16px;cursor:pointer;user-select:none}
.bp_group_head:hover{background:rgba(128,128,128,.07)}
.bp_chevron{font-size:10px;opacity:.5;transition:transform .15s;display:inline-block}
.bp_chevron.open{transform:rotate(90deg)}
.bp_group_title{font-size:13px;font-weight:600;flex:1}
.bp_group_summary{font-size:11px;opacity:.55}
.bp_group_body{padding:0 16px 16px;display:flex;flex-direction:column;gap:12px}
.bp_field{display:flex;flex-direction:column;gap:6px}
.bp_field label{font-size:12px;opacity:.7}
.bp_input,.bp_textarea{font:inherit;font-size:12px;padding:7px 10px;border-radius:8px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;width:100%;box-sizing:border-box}
.bp_input:focus,.bp_textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#4c8dff)}
.bp_textarea{resize:vertical;min-height:56px;font-family:inherit}
.bp_switch{display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer}
.bp_switch input{cursor:pointer}
.bp_save{display:flex;align-items:center;gap:10px}
.bp_saved{font-size:11px;color:#2e7d32}
`;

		/** 注入样式表，重复调用只更新内容。 */
		function useStyles() {
			if (typeof document === "undefined") return;
			let tag = document.querySelector('style[data-plugin-css="dsh-bilibili-publisher/section"]');
			if (tag === null) {
				tag = document.createElement("style");
				tag.dataset.plugin = "dsh-bilibili-publisher";
				tag.dataset.pluginCss = "dsh-bilibili-publisher/section";
				document.head.appendChild(tag);
			}
			tag.textContent = CSS;
		}

		/** 调宿主 API，返回解析后的 JSON；失败时抛出可读错误。 */
		async function api(path, options) {
			const response = await fetch(API + path, Object.assign({
				headers: { "Content-Type": "application/json" },
			}, options));
			if (!response.ok) {
				const text = await response.text().catch(() => "");
				throw new Error(text || ("HTTP " + response.status));
			}
			const type = response.headers.get("content-type") || "";
			return type.includes("application/json") ? response.json() : null;
		}

		/** 折叠组的开关，按浏览器本地保存。 */
		const OPEN_KEY = "dsh-bilibili-publisher.openGroups";

		function loadOpen() {
			try {
				const raw = window.localStorage.getItem(OPEN_KEY);
				const parsed = raw ? JSON.parse(raw) : null;
				return parsed && typeof parsed === "object" ? parsed : {};
			} catch (e) {
				return {};
			}
		}

		function saveOpen(next) {
			try {
				window.localStorage.setItem(OPEN_KEY, JSON.stringify(next));
			} catch (e) {
				// 隐私模式下 localStorage 不可用，折叠状态不持久化即可
			}
		}

		/** 可折叠分组。 */
		function Group(props) {
			const [open, setOpen] = react.useState(Boolean(props.open));
			react.useEffect(() => {
				const state = loadOpen();
				if (props.id in state) setOpen(Boolean(state[props.id]));
			}, [props.id]);
			const toggle = () => {
				const next = !open;
				setOpen(next);
				const state = loadOpen();
				state[props.id] = next;
				saveOpen(state);
			};
			return h("div", { className: "bp_group" },
				h("div", { className: "bp_group_head", onClick: toggle },
					h("span", { className: "bp_chevron" + (open ? " open" : "") }, "▶"),
					h("span", { className: "bp_group_title" }, props.title),
					props.summary ? h("span", { className: "bp_group_summary" }, props.summary) : null,
				),
				open ? h("div", { className: "bp_group_body" }, props.children) : null,
			);
		}

		/** 设置页主体。 */
		function BilibiliSection() {
			useStyles();
			const [status, setStatus] = react.useState({ loading: true, loggedIn: false, profileDir: "", busy: false, error: "" });
			const [config, setConfig] = react.useState({ defaultTags: "", defaultDescription: "", autoOpenBrowser: true });
			const [saved, setSaved] = react.useState(false);

			const refresh = react.useCallback(async () => {
				try {
					const next = await api("/status");
					setStatus({ loading: false, loggedIn: Boolean(next.loggedIn), profileDir: String(next.profileDir || ""), busy: false, error: "" });
				} catch (error) {
					setStatus({ loading: false, loggedIn: false, profileDir: "", busy: false, error: String(error.message || error) });
				}
			}, []);

			react.useEffect(() => {
				refresh();
				api("/config").then((next) => {
					if (next) setConfig({
						defaultTags: String(next.defaultTags || ""),
						defaultDescription: String(next.defaultDescription || ""),
						autoOpenBrowser: next.autoOpenBrowser !== false,
					});
				}).catch(() => {
					// 配置读不到时保留表单默认值，用户仍可保存覆盖
				});
			}, [refresh]);

			// 登录进行中时轮询状态，扫码完成即自动更新徽章
			react.useEffect(() => {
				if (!status.busy) return undefined;
				const timer = setInterval(refresh, 2000);
				return () => clearInterval(timer);
			}, [status.busy, refresh]);

			const startLogin = async () => {
				setStatus((prev) => Object.assign({}, prev, { busy: true, error: "" }));
				try {
					const result = await api("/login", { method: "POST", body: "{}" });
					// 宿主已启动浏览器：提示用户去看那个窗口扫码
					if (result && result.started === false) {
						setStatus((prev) => Object.assign({}, prev, {
							error: "登录已在等待扫码中，请查看已打开的浏览器窗口。",
						}));
					}
				} catch (error) {
					setStatus((prev) => Object.assign({}, prev, {
						busy: false,
						error: "无法连接插件服务（" + String(error.message || error) + "）。请重启 DeepSeek Harness 后重试。",
					}));
				}
			};

			const saveConfig = async () => {
				try {
					await api("/config", { method: "POST", body: JSON.stringify(config) });
					setSaved(true);
					setTimeout(() => setSaved(false), 2000);
				} catch (error) {
					setStatus((prev) => Object.assign({}, prev, { error: String(error.message || error) }));
				}
			};

			const badge = status.loading
				? h("span", { className: "bp_badge" }, "检测中")
				: status.loggedIn
					? h("span", { className: "bp_badge ok" }, "已登录")
					: h("span", { className: "bp_badge wait" }, "未登录");

			const tagCount = config.defaultTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean).length;

			return h("div", { className: "bp_section" },
				h("div", { className: "bp_card" },
					h("div", { className: "bp_row" },
						h("span", { className: "bp_title" }, "B站账号"),
						badge,
					),
					h("div", { className: "bp_row" },
						h("span", { className: "bp_label" }, "浏览器目录"),
						h("span", { className: "bp_value" }, status.profileDir || "—"),
					),
					h("div", { className: "bp_row" },
						h("button", {
							className: "bp_btn primary",
							disabled: status.busy || status.loggedIn,
							onClick: startLogin,
						}, status.busy ? "等待扫码…" : "扫码登录"),
						h("button", { className: "bp_btn", onClick: refresh, disabled: status.loading }, "刷新"),
					),
					status.busy
						? h("div", { className: "bp_hint" }, "浏览器窗口已打开，请用 B站 App 扫码。登录成功后此页面会自动更新。")
						: h("div", { className: "bp_hint" }, "登录态保存在上面的浏览器目录里，重启 DSH 后仍然有效。"),
					status.error ? h("div", { className: "bp_hint", style: { color: "#c62828" } }, status.error) : null,
				),

				h(Group, {
					id: "defaults",
					title: "默认投稿信息",
					summary: tagCount > 0 ? tagCount + " 个标签" : "未设置",
				},
					h("div", { className: "bp_field" },
						h("label", null, "默认标签（逗号分隔）"),
						h("input", {
							className: "bp_input",
							value: config.defaultTags,
							placeholder: "例如：AI,编程,教程",
							onChange: (e) => setConfig(Object.assign({}, config, { defaultTags: e.target.value })),
						}),
					),
					h("div", { className: "bp_field" },
						h("label", null, "默认简介模板"),
						h("textarea", {
							className: "bp_textarea",
							value: config.defaultDescription,
							placeholder: "每次投稿时作为简介的初始内容",
							onChange: (e) => setConfig(Object.assign({}, config, { defaultDescription: e.target.value })),
						}),
					),
					h("div", { className: "bp_save" },
						h("button", { className: "bp_btn primary", onClick: saveConfig }, "保存"),
						saved ? h("span", { className: "bp_saved" }, "已保存") : null,
					),
				),

				h(Group, {
					id: "automation",
					title: "自动运营",
					summary: "规划中",
				},
					h("div", { className: "bp_hint" },
						"当前版本只做「上传 + 预填」，发布按钮始终由你点击。",
					),
					h("div", { className: "bp_hint" },
						"全自动发布需要先解决三件事：定时任务如何触发、发布前的审核规则、以及 B站 对脚本投稿的风控。这些还没有确定，所以此处暂不提供开关。",
					),
				),
			);
		}

		function apply(ctx) {
			const register = () => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "bilibili-publisher",
				order: 46,
				label: "B站投稿",
			}, BilibiliSection));
			if (ctx.effect) ctx.effect(register);
			else register();
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
