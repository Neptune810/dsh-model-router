/**
 * dsh-model-router — browser half.
 *
 * Lazy-CJS bundle, written by hand so the package needs no build step.
 *
 * The panel deliberately mirrors the host's own menu design language: the same
 * theme tokens, a 28px trigger, 34px rows with a hover wash, group titles at
 * 11px, glyph checks instead of native checkboxes, and segmented controls
 * instead of native selects.
 */
window.__ModuleLoader__.load({
	id: "@neptune810/dsh-model-router",
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

		const react = require("react")
		const reactDom = require("react-dom")
		const h = react.createElement

		const NS = "dsh-model-router"
		const BASE = "/model-router"
		const STYLE_ID = "model-router-styles"


		const TEXT = {
			zh: {
				title: "模型路由", scope: "控制范围", full: "模型+思考", effort: "思考", model: "模型",
				engaged: "已接管", yielded: "已让位，你手动选过", resume: "重新接管",
				engagedHint: "绿点 = 正在自动接管：按需要换模型、调思考等级；点开可调整",
				yieldedHint: "黄点 = 已让位：你手动选过模型，插件暂时不插手；点开可点「重新接管」",
				task: "任务类型", auto: "自动（按关键词规则）", pool: "模型池", poolHint: "只有勾选的模型会被选中",
				tier: "定位", cheap: "日常", strong: "攻坚", cost: "价格", vision: "视觉",
				tierHint: "日常 = 平时就用它；攻坚 = 只在硬活/工程活时优先（hard +15 分、工程 +8 分）",
				cheapHint: "日常：平时优先用它，省钱",
				strongHint: "攻坚：任务变难、或工具报错等证据出现时才优先",
				costHint: "相对价格，随你标：越贵越要任务够硬才选得中（1/4/8 分别扣 0.4 / 1.6 / 3.2 分）",
				price1: "便宜", price4: "中", price8: "贵",
				visionHint: "带图任务优先选它（+25 分）",
				scopeHint: "插件能改什么：模型+思考 = 模型 + 思考等级；思考 = 只调选中的那一个模型的思考等级；模型 = 只调模型",
				pickModel: "先选一个模型",
				effortModelTitle: "思考模式只作用于一个模型",
				effortModelHint: "在下面选中唯一一个模型，插件只调它的思考等级；没选之前不接管",
				effortBound: "已绑定", effortBind: "接管", poolOther: "其他模型",
				effortDefault: "默认",
				officialModel: "本会话模型", officialEffort: "推理等级",
				officialFallback: "请选择模型", officialLoading: "正在加载模型…",
				officialRefreshing: "正在刷新模型列表…", officialRetry: "重新加载",
				officialDefault: "默认（供应商）", officialAccount: "DeepSeek 账号",
				officialEmpty: "没有可用的模型", officialEmptyEfforts: "该模型没有推理等级",
				officialError: "模型操作失败", officialFailure: "供应商目录加载失败",
				taskHint: "自动 = 按你写的关键词规则判断；也可以强制指定一个类型",
				poolHint2: "勾选可被路由的模型，只有勾选的会被选中；思考模式下改为只选唯一一个",
				imagesHint: "带图步骤：不干预 = 按普通规则；用视觉模型 = 强制走带视觉标记的模型",
				classifierHint: "任务识别：关键词 = 按预设里的 match；语义 = 每轮一次小模型判断",
				pressureHint: "上下文压力：快满时优先用便宜模型",
				bg: "面板背景", bgSolid: "不透明", bgTheme: "跟随主题",
				bgHint: "半透明的主题菜单色会让背后的聊天内容透上来；选「不透明」最好读，选「跟随主题」会加毛玻璃模糊",
				bgSolidHint: "用主题底色算出不透明色，文字最清楚",
				bgThemeHint: "沿用主题的半透明菜单色，再加背景模糊",
				fullHint: "模型和思考等级都交给插件", effortHint: "只调你在下面选中的那一个模型的思考等级；没选之前不接管", modelHint: "只让插件换模型，思考等级不动",
				presets: "任务预设", newPreset: "新建预设", edit: "编辑", remove: "删除",
				name: "名称", keywords: "关键词", add: "添加", custom: "自定义词，回车添加",
				weights: "各模型权重", none: "不参与", save: "保存", cancel: "取消", back: "返回",
				more: "更多", images: "带图步骤", keepImages: "不干预", toVision: "用视觉模型",
				classifier: "任务识别", byRules: "关键词", byLlm: "语义",
				pressure: "上下文压力", on: "快满省", off: "关",
				noPresets: "还没有预设", current: "当前", loading: "读取中…", empty: "没有可选项",
				noSession: "新会话还没建立：这里的选择会成为默认值，发出第一条消息后按会话生效",
				confirmNew: "新对话：先确认这次的路由方案",
				confirmInherited: "已沿用上一次的选择",
				confirmScope: "范围", confirmModel: "思考模型", confirmTask: "任务类型", confirmPool: "模型池",
				confirmAction: "确认", confirmCount: "个",
				confirmNone: "未指定", confirmAuto: "自动",
				confirmHint: "确认后本对话不再提示；改范围 / 模型 / 任务类型 / 模型池会重新提示",
				confirmAttn: "新对话待确认路由方案",
				recent: "最近决策", turnShort: "轮",
				needName: "先给任务类型起个名字", session: "会话",
				poolAdd: "手动填模型 ID", delete: "删",
			},
			en: {
				title: "Model router", scope: "Scope", full: "Model+Effort", effort: "Effort", model: "Model",
				engaged: "Controlling", yielded: "Yielded to your manual pick", resume: "Resume",
				engagedHint: "green dot = the router is controlling: it changes the model / effort as needed; click to adjust",
				yieldedHint: "amber dot = stood down: you picked a model by hand, so the router holds back; click to resume",
				task: "Task type", auto: "Auto (keyword rules)", pool: "Model pool", poolHint: "only ticked models are selectable",
				tier: "Role", cheap: "daily", strong: "heavy", cost: "Price", vision: "vision",
				tierHint: "daily = use it all the time; heavy = prefer it for hard/engineering steps (hard +15, engineering +8)",
				cheapHint: "daily: preferred by default, saves money",
				strongHint: "heavy: preferred once a step turns hard or evidence of trouble appears",
				costHint: "your own relative price: the dearer it is, the harder the step must be to pick it (1/4/8 deduct 0.4 / 1.6 / 3.2)",
				price1: "low", price4: "mid", price8: "high",
				visionHint: "image steps prefer this model (+25)",
				scopeHint: "what the router may change: Model+Effort = model + effort; Effort = only the thinking level of the one model you pick; Model = model only",
				pickModel: "pick a model first",
				effortModelTitle: "Effort mode works on one model",
				effortModelHint: "pick exactly one model below — the router only adjusts its thinking level and stays out until you do",
				effortBound: "bound", effortBind: "take over", poolOther: "Other models",
				effortDefault: "default",
				officialModel: "Session model", officialEffort: "Reasoning effort",
				officialFallback: "Select model", officialLoading: "Loading models…",
				officialRefreshing: "Refreshing model list…", officialRetry: "Reload",
				officialDefault: "Default", officialAccount: "DeepSeek Account",
				officialEmpty: "No models available", officialEmptyEfforts: "This model provides no reasoning effort levels",
				officialError: "Model operation failed", officialFailure: "provider catalog failed to load",
				taskHint: "auto = your keyword rules decide; or force one type",
				poolHint2: "tick the models the router may use — only ticked ones are selectable; effort mode picks exactly one",
				imagesHint: "image steps: leave alone = normal rules; vision model = force a vision-tagged model",
				classifierHint: "detection: keywords = the match list in your presets; semantic = one small model call per turn",
				pressureHint: "context pressure: prefer the cheap model when the window is nearly full",
				bg: "Panel surface", bgSolid: "opaque", bgTheme: "theme",
				bgHint: "the theme's menu colour is translucent, so the conversation shows through; opaque is the most readable, theme adds a backdrop blur",
				bgSolidHint: "compute an opaque colour from the theme base — most readable",
				bgThemeHint: "keep the translucent menu colour and blur what is behind it",
				fullHint: "let the router change both model and effort", effortHint: "only the thinking level of the one model you pick below — out until you do", modelHint: "model only, never the effort",
				presets: "Task presets", newPreset: "New preset", edit: "Edit", remove: "Delete",
				name: "Name", keywords: "Keywords", add: "Add", custom: "custom word, press enter",
				weights: "Weight per model", none: "off", save: "Save", cancel: "Cancel", back: "Back",
				more: "More", images: "Image steps", keepImages: "leave alone", toVision: "vision model",
				classifier: "Detection", byRules: "keywords", byLlm: "semantic",
				pressure: "Context pressure", on: "cheap", off: "off",
				noPresets: "no presets yet", current: "now", loading: "loading…", empty: "nothing to show",
				noSession: "no session yet — your pick becomes the default and applies once this conversation starts",
				confirmNew: "new conversation — confirm this routing plan",
				confirmInherited: "carried over from your last choice",
				confirmScope: "scope", confirmModel: "effort model", confirmTask: "task", confirmPool: "pool",
				confirmAction: "Confirm", confirmCount: "models",
				confirmNone: "unset", confirmAuto: "auto",
				confirmHint: "asked once per conversation; changing scope / model / task / pool asks again",
				confirmAttn: "new conversation needs a routing plan",
				recent: "Recent routing", turnShort: "turn",
				needName: "name the task type first", session: "session",
				poolAdd: "add a model id", delete: "del",
			},
		}
		const dict = () => (typeof navigator !== "undefined" && /^en/i.test(navigator.language || "") ? TEXT.en : TEXT.zh)

		const PACKS = [
			{ key: "写作", en: "Writing", words: ["续写", "小说", "情节", "文风", "人物", "章节"] },
			{ key: "代码", en: "Code", words: ["重构", "refactor", "架构", "接口", "测试", "性能"] },
			{ key: "翻译", en: "Translate", words: ["翻译", "translate", "润色", "校对"] },
			{ key: "分析", en: "Analysis", words: ["分析", "调研", "对比", "总结", "报告"] },
		]
		const TIERS = [["cheap", "cheap"], ["strong", "strong"]]
		const COSTS = [1, 4, 8]
		const WEIGHTS = [[0, "none"], [40, "low"], [70, "mid"], [95, "high"]]

		/** One stylesheet for the whole panel; hover and focus need real CSS. */
		const CSS = [
			".mr-trigger{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;border:0;border-radius:var(--dsw-radius-sm,6px);background:0 0;color:var(--dsw-alias-label-secondary,#a2a8b0);font:inherit;font-size:13px;line-height:20px;cursor:pointer;transition:background .12s,color .12s}",
			".mr-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#e8e8ea)}",
			".mr-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary,#3fb950)}",
			".mr-dot[data-yielded=true]{background:var(--dsw-alias-state-warn-label,#d29922)}",
			".mr-panel{position:fixed;z-index:2147483000;width:372px;max-height:min(72vh,540px);overflow:auto;padding:6px;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-menu,#232326);color:var(--dsw-alias-label-primary,#e8e8ea);box-shadow:var(--dsw-elevation-prominent,0 16px 48px rgba(0,0,0,.45));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));font-size:13px;line-height:20px;scrollbar-width:thin}",
			".mr-panel::-webkit-scrollbar{width:8px}",
			".mr-panel::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(127,127,127,.3));border-radius:4px}",
			".mr-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:6px;padding:4px 8px 6px;background:inherit;color:var(--dsw-alias-label-tertiary,#8b9096);font-size:11px;letter-spacing:.02em}",
			".mr-panel[data-bg=theme]{-webkit-backdrop-filter:blur(22px) saturate(1.15);backdrop-filter:blur(22px) saturate(1.15)}",
			".mr-group{color:var(--dsw-alias-label-tertiary,#8b9096);font-size:11px;font-weight:500;line-height:16px;padding:8px 8px 2px}",
			".mr-row{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:4px 8px;border:0;border-radius:var(--dsw-radius-md,8px);background:0 0;color:inherit;text-align:left;font:inherit;cursor:pointer;transition:background .12s}",
			".mr-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}",
			".mr-row[data-static=true]{cursor:default}",
			".mr-row[data-static=true]:hover{background:0 0}",
			".mr-body{display:flex;flex-direction:column;gap:2px;padding:2px 8px 6px 34px}",
			".mr-check{flex:0 0 14px;display:grid;place-items:center;color:var(--dsw-alias-label-primary,#e8e8ea)}",
			".mr-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			// The left half of a merged model row picks the session model; the trailing chip
			// ticks the router pool. The row itself is only a container, so it must not
			// swallow the click.
			".mr-pick{display:flex;align-items:center;gap:8px;flex:1;min-width:0;border:0;background:0 0;padding:0;color:inherit;font:inherit;text-align:left;cursor:pointer}",
			".mr-pick:disabled{cursor:default;opacity:.6}",
			".mr-sub{color:var(--dsw-alias-label-caption,#8b9096);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".mr-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:0 0 2px;color:var(--dsw-alias-label-secondary,#a2a8b0);font-size:11px}",
			".mr-tag{flex:none;color:var(--dsw-alias-label-caption,#8b9096);font-size:11px;white-space:nowrap}",
			".mr-seg{display:inline-flex;flex:none;gap:2px;padding:2px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.12))}",
			".mr-seg button{border:0;border-radius:4px;background:0 0;color:var(--dsw-alias-label-secondary,#a2a8b0);font:inherit;font-size:11px;line-height:16px;padding:2px 7px;white-space:nowrap;cursor:pointer;transition:background .12s,color .12s}",
			".mr-seg button:hover:not(:disabled){color:var(--dsw-alias-label-primary,#e8e8ea)}",
			".mr-seg button[data-active=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.3));color:var(--dsw-alias-label-primary,#e8e8ea)}",
			".mr-seg button:disabled{opacity:.45;cursor:default}",
			".mr-btn{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 10px;border:1px solid transparent;border-radius:var(--dsw-radius-sm,6px);background:0 0;color:var(--dsw-alias-label-secondary,#a2a8b0);font:inherit;font-size:12px;text-align:left;cursor:pointer;transition:background .12s,color .12s}",
			".mr-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#e8e8ea)}",
			".mr-btn[data-primary=true]{background:var(--dsw-alias-state-business-primary,#3b82f6);color:#fff}",
			".mr-btn[data-primary=true]:hover:not(:disabled){filter:brightness(1.1)}",
			".mr-btn:disabled{opacity:.45;cursor:default}",
			".mr-icon-btn{width:24px;height:24px;padding:0;justify-content:center;border-radius:var(--dsw-radius-sm,6px)}",
			".mr-input{flex:1;min-width:0;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-base,rgba(0,0,0,.18));color:inherit;font:inherit;font-size:12px;outline:none;transition:border-color .12s}",
			".mr-input:focus{border-color:var(--dsw-alias-state-business-primary,#3b82f6)}",
			".mr-input::placeholder{color:var(--dsw-alias-label-dimmed,#6b7076)}",
			".mr-wrap{display:flex;flex-wrap:wrap;gap:6px;padding:4px 8px 6px 34px}",
			".mr-chip{display:inline-flex;flex:none;align-items:center;gap:4px;height:22px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));border-radius:999px;background:0 0;color:var(--dsw-alias-label-secondary,#a2a8b0);font:inherit;font-size:11px;white-space:nowrap;cursor:pointer;transition:background .12s,color .12s}",
			".mr-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#e8e8ea)}",
			".mr-chip[data-active=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.22));border-color:transparent;color:var(--dsw-alias-label-primary,#e8e8ea)}",
			".mr-actions{display:flex;justify-content:flex-end;gap:6px;padding:8px 8px 2px}",
			".mr-div{height:1px;margin:6px 8px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.18))}",
			".mr-err{margin:4px 8px;padding:6px 8px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-interactive-bg-hover-danger,rgba(248,81,73,.14));color:var(--dsw-alias-state-error-primary,#f85149);font-size:11px;line-height:16px;word-break:break-word}",
			".mr-foot{display:flex;gap:6px;align-items:center;padding:8px 8px 2px;margin-top:2px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));color:var(--dsw-alias-label-caption,#8b9096);font-size:11px}",
			".mr-note{padding:8px;color:var(--dsw-alias-label-caption,#8b9096);font-size:11px}",
			// The per-conversation confirmation: a warn-tinted bar because it wants an answer,
			// plus the pulsing dot that announces it on the composer trigger.
			".mr-confirm{display:flex;flex-direction:column;gap:5px;margin:2px 6px 6px;padding:8px 10px;border:1px solid var(--dsw-alias-state-warn-label,rgba(210,153,34,.45));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-interactive-bg-hover-warn,rgba(210,153,34,.12))}",
			".mr-confirm-head{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-state-warn-label,#d29922);font-size:11px;font-weight:500}",
			".mr-confirm-dot{width:6px;height:6px;border-radius:50%;flex:none;background:currentColor}",
			".mr-confirm-plan{display:flex;flex-wrap:wrap;align-items:center;gap:6px}",
			".mr-confirm-val{color:var(--dsw-alias-label-primary,#e8e8ea)}",
			".mr-confirm-foot{display:flex;align-items:center;gap:8px}",
			".mr-confirm-hint{flex:1;min-width:0;color:var(--dsw-alias-label-caption,#8b9096);font-size:11px;line-height:15px}",
			".mr-attn{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-warn-label,#d29922);animation:mr-attn 1.8s ease-out infinite}",
			"@keyframes mr-attn{0%{box-shadow:0 0 0 0 rgba(210,153,34,.5)}70%{box-shadow:0 0 0 5px rgba(210,153,34,0)}100%{box-shadow:0 0 0 0 rgba(210,153,34,0)}}",
			".mr-trigger:disabled{opacity:.55;cursor:default}",
			".mr-spin{width:10px;height:10px;flex:none;border-radius:50%;border:1.6px solid var(--dsw-alias-border-l1,rgba(127,127,127,.45));border-top-color:var(--dsw-alias-label-primary,#e8e8ea);animation:mr-spin .7s linear infinite}",
			"@keyframes mr-spin{to{transform:rotate(360deg)}}",
			".mr-call{display:flex;align-items:center;gap:4px;max-width:100%;padding:0 2px;color:var(--dsw-alias-label-caption,#8b9096);font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".mr-call-model{min-width:0;color:var(--dsw-alias-label-secondary,#a2a8b0);overflow:hidden;text-overflow:ellipsis}",
			".mr-call-eff{flex:none}",
		].join("")

		function ensureStyles() {
			if (typeof document === "undefined" || !document.head) return
			if (document.getElementById(STYLE_ID)) return
			const style = document.createElement("style")
			style.id = STYLE_ID
			style.textContent = CSS
			document.head.appendChild(style)
		}

		const EMPTY_CATALOG = { subscribe: () => () => {}, getSnapshot: () => null }

		/**
		 * Which composer model cell this control occupies, if any. The official
		 * model selector registers the same cell at priority 0; we register at -1 so
		 * ours is the visible one, and the ".right" chip then stands down.
		 */

		/** Official composer order: the account first, then the official gateway, then the rest. */
		const officialRank = (group) => (group && group.id === "deepseek-account" ? 0 : group && group.id === "deepseek-official" ? 1 : 2)

		/**
		 * The theme's menu colour is usually translucent, which lets the conversation
		 * show through the panel. Measure it and compose it over the theme's base
		 * background so the surface can be painted opaque.
		 */
		function resolveSolid() {
			if (typeof document === "undefined" || !document.body) return null
			const read = (value) => {
				const probe = document.createElement("div")
				probe.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;background-color:" + value
				document.body.appendChild(probe)
				const raw = getComputedStyle(probe).backgroundColor
				document.body.removeChild(probe)
				return raw
			}
			const parse = (raw) => {
				const match = String(raw || "").match(/rgba?\(([^)]+)\)/)
				if (!match) return null
				const parts = match[1].split(",").map((piece) => parseFloat(piece))
				if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null
				return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
			}
			const top = parse(read("var(--dsw-specific-menu, #232326)"))
			if (!top) return null
			if (top.a >= 0.999) return "rgb(" + [top.r, top.g, top.b].join(",") + ")"
			const base = parse(read("var(--dsw-alias-bg-base, #1b1b1e)")) || { r: 27, g: 27, b: 30, a: 1 }
			if (base.a < 0.999) {
				const dark = (top.r + top.g + top.b) / 3 < 128
				return dark ? "rgb(30,30,33)" : "rgb(250,250,251)"
			}
			const over = (channel, baseChannel) => Math.round(channel * top.a + baseChannel * (1 - top.a))
			return "rgb(" + [over(top.r, base.r), over(top.g, base.g), over(top.b, base.b)].join(",") + ")"
		}

		async function api(path, options) {
			const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined
			const timer = controller ? setTimeout(() => controller.abort(), 10000) : undefined
			try {
				const request = {
					method: (options && options.method) || "GET",
					cache: "no-store",
					headers: options && options.body ? { "content-type": "application/json" } : undefined,
					body: options && options.body ? JSON.stringify(options.body) : undefined,
				}
				if (controller) request.signal = controller.signal
				const response = await fetch(BASE + path, request)
				let json = null
				try { json = await response.json() } catch (_noBody) { /* tolerate an empty body */ }
				if (!response.ok) throw new Error((json && json.error) || ("HTTP " + response.status))
				return json
			} catch (error) {
				if (typeof console !== "undefined" && console.warn) console.warn("[model-router] request failed", path, String((error && error.message) || error))
				throw error
			} finally {
				if (timer) clearTimeout(timer)
			}
		}

		function Icon(props) {
			const size = props.size || 14
			const paths = {
				check: "M2.5 7.5l3 3L11.5 4",
				chevron: "M5 2.5l5 4.5-5 4.5",
				back: "M9 2.5L4 7l5 4.5",
				plus: "M7 2.5v9M2.5 7h9",
				close: "M3 3l8 8M11 3l-8 8",
			}
			return h("svg", {
				width: size, height: size, viewBox: "0 0 14 14", fill: "none",
				stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round",
				style: { flex: "none", display: "block" }, "aria-hidden": "true",
			}, h("path", { d: paths[props.name] || paths.check }))
		}

		/** Host-style segmented control: the pretty replacement for a native select. */
		function Segmented(props) {
			return h("div", { className: "mr-seg", title: props.title || undefined },
				props.options.map((option) => h("button", {
					key: String(option.value), type: "button", disabled: props.disabled,
					"data-active": String(option.value) === String(props.value),
					title: option.title || undefined,
					onClick: (event) => { event.stopPropagation(); if (props.onChange) props.onChange(option.value) },
				}, option.label)))
		}

		function ModelRouterControl(props) {
			const sessionId = props && props.sessionId
			const t = dict()
			const [open, setOpen] = react.useState(false)
			const [view, setView] = react.useState("main")
			const [pos, setPos] = react.useState(null)
			const [state, setState] = react.useState(null)
			const [error, setError] = react.useState("")
			const [busy, setBusy] = react.useState(false)
			const [editing, setEditing] = react.useState(null)
			const [customWord, setCustomWord] = react.useState("")
			const [customModel, setCustomModel] = react.useState("")
			const [solidBg, setSolidBg] = react.useState(null)
			const [poolOverride, setPoolOverride] = react.useState(null)
			const [poolOpen, setPoolOpen] = react.useState(false)
			const [hostGroups, setHostGroups] = react.useState([])
			const [catalogStore, setCatalogStore] = react.useState(props && props.resolveCatalog ? props.resolveCatalog() : undefined)
			const [planDone, setPlanDone] = react.useState("")
			const triggerRef = react.useRef(null)
			const panelRef = react.useRef(null)
			const rootRef = react.useRef(null)

			react.useEffect(() => {
				if (!props || !props.resolveCatalog) return
				const found = props.resolveCatalog()
				if (found) setCatalogStore(found)
			}, [props])
			const store = catalogStore || EMPTY_CATALOG
			const catalogSnapshot = react.useSyncExternalStore((fn) => store.subscribe(fn), () => store.getSnapshot())
			const clientGroups = (catalogSnapshot && catalogSnapshot.groups) || []

			// The official composer cell is one popup now: its own model / effort list
			// comes from the ModelDirectory store the seat face hands in. Without that
			// face (the ".right" chip, or a host that never declared the seat) the
			// official half is simply left out and the router panel shows as before.
			const officialStore = (props && props.directory) || null
			const officialSubscribe = react.useCallback((listen) => {
				if (!officialStore || typeof officialStore.subscribe !== "function") return () => {}
				const off = officialStore.subscribe(listen)
				return typeof off === "function" ? off : () => {}
			}, [officialStore])
			const officialRead = react.useCallback(() => {
				if (!officialStore || typeof officialStore.getSnapshot !== "function") return null
				try { return officialStore.getSnapshot() } catch (_noSnapshot) { return null }
			}, [officialStore])
			const official = react.useSyncExternalStore(officialSubscribe, officialRead)

			const load = react.useCallback(() => {
				// A brand-new conversation has no session id yet. The host still answers
				// with the deployment-level state, so the panel must not freeze here.
				const query = sessionId ? "?sessionId=" + encodeURIComponent(sessionId) : ""
				api("/state" + query)
					.then((next) => { setState(next); setError("") })
					.catch((reason) => setError(String((reason && reason.message) || reason)))
			}, [sessionId])

			react.useEffect(() => { load() }, [load])
			// The confirmation is per conversation: a new session asks again.
			react.useEffect(() => { setPlanDone("") }, [sessionId])
			react.useEffect(() => {
				// The host records every routed step; poll so the badge and the panel show
				// the model and effort of the current step while a task is running.
				if (!sessionId || typeof setInterval !== "function") return undefined
				const timer = setInterval(() => {
					if (typeof document !== "undefined" && document.hidden) return
					load()
				}, 2500)
				return () => clearInterval(timer)
			}, [sessionId, load])
			react.useEffect(() => {
				if (typeof console !== "undefined" && console.info) {
					console.info("[model-router] composer control ready (session " + (sessionId || "none") + ")")
				}
			}, [])
			react.useEffect(() => {
				if (!open) return undefined
				const onDown = (event) => {
					const inside = (rootRef.current && rootRef.current.contains(event.target)) ||
						(panelRef.current && panelRef.current.contains(event.target))
					if (!inside) setOpen(false)
				}
				document.addEventListener("mousedown", onDown)
				return () => document.removeEventListener("mousedown", onDown)
			}, [open])

			// Mirror the official cell: a locked session shows a disabled trigger and
			// never opens, and an unavailable (subagent-addressed) one renders nothing.
			const locked = !!(props && props.locked)
			if (props && props.available === false) return null

			const run = (path, body, after) => {
				setBusy(true)
				api(path, { method: "POST", body })
					.then(() => { setError(""); load(); if (after) after() })
					.catch((reason) => { setError(String((reason && reason.message) || reason)); if (after) after() })
					.finally(() => setBusy(false))
			}

			/** Accept the plan for this conversation, so the bar stands down. */
			const confirmPlan = () => {
				if (!planKey) return
				setBusy(true)
				api("/confirm", { method: "POST", body: { sessionId: sessionId, plan: planKey } })
					.then(() => { setError(""); setPlanDone(planKey); load() })
					.catch((reason) => setError(String((reason && reason.message) || reason)))
					.finally(() => setBusy(false))
			}

			const openPanel = () => {
				if (locked) return
				const next = !open
				if (next) {
					setView("main")
					const rect = triggerRef.current && triggerRef.current.getBoundingClientRect()
					setPos(rect && typeof window !== "undefined"
						? {
							bottom: Math.max(8, window.innerHeight - rect.top + 8),
							right: Math.max(8, window.innerWidth - rect.right),
							maxHeight: Math.max(260, rect.top - 16),
						}
						: null)
					load()
					// Opening the merged popup refreshes the official catalog too.
					if (props && typeof props.load === "function") props.load()
					setSolidBg(resolveSolid())
					if (props && props.resolveCatalog) {
						const found = props.resolveCatalog()
						if (found) setCatalogStore(found)
					}
					if (props && props.loadCatalog) props.loadCatalog()
					api("/catalog")
						.then((result) => setHostGroups((result && result.groups) || []))
						.catch(() => setHostGroups([]))
				}
				setOpen(next)
			}

			const mode = state ? state.effectiveControl : "full"
			const yielded = state ? state.engaged === false : false
			const current = state && state.current ? state.current : null
			const currentModel = current ? String(current.model || "").split("/").pop() : ""
			const currentEffort = current ? (current.effort || "default") : ""
			const effortMode = mode === "effort"
			const effortPending = !!(state && state.effortModelPending)
			const effortBoundId = (state && state.effectiveEffortModel) || null
			const pool = poolOverride || ((state && state.pool) || [])
			/**
			 * The pool list is collapsed by default: the router row carries a pool control, so the
			 * menu body does not have to hold every model all the time. Effort scope forces it open
			 * while nothing is bound, because picking the one model comes first.
			 */
			const poolCount = effortMode ? (effortBoundId ? 1 : 0) : pool.length
			const showPool = poolOpen || (effortMode && effortPending)
			// New conversations inherit the last plan and are asked to confirm it once. The host
			// records the confirmation per session; planDone covers the session-less draft, which
			// has no session to record it against.
			const plan = (state && state.plan) || null
			const planKey = (state && state.planKey) || ""
			const inherited = !!(state && state.inherited)
			const needsConfirm = !!(plan && planKey && !(state && state.planConfirmed) && planDone !== planKey)
			const presets = (state && state.presets) || {}
			const settings = (state && state.settings) || {}
			const packed = pool.map((entry) => entry.id)

			/** Rows come from the pool, the host catalog and the client catalog. */
			const rows = []
			const seen = {}
			for (const entry of pool) {
				if (seen[entry.id]) continue
				seen[entry.id] = true
				rows.push({ id: entry.id, label: entry.id })
			}
			for (const group of clientGroups.concat(hostGroups)) {
				for (const model of (group.models || [])) {
					const id = group.id + "/" + model.id
					if (seen[id]) continue
					seen[id] = true
					rows.push({ id: id, label: model.name ? model.name : model.id })
				}
			}

			const savePool = (next) => { setPoolOverride(next); run("/pool", { pool: next }, () => setPoolOverride(null)) }
			const toggleModel = (id) => {
				if (packed.indexOf(id) >= 0) savePool(pool.filter((entry) => entry.id !== id))
				else savePool(pool.concat([{ id: id, tier: "cheap", cost: 1, tags: [] }]))
			}
			const patchEntry = (id, patch) => savePool(pool.map((entry) => (entry.id === id ? Object.assign({}, entry, patch) : entry)))
			const addModel = () => {
				const id = customModel.trim()
				setCustomModel("")
				if (!id || packed.indexOf(id) >= 0) return
				savePool(pool.concat([{ id: id, tier: "cheap", cost: 1, tags: [] }]))
			}
			/**
			 * The trailing control of a merged model row: tick the model into the router pool,
			 * or — in effort scope — bind it as the single model the router may touch.
			 */
			const poolToggle = (id) => {
				if (effortMode) {
					const bound = effortBoundId === id
					return h("button", {
						type: "button", className: "mr-chip", disabled: busy,
						title: t.effortModelHint, "data-effort-bind": id, "data-active": String(bound),
						onClick: () => { if (!bound) run("/effort-model", { sessionId: sessionId, model: id }) },
					}, bound ? t.effortBound : t.effortBind)
				}
				const entry = pool.find((candidate) => candidate.id === id)
				return h("button", {
					type: "button", className: "mr-chip", disabled: busy,
					title: t.poolHint2, "data-pool-toggle": id, "data-active": String(!!entry),
					onClick: () => toggleModel(id),
				}, t.pool)
			}
			/** The tier/cost/vision line under a row, shown once the model is in the pool. */
			const poolOptions = (id) => {
				const entry = pool.find((candidate) => candidate.id === id)
				if (!entry) return null
				return h("div", { key: id + "-opts", className: "mr-line", style: { padding: "0 8px 4px 34px" } },
					h("span", { className: "mr-tag", title: t.tierHint }, t.tier),
					h(Segmented, {
						title: t.tierHint, disabled: busy, value: entry.tier, onChange: (value) => patchEntry(id, { tier: value }),
						options: [
							{ value: "cheap", label: t.cheap, title: t.cheapHint },
							{ value: "strong", label: t.strong, title: t.strongHint },
						],
					}),
					h("span", { className: "mr-tag", title: t.costHint }, t.cost),
					h(Segmented, {
						title: t.costHint, disabled: busy, value: entry.cost, onChange: (value) => patchEntry(id, { cost: Number(value) }),
						options: COSTS.map((value) => ({ value: value, label: t["price" + value] || String(value) })),
					}),
					h("button", {
						type: "button", className: "mr-chip", disabled: busy, title: t.visionHint,
						"data-active": String((entry.tags || []).indexOf("vision") >= 0),
						onClick: () => patchEntry(id, {
							tags: (entry.tags || []).indexOf("vision") >= 0
								? (entry.tags || []).filter((tag) => tag !== "vision")
								: (entry.tags || []).concat(["vision"]),
						}),
					}, t.vision)
				)
			}
			const savePresets = (next, after) => run("/presets", { presets: next }, after)
			const beginNew = () => { setEditing({ original: null, name: "", match: [], weights: {} }); setCustomWord(""); setView("preset") }
			const beginEdit = (name) => {
				const preset = presets[name] || {}
				setEditing({ original: name, name: name, match: (preset.match || []).slice(), weights: Object.assign({}, preset.weights || {}) })
				setCustomWord("")
				setView("preset")
			}
			const commitEditing = () => {
				const name = (editing.name || "").trim()
				if (!name) { setError(t.needName); return }
				const next = Object.assign({}, presets)
				if (editing.original && editing.original !== name) delete next[editing.original]
				next[name] = { match: editing.match.filter(Boolean), weights: editing.weights }
				savePresets(next, () => { setEditing(null); setView("main") })
			}
			const toggleWord = (word) => {
				const has = editing.match.indexOf(word) >= 0
				setEditing(Object.assign({}, editing, { match: has ? editing.match.filter((w) => w !== word) : editing.match.concat([word]) }))
			}
			const addWord = (word) => {
				const clean = String(word || "").trim()
				if (clean && editing.match.indexOf(clean) < 0) setEditing(Object.assign({}, editing, { match: editing.match.concat([clean]) }))
				setCustomWord("")
			}
			const setWeight = (id, value) => {
				const weights = Object.assign({}, editing.weights)
				if (Number(value) > 0) weights[id] = Number(value)
				else delete weights[id]
				setEditing(Object.assign({}, editing, { weights: weights }))
			}
			const setSetting = (patch) => {
				const next = Object.assign({}, settings, patch)
				if (patch.signals) next.signals = Object.assign({}, settings.signals || {}, patch.signals)
				run("/settings", { settings: next })
			}

			// --- Official half: the session model and its reasoning effort ---
			// Row payloads, the check mark, the pending dot and the trigger label all
			// mirror the official ModelSelect so the merged cell behaves identically.
			const officialGroups = ((official && official.groups) || []).slice()
			officialGroups.sort((left, right) => officialRank(left) - officialRank(right))
			const officialChoices = []
			for (const group of officialGroups) {
				for (const model of (group.models || [])) officialChoices.push({ group: group, model: model })
			}
			const officialCurrent = (official && official.current) || null
			const officialPending = (official && official.pending) || null
			const officialBusy = !!(official && official.pending)
			const officialSelected = officialCurrent
				? officialChoices.find((choice) => choice.group.id === officialCurrent.provider && choice.model.id === officialCurrent.model)
				: undefined
			const officialReasoning = officialSelected ? officialSelected.model.reasoning : undefined
			const officialEfforts = (officialReasoning && officialReasoning.efforts) || []
			const officialEffort = officialCurrent
				? (officialCurrent.reasoningEffort !== undefined ? officialCurrent.reasoningEffort : (officialReasoning ? officialReasoning.defaultEffort : undefined))
				: undefined
			let officialEffortLabel
			if (officialCurrent === null) officialEffortLabel = undefined
			else if (officialReasoning === undefined) officialEffortLabel = official ? official.retainedEffort : undefined
			else if (officialEffort === undefined) officialEffortLabel = t.officialDefault
			else {
				const hit = officialEfforts.find((level) => level.id === officialEffort)
				officialEffortLabel = hit && hit.name ? hit.name : officialEffort
			}
			const officialWaiting = !!official && officialCurrent === null && official.status === "loading"
			let officialModelLabel
			if (officialWaiting) officialModelLabel = t.officialLoading
			else if (officialSelected) officialModelLabel = officialSelected.model.name || officialSelected.model.id
			else if (officialCurrent) officialModelLabel = officialCurrent.provider + "/" + officialCurrent.model
			else officialModelLabel = t.officialFallback
			const officialEffortChoices = (!officialCurrent || officialReasoning === undefined)
				? []
				: (officialReasoning.defaultEffort === undefined
				? [{ key: "provider-default", effort: undefined, label: t.officialDefault }]
				: []).concat(officialEfforts.map((level) => ({ key: "effort:" + level.id, effort: level.id, label: level.name })))
			/** The seat face is what makes this control the official composer model cell. */
			const seated = !!(props && props.directory)
			const officialTriggerLabel = officialEffortLabel === undefined ? officialModelLabel : officialModelLabel + " · " + officialEffortLabel

			/**
			 * Settle an official selection without letting a rejection escape. The popup closes
			 * only once the host accepted the choice, so a failure stays visible: the message
			 * lands on the panel's own error line instead of being swallowed silently.
			 */
			const settleSelection = (result, close) => {
				if (!result || typeof result.then !== "function") {
					if (close) close()
					return
				}
				result.then((outcome) => {
					if (outcome && outcome.ok === false) {
						const detail = (outcome.error && (outcome.error.message || outcome.error.code)) || outcome.error
						setError(String(detail || t.officialError))
						setOpen(true)
						return
					}
					if (close) close()
				}, (reason) => {
					setError(String((reason && reason.message) || reason))
					setOpen(true)
				})
			}
			/** Official model row: no effort in the payload, and the current model is a no-op. */
			const chooseOfficialModel = (provider, modelId) => {
				if (!props || typeof props.select !== "function") return
				const same = !!(officialCurrent && officialCurrent.provider === provider && officialCurrent.model === modelId)
				if (same) { setOpen(false); return }
				setError("")
				settleSelection(props.select({ provider: provider, model: modelId }), () => setOpen(false))
			}
			/** Official effort row: provider-default sends no reasoningEffort key at all. */
			const chooseOfficialEffort = (effort) => {
				if (!props || typeof props.select !== "function" || !officialCurrent) return
				if (officialEffort === effort) { setOpen(false); return }
				const selection = { provider: officialCurrent.provider, model: officialCurrent.model }
				if (effort !== undefined) selection.reasoningEffort = effort
				setError("")
				settleSelection(props.select(selection), () => setOpen(false))
			}

			const parts = [
				h("button", {
					key: "trigger", type: "button", className: "mr-trigger", ref: triggerRef,
					// Which composer surface is live: the merged official seat, or the fallback chip.
					"data-mr-surface": props && props.fallbackChip === true ? "chip" : "seat",
					disabled: locked ? true : undefined,
					"aria-busy": officialBusy ? "true" : undefined,
					title: t.title + " · " + (t[mode] || mode) + " · " + (yielded ? t.yieldedHint : t.engagedHint) +
					(seated
						? (official ? " — " + officialTriggerLabel : "")
						: (current ? " — " + current.provider + "/" + current.model + " · " + currentEffort + " · " + (current.stepClass || "") : "")) +
					(needsConfirm ? " · " + t.confirmAttn : ""),
					onClick: openPanel,
				},
					seated
						? h("span", null, officialModelLabel)
						: h("span", null, t[mode] || mode),
					(seated
						? (officialEffortLabel === undefined ? null : h("span", { className: "mr-sub", title: officialTriggerLabel }, officialEffortLabel))
						: (effortMode && effortPending
						? h("span", { className: "mr-sub" }, t.pickModel)
						: (current
						? h("span", { className: "mr-sub", title: current.provider + "/" + current.model }, currentModel + " · " + currentEffort)
						: null))),
					officialBusy ? h("span", { className: "mr-spin" }) : null,
					needsConfirm ? h("span", { className: "mr-attn", title: t.confirmAttn }) : null,
					h("span", { className: "mr-dot", "data-yielded": String(yielded) })
				),
			]

			if (open) {
				const body = []

				if (view === "preset" && editing) {
					body.push(h("div", { key: "head", className: "mr-head" },
						h("button", { type: "button", className: "mr-btn", onClick: () => { setEditing(null); setView("main") } }, h(Icon, { name: "back" }), t.back),
						h("span", { className: "mr-name" }, editing.original ? t.edit : t.newPreset)
					))
					body.push(h("div", { key: "name", className: "mr-line", style: { padding: "4px 8px" } },
						h("span", { style: { flex: "1" } }, t.name),
						h("input", {
							className: "mr-input", value: editing.name, disabled: busy, placeholder: t.name,
							onChange: (event) => setEditing(Object.assign({}, editing, { name: event.target.value })),
						})
					))
					body.push(h("div", { key: "keys-title", className: "mr-group" }, t.keywords))
					body.push(h("div", { key: "packs", className: "mr-wrap" },
						PACKS.map((pack) => h("button", {
							key: pack.key, type: "button", className: "mr-chip", disabled: busy,
							onClick: () => {
								const all = pack.words.every((word) => editing.match.indexOf(word) >= 0)
								setEditing(Object.assign({}, editing, {
									match: all
										? editing.match.filter((word) => pack.words.indexOf(word) < 0)
										: editing.match.concat(pack.words.filter((word) => editing.match.indexOf(word) < 0)),
								}))
							},
						}, h(Icon, { name: "plus", size: 10 }), pack.key))
					))
					body.push(h("div", { key: "words", className: "mr-wrap" },
						editing.match.map((word) => h("button", {
							key: word, type: "button", className: "mr-chip", "data-active": "true", disabled: busy,
							onClick: () => toggleWord(word),
						}, word, h(Icon, { name: "close", size: 9 })))
					))
					body.push(h("div", { key: "custom", className: "mr-line", style: { padding: "0 8px 4px 34px" } },
						h("input", {
							className: "mr-input", value: customWord, placeholder: t.custom, disabled: busy,
							onChange: (event) => setCustomWord(event.target.value),
							onKeyDown: (event) => { if (event.key === "Enter") addWord(customWord) },
						}),
						h("button", { type: "button", className: "mr-btn", disabled: busy || !customWord.trim(), onClick: () => addWord(customWord) }, t.add)
					))
					body.push(h("div", { key: "w-title", className: "mr-group" }, t.weights))
					body.push(h("div", { key: "weights", className: "mr-body" },
						pool.length === 0
							? h("div", { className: "mr-sub" }, t.poolHint)
							: pool.map((entry) => h("div", { key: entry.id, className: "mr-line" },
								h("span", { className: "mr-name", title: entry.id }, entry.id),
								h(Segmented, {
									disabled: busy, value: editing.weights[entry.id] || 0, onChange: (value) => setWeight(entry.id, value),
									options: WEIGHTS.map((pair) => ({ value: pair[0], label: t[pair[1]] || pair[1] })),
								})
							))
					))
					body.push(h("div", { key: "actions", className: "mr-actions" },
						h("button", { type: "button", className: "mr-btn", disabled: busy, onClick: () => { setEditing(null); setView("main") } }, t.cancel),
						h("button", { type: "button", className: "mr-btn", "data-primary": "true", disabled: busy, onClick: commitEditing }, t.save)
					))
				} else if (view === "task") {
					body.push(h("div", { key: "head", className: "mr-head" },
						h("button", { type: "button", className: "mr-btn", onClick: () => setView("main") }, h(Icon, { name: "back" }), t.back),
						h("span", { className: "mr-name" }, t.task)
					))
					const pinned = state && state.pinnedTaskType ? state.pinnedTaskType : ""
					body.push(h("button", {
						key: "auto", type: "button", className: "mr-row", disabled: busy,
						onClick: () => { run("/task-type", { sessionId: sessionId, preset: null }); setView("main") },
					},
						h("span", { className: "mr-check" }, pinned === "" ? h(Icon, { name: "check" }) : null),
						h("span", { className: "mr-name" }, t.auto)
					))
					const names = Object.keys(presets)
					if (names.length === 0) body.push(h("div", { key: "none", className: "mr-note" }, t.noPresets))
					for (const name of names) {
						body.push(h("button", {
							key: name, type: "button", className: "mr-row", disabled: busy,
							onClick: () => { run("/task-type", { sessionId: sessionId, preset: name }); setView("main") },
						},
							h("span", { className: "mr-check" }, pinned === name ? h(Icon, { name: "check" }) : null),
							h("span", { className: "mr-name" }, name),
							h("span", { className: "mr-sub" }, (presets[name].match || []).join(" / "))
						))
					}
				} else {
					body.push(h("div", { key: "head", className: "mr-head" },
						h("span", { className: "mr-name" }, t.title),
						h("span", { className: "mr-dot", "data-yielded": String(yielded), title: yielded ? t.yieldedHint : t.engagedHint }),
						h("span", { style: { flex: "1", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: yielded ? t.yieldedHint : t.engagedHint }, yielded ? t.yielded : t.engaged),
						// With the seat the pool is merged into the model rows, so a header control
						// would only repeat it. Without the seat (the .right chip fallback) this is
						// the only way to reach the pool list.
						seated ? null : h("button", {
							type: "button", className: "mr-chip", style: { marginLeft: "auto" }, disabled: busy,
							title: effortMode ? t.effortModelHint : t.poolHint2,
							"data-mr-pool-entry": "true", "data-active": String(showPool),
							"aria-expanded": String(showPool),
							onClick: () => setPoolOpen(!showPool),
						}, t.pool, h("span", { className: "mr-tag" }, String(poolCount))),
						h("button", { type: "button", className: "mr-btn", style: { marginLeft: "auto" }, onClick: () => setOpen(false) }, h(Icon, { name: "close", size: 12 }))
					))
					// --- Per-conversation confirmation, before anything else can be touched ---
					if (needsConfirm) {
						const scopeLabel = t[plan.control] || plan.control || t.confirmNone
						const modelLabel = plan.effortModel ? String(plan.effortModel).split("/").pop() : t.confirmNone
						const taskLabel = plan.taskType || t.confirmAuto
						body.push(h("div", { key: "confirm", className: "mr-confirm", "data-mr-confirm": "true" },
							h("div", { className: "mr-confirm-head" },
								h("span", { className: "mr-confirm-dot" }),
								h("span", null, inherited ? t.confirmInherited : t.confirmNew)
							),
							h("div", { className: "mr-confirm-plan" },
								h("span", { className: "mr-tag" }, t.confirmScope),
								h("span", { className: "mr-confirm-val" }, scopeLabel),
								plan.control === "effort" ? h("span", { className: "mr-tag" }, t.confirmModel) : null,
								plan.control === "effort" ? h("span", { className: "mr-confirm-val" }, modelLabel) : null,
								h("span", { className: "mr-tag" }, t.confirmTask),
								h("span", { className: "mr-confirm-val" }, taskLabel),
								h("span", { className: "mr-tag" }, t.confirmPool),
								h("span", { className: "mr-confirm-val" }, String(plan.pool || 0) + " " + t.confirmCount)
							),
							h("div", { className: "mr-confirm-foot" },
								h("span", { className: "mr-confirm-hint" }, t.confirmHint),
								h("button", { type: "button", className: "mr-btn", "data-primary": "true", disabled: busy, onClick: confirmPlan }, t.confirmAction)
							)
						))
					}
					// --- Official half, on top: the session model and its reasoning effort ---
					if (seated) {
						const officialBody = []
						officialBody.push(h("div", { key: "official-model-title", className: "mr-group" }, effortMode ? t.effortModelTitle : t.officialModel))
						if (effortMode && effortPending) {
							officialBody.push(h("div", { key: "effort-pick", className: "mr-note", style: { padding: "0 8px 4px" } },
								h("div", { style: { color: "var(--dsw-alias-state-warn-label,#d29922)" } }, t.pickModel),
								h("div", null, t.effortModelHint)
							))
						}
						if (official && official.status === "loading") {
							officialBody.push(h("div", { key: "official-refreshing", className: "mr-note", style: { padding: "0 8px 2px" } }, t.officialRefreshing))
						}
						if (official && official.error) {
							officialBody.push(h("div", { key: "official-error", className: "mr-err" }, t.officialError + "：" + String((official.error && official.error.message) || official.error)))
							officialBody.push(h("div", { key: "official-retry", className: "mr-actions", style: { justifyContent: "flex-start" } },
								h("button", { type: "button", className: "mr-btn", disabled: officialBusy, onClick: () => { if (props.load) props.load() } }, t.officialRetry)
							))
						}
						for (const failure of ((official && official.failures) || [])) {
							const failureName = failure.id === "deepseek-account" ? t.officialAccount : (failure.name || failure.id)
							officialBody.push(h("div", { key: "official-failure:" + failure.id, className: "mr-note", style: { padding: "0 8px 2px" } },
								failureName + " · " + t.officialFailure + "：" + (failure.message || ""),
								h("button", { type: "button", className: "mr-btn", disabled: officialBusy, onClick: () => { if (props.load) props.load() } }, t.officialRetry)
							))
						}
						// One merged list: the official radio picks the session model, the trailing
						// chip ticks the router pool (or, in effort scope, binds the single model).
						// The separate pool menu below only survives for the no-seat fallback.
						const officialIds = {}
						const officialBare = {}
						for (const group of officialGroups) {
							officialBody.push(h("div", { key: "official-group:" + group.id, className: "mr-group" }, group.id === "deepseek-account" ? t.officialAccount : (group.name || group.id)))
							for (const model of (group.models || [])) {
								const id = group.id + "/" + model.id
								officialIds[id] = true
								officialBare[model.id] = true
								const isCurrent = !!(officialCurrent && officialCurrent.provider === group.id && officialCurrent.model === model.id)
								const isPending = !!(officialPending && officialPending.provider === group.id && officialPending.model === model.id)
								officialBody.push(h("div", { key: "official-model:" + id, className: "mr-row", style: { paddingRight: "8px" } },
									h("button", {
										type: "button", className: "mr-pick", role: "menuitemradio",
										"aria-checked": isCurrent ? "true" : "false",
										disabled: officialBusy, "data-official-model": id,
										title: model.name || model.id,
										onClick: () => chooseOfficialModel(group.id, model.id),
									},
										h("span", { className: "mr-check" }, isPending ? h("span", { className: "mr-spin" }) : (isCurrent ? h(Icon, { name: "check" }) : null)),
										h("span", { className: "mr-name" }, model.name || model.id)
									),
									poolToggle(id)
								))
								if (!effortMode && packed.indexOf(id) >= 0) officialBody.push(poolOptions(id))
							}
						}
						// Pool and catalog models the official directory does not cover stay in the
						// same list, so nothing the router can use is hidden from the user.
						const extraModels = []
						for (const model of rows) {
							if (officialIds[model.id]) continue
							const bare = String(model.id).split("/").pop()
							if (officialBare[bare]) continue
							officialIds[model.id] = true
							extraModels.push(model)
						}
						for (const entry of pool) {
							if (officialIds[entry.id]) continue
							officialIds[entry.id] = true
							extraModels.push({ id: entry.id, label: entry.id })
						}
						if (extraModels.length > 0) {
							officialBody.push(h("div", { key: "official-group:other", className: "mr-group" }, t.poolOther))
							for (const model of extraModels) {
								officialBody.push(h("div", { key: "pool-model:" + model.id, className: "mr-row", style: { paddingRight: "8px" } },
									h("span", { className: "mr-pick" }, h("span", { className: "mr-name", title: model.id }, model.label)),
									poolToggle(model.id)
								))
								if (!effortMode && packed.indexOf(model.id) >= 0) officialBody.push(poolOptions(model.id))
							}
						}
						if (!effortMode) {
							officialBody.push(h("div", { key: "pool-add", className: "mr-line", style: { padding: "2px 8px 4px 34px" } },
								h("input", {
									className: "mr-input", value: customModel, placeholder: t.poolAdd, disabled: busy,
									onChange: (event) => setCustomModel(event.target.value),
									onKeyDown: (event) => { if (event.key === "Enter") addModel() },
								}),
								h("button", { type: "button", className: "mr-btn", disabled: busy || !customModel.trim(), onClick: addModel }, t.add)
							))
						}
						if (official && official.status === "ready" && officialGroups.length === 0) {
							officialBody.push(h("div", { key: "official-empty", className: "mr-note" }, t.officialEmpty))
						}
						if (officialCurrent && officialReasoning !== undefined) {
							officialBody.push(h("div", { key: "official-effort-title", className: "mr-group" }, t.officialEffort))
							if (officialEffortChoices.length === 0) {
								officialBody.push(h("div", { key: "official-effort-empty", className: "mr-note" }, t.officialEmptyEfforts))
							}
							for (const level of officialEffortChoices) {
								const checked = officialEffort === level.effort
								const isPending = !!(officialPending && officialPending.provider === officialCurrent.provider && officialPending.model === officialCurrent.model && officialPending.reasoningEffort === level.effort)
								officialBody.push(h("button", {
									key: "official-effort:" + level.key, type: "button", className: "mr-row",
									role: "menuitemradio", "aria-checked": checked ? "true" : "false",
									disabled: officialBusy,
									"data-official-effort": level.effort === undefined ? "provider-default" : String(level.effort),
									onClick: () => chooseOfficialEffort(level.effort),
								},
									h("span", { className: "mr-check" }, isPending ? h("span", { className: "mr-spin" }) : (checked ? h(Icon, { name: "check" }) : null)),
									h("span", { className: "mr-name" }, level.label)
								))
							}
						}
						for (const node of officialBody) body.push(node)
						body.push(h("div", { key: "official-div", className: "mr-div" }))
					}
					if (!sessionId) {
						body.push(h("div", { key: "nosession", className: "mr-note", style: { padding: "0 8px 4px" } }, t.noSession))
					}
					if (yielded) {
						body.push(h("div", { key: "resume", className: "mr-actions", style: { justifyContent: "flex-start" } },
							h("button", { type: "button", className: "mr-btn", "data-primary": "true", disabled: busy, onClick: () => run("/resume", { sessionId: sessionId }) }, t.resume)
						))
					}
					body.push(h("div", { key: "modes", className: "mr-line", style: { padding: "0 8px 6px" } },
						h("span", { style: { flex: "1" }, title: t.scopeHint }, t.scope),
						h(Segmented, {
							title: t.scopeHint, disabled: busy, value: mode, onChange: (value) => run("/control", { sessionId: sessionId, control: value }),
							options: [
								{ value: "full", label: t.full, title: t.fullHint },
								{ value: "effort", label: t.effort, title: t.effortHint },
								{ value: "model", label: t.model, title: t.modelHint },
							],
						})
					))
					body.push(h("button", {
						key: "task", type: "button", className: "mr-row", disabled: busy, onClick: () => setView("task"), title: t.taskHint,
					},
						h("span", { className: "mr-name" }, t.task),
						h("span", { className: "mr-sub" }, (state && state.pinnedTaskType) || t.auto),
						h("span", { className: "mr-check" }, h(Icon, { name: "chevron", size: 12 }))
					))
					body.push(h("div", { key: "div1", className: "mr-div" }))
					if (!seated && showPool) {

						body.push(h("div", { key: "pool-title", className: "mr-group" }, effortMode ? t.effortModelTitle : t.pool))
						if (effortMode) {
							if (effortPending) {
								body.push(h("div", { key: "pool-hint", className: "mr-note", style: { padding: "0 8px 4px" } },
									h("div", { style: { color: "var(--dsw-alias-state-warn-label,#d29922)" } }, t.pickModel),
									h("div", null, t.effortModelHint)
								))
							}
						} else {
							body.push(h("div", { key: "pool-hint", className: "mr-note", style: { padding: "0 8px 2px" } }, t.poolHint2))
						}
						if (rows.length === 0) body.push(h("div", { key: "pool-none", className: "mr-note" }, t.empty))
						for (const model of rows) {
							const entry = pool.find((candidate) => candidate.id === model.id)
							if (effortMode) {
								const bound = effortBoundId === model.id
								body.push(h("button", {
									key: model.id, type: "button", className: "mr-row", disabled: busy,
									title: model.id, "data-static": bound ? "true" : undefined,
									onClick: () => { if (!bound) run("/effort-model", { sessionId: sessionId, model: model.id }) },
								},
									h("span", { className: "mr-check" }, bound ? h(Icon, { name: "check" }) : null),
									h("span", { className: "mr-name" }, model.label),
									bound ? h("span", { className: "mr-sub" }, t.effortBound) : null
								))
								continue
							}
							body.push(h("button", {
								key: model.id, type: "button", className: "mr-row", disabled: busy,
								title: model.id, onClick: () => toggleModel(model.id),
							},
								h("span", { className: "mr-check" }, entry ? h(Icon, { name: "check" }) : null),
								h("span", { className: "mr-name" }, model.label),
								entry && entry.tier === "strong" ? h("span", { className: "mr-sub" }, t.strong) : null
							))
							if (entry) {
								body.push(h("div", { key: model.id + "-opts", className: "mr-line", style: { padding: "0 8px 4px 34px" } },
									h("span", { className: "mr-tag", title: t.tierHint }, t.tier),
									h(Segmented, {
										title: t.tierHint, disabled: busy, value: entry.tier, onChange: (value) => patchEntry(model.id, { tier: value }),
										options: [
											{ value: "cheap", label: t.cheap, title: t.cheapHint },
											{ value: "strong", label: t.strong, title: t.strongHint },
										],
									}),
									h("span", { className: "mr-tag", title: t.costHint }, t.cost),
									h(Segmented, {
										title: t.costHint, disabled: busy, value: entry.cost, onChange: (value) => patchEntry(model.id, { cost: Number(value) }),
										options: COSTS.map((value) => ({ value: value, label: t["price" + value] || String(value) })),
									}),
									h("button", {
										type: "button", className: "mr-chip", disabled: busy, title: t.visionHint,
										"data-active": String((entry.tags || []).indexOf("vision") >= 0),
										onClick: () => patchEntry(model.id, {
											tags: (entry.tags || []).indexOf("vision") >= 0
												? (entry.tags || []).filter((tag) => tag !== "vision")
												: (entry.tags || []).concat(["vision"]),
										}),
									}, t.vision)
								))
							}
						}
						if (!effortMode) {
							body.push(h("div", { key: "pool-add", className: "mr-line", style: { padding: "2px 8px 4px 34px" } },
								h("input", {
									className: "mr-input", value: customModel, placeholder: t.poolAdd, disabled: busy,
									onChange: (event) => setCustomModel(event.target.value),
									onKeyDown: (event) => { if (event.key === "Enter") addModel() },
								}),
								h("button", { type: "button", className: "mr-btn", disabled: busy || !customModel.trim(), onClick: addModel }, t.add)
							))
						}

					}
					body.push(h("div", { key: "div2", className: "mr-div" }))
					body.push(h("div", { key: "preset-title", className: "mr-group" }, t.presets))
					const names = Object.keys(presets)
					if (names.length === 0) body.push(h("div", { key: "preset-none", className: "mr-note" }, t.noPresets))
					for (const name of names) {
						body.push(h("div", { key: name, className: "mr-row", "data-static": "true" },
							h("span", { className: "mr-check" }),
							h("button", { type: "button", className: "mr-btn", style: { padding: 0, flex: "1", justifyContent: "flex-start", gap: "8px" }, disabled: busy, onClick: () => beginEdit(name) },
								h("span", { className: "mr-name" }, name),
								h("span", { className: "mr-sub", style: { flex: "0 1 auto" } }, (presets[name].match || []).join(" / "))
							),
							h("button", {
								type: "button", className: "mr-btn mr-icon-btn", disabled: busy, title: t.remove,
								onClick: () => { const next = Object.assign({}, presets); delete next[name]; savePresets(next) },
							}, h(Icon, { name: "close", size: 11 }))
						))
					}
					body.push(h("button", { key: "new", type: "button", className: "mr-row", disabled: busy, onClick: beginNew },
						h("span", { className: "mr-check" }, h(Icon, { name: "plus" })),
						h("span", { className: "mr-name" }, t.newPreset)
					))

					body.push(h("div", { key: "div3", className: "mr-div" }))
					body.push(h("div", { key: "more-title", className: "mr-group" }, t.more))
					body.push(h("div", { key: "images", className: "mr-line", style: { padding: "2px 8px" } },
						h("span", { className: "mr-name", title: t.imagesHint }, t.images),
						h(Segmented, {
							title: t.imagesHint, disabled: busy, value: settings.imagePolicy || "keep", onChange: (value) => setSetting({ imagePolicy: value }),
							options: [{ value: "keep", label: t.keepImages }, { value: "vision", label: t.toVision }],
						})
					))
					body.push(h("div", { key: "classifier", className: "mr-line", style: { padding: "2px 8px" } },
						h("span", { className: "mr-name", title: t.classifierHint }, t.classifier),
						h(Segmented, {
							title: t.classifierHint, disabled: busy, value: settings.classifier || "rules", onChange: (value) => setSetting({ classifier: value }),
							options: [{ value: "rules", label: t.byRules }, { value: "llm", label: t.byLlm }],
						})
					))
					body.push(h("div", { key: "bg", className: "mr-line", style: { padding: "2px 8px" } },
						h("span", { className: "mr-name", title: t.bgHint }, t.bg),
						h(Segmented, {
							title: t.bgHint, disabled: busy,
							value: settings.panelBg === "theme" ? "theme" : "solid",
							onChange: (value) => { setSetting({ panelBg: value }); setSolidBg(resolveSolid()) },
							options: [
								{ value: "solid", label: t.bgSolid, title: t.bgSolidHint },
								{ value: "theme", label: t.bgTheme, title: t.bgThemeHint },
							],
						})
					))
					body.push(h("div", { key: "pressure", className: "mr-line", style: { padding: "2px 8px" } },
						h("span", { className: "mr-name", title: t.pressureHint }, t.pressure),
						h(Segmented, {
							title: t.pressureHint, disabled: busy,
							value: settings.signals && Number(settings.signals.contextPressure) > 0 ? "on" : "off",
							onChange: (value) => setSetting({ signals: { contextPressure: value === "on" ? 0.75 : 0 } }),
							options: [{ value: "off", label: t.off }, { value: "on", label: t.on }],
						})
					))

					if (state && state.decisions && state.decisions.length > 0) {
						body.push(h("div", { key: "recent-title", className: "mr-group" }, t.recent))
						body.push(h("div", { key: "recent" },
							state.decisions.slice(-5).reverse().map((decision, index) => h("div", {
								key: String(index), className: "mr-line", style: { padding: "0 8px" },
							},
								h("span", { className: "mr-tag" }, "T" + (decision.turn === undefined ? "?" : decision.turn) + "." + (decision.step === undefined ? "?" : decision.step)),
								h("span", { className: "mr-name", title: (decision.provider || "") + "/" + (decision.model || "") }, (decision.model || "") + " · " + (decision.effort || "default")),
								h("span", { className: "mr-sub" }, decision.stepClass || "")
							))
						))
					}
					body.push(h("div", { key: "foot", className: "mr-foot" },
						h("span", { className: "mr-dot", "data-yielded": String(yielded) }),
						h("span", null, yielded ? t.yielded : t.engaged),
						state && state.current
							? h("span", { className: "mr-name", style: { textAlign: "right" }, title: state.current.provider + "/" + state.current.model },
								state.current.model + " · " + (state.current.effort || "default") + " · " + state.current.stepClass)
							: null
					))
				}

				if (error) body.push(h("div", { key: "error", className: "mr-err" }, error))

				const useThemeBg = settings.panelBg === "theme"
				const panel = h("div", {
					key: "panel", ref: panelRef, className: "mr-panel",
					"data-bg": useThemeBg ? "theme" : "solid",
					style: {
						bottom: pos ? pos.bottom : 96,
						right: pos ? pos.right : 24,
						maxHeight: pos ? pos.maxHeight : "72vh",
						background: useThemeBg ? undefined : (solidBg || undefined),
					},
					onMouseDown: (event) => event.stopPropagation(),
				}, body)
				parts.push(reactDom.createPortal(panel, document.body))
			}

			return h("div", { ref: rootRef, style: { position: "relative", display: "inline-flex", alignItems: "center" } }, parts)
		}

		/** Session projection the host folds every tool-call route into. */
		const ROUTE_PROJECTION = "modelRouterRoute"
		/** Slot key and Node kind of one compact route line per tool call. */
		const ROUTE_KIND = "model-router-route"
		/** react.memo when the host React provides it; identity under a minimal stub. */
		const memoComponent = typeof react.memo === "function" ? react.memo : (component) => component

		/**
		 * Conversation Definition for one compact route row per tool call. Making it a
		 * separate Node (instead of shadowing the shipped tool row, which would delete
		 * the Tool UI) keeps the call itself untouched and anchors the route line right
		 * after it: anchorSeq is the tool/call seq plus a small delta.
		 */
		const modelRouterRouteDefinition = {
			kind: ROUTE_KIND,
			target: "chat",
			match: (event) => event.type === "tool/call"
				? { id: String(event.data.callId), role: "start" }
				: null,
			start: (_context, match) => ({
				callId: String(match.event.data.callId),
				name: match.event.data.name,
				turn: match.event.data.turn,
				step: match.event.data.step,
				seq: match.event.seq,
			}),
			update: (context) => context.state,
			buildViewNode: (context) => {
				const state = context.state
				if (state === undefined || state === null) return null
				return {
					key: context.key,
					kind: ROUTE_KIND,
					id: context.id,
					target: "chat",
					anchorSeq: state.seq + .1,
					location: context.start && context.start.location ? context.start.location : { kind: "unresolved" },
					visibility: "visible",
					data: { callId: state.callId, name: state.name, turn: state.turn, step: state.step },
				}
			},
		}

		/**
		 * One compact conversation line under a tool call: the provider/model and the
		 * thinking level that call actually ran with. The projection is read
		 * defensively and a callId the host has not folded yet renders nothing, so a
		 * fresh call can never borrow another call's route.
		 */
		const ModelRouterRouteRow = memoComponent(function ModelRouterRouteRow(props) {
			let view = null
			try {
				const read = props && typeof props.useProjection === "function" ? props.useProjection : null
				view = read ? read(ROUTE_PROJECTION) : null
			} catch (_noProjection) { view = null }
			try {
				const node = props ? props.node : null
				const data = node ? node.data : null
				const callId = data ? String(data.callId || "") : ""
				const call = callId && view && view.calls ? view.calls[callId] : null
				if (!call) return null
				const provider = call.provider ? String(call.provider) : ""
				const model = call.model ? String(call.model) : ""
				const label = provider && model ? provider + "/" + model : (model || provider)
				if (!label) return null
				const effort = call.effort === null || call.effort === undefined || call.effort === ""
					? dict().effortDefault
					: String(call.effort)
				return h("div", {
					className: "mr-call", title: label + " · " + effort,
					"data-route-call": callId,
					"data-route-tool": data.name ? String(data.name) : undefined,
				},
					h("span", { className: "mr-call-model" }, label),
					h("span", { className: "mr-call-eff" }, "· " + effort)
				)
			} catch (_noRow) { return null }
		})

		const name = "model-router"
		// The router's composer seat drives ui-model-selection's shared ModelDirectory, whose
		// methods resolve `remote.session` against the CALLER's fiber. Declaring these at the
		// plugin root - exactly as ui-model-selection declares its own list - is what makes
		// directoryFor() reachable from the deferred seat callback; without them the fiber walk
		// ends at the root and throws `cannot get property "remote.session" without inject`.
		const inject = ["slots", "uiConversation", "sessions", "remote", "remote.session"]

		function apply(ctx) {
			ensureStyles()
			const conversation = ctx.uiConversation
			if (conversation && conversation.events && typeof conversation.events.register === "function") {
				conversation.events.register(modelRouterRouteDefinition)
			}
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: ROUTE_KIND,
				locale: NS,
			}, ModelRouterRouteRow))
			// The chip registration below writes disposeChip; the merged seat sets seatActive
			// and retracts the chip, so the composer shows the model control exactly once
			// whichever of the two deferred callbacks runs first.
			let disposeChip = null
			let seatActive = false
			ctx.inject(["slots", "modelDirectories"], (scope) => {
				const directories = scope.modelDirectories
				/**
				 * The composer face handed to the host. `fallbackChip` selects the plain router
				 * chip (read-only catalog access, no selection path of its own). When it is false
				 * the caller is the model seat and it receives the shared ModelDirectory store
				 * plus load/select - that is what turns the official half of
				 * ModelRouterControl on inside the merged cell.
				 */
				const face = (sessionId, fallbackChip, available) => {
					const directory = () => {
						try { return directories && sessionId ? directories.directoryFor(sessionId) : undefined } catch (_noDirectory) { return undefined }
					}
					const found = directory()
					const reachable = available !== false
					const base = {
						sessionId: sessionId,
						fallbackChip: fallbackChip,
						available: reachable,
						resolveCatalog: () => (found ? found.store : undefined),
						loadCatalog: () => {
							if (!found) return
							try { found.load().catch(() => {}) } catch (_noLoad) { /* ignore */ }
						},
					}
					if (fallbackChip || !found) return base
					return Object.assign(base, {
						directory: found.store,
						load: () => {
							if (!reachable) return
							try { found.load().catch(() => {}) } catch (_noLoad) { /* ignore */ }
						},
						select: (selection) => (reachable ? found.select(selection) : Promise.resolve(undefined)),
					})
				}
				/**
				 * The router's own composer surface and the fallback when the seat is not wired.
				 * It self-retracts as soon as the merged seat registers, so it is only ever
				 * visible on a host that keeps the shipped model cell.
				 */
				scope.slots.inject("conversation.input.right", () => {
					const dispose = scope.slots.register({
						name: "conversation.input.right",
						id: "model-router:composer-control",
						order: 20,
						registrant: NS,
						inject: (sessionId) => face(sessionId, true, true),
					}, ModelRouterControl)
					if (seatActive) {
						try { dispose() } catch (_noDispose) { /* ignore */ }
						return () => {}
					}
					disposeChip = dispose
					return dispose
				})
			})
			// The shipped composer model cell (a single slot owned by ui-model-selection's
			// ModelSelect). Registering at priority -1 replaces it with the merged control:
			// the official model and effort lists plus the router panel behind one trigger.
			// `sessions` is requested here beside the seat rather than at the plugin root, so a
			// host that does not provide it still loads this plugin and simply keeps the
			// shipped cell. Only a declared service may be touched - reaching for scope.sessions
			// without it is what made 0.10.0 fail the whole page boot.
			ctx.inject(["slots", "modelDirectories", "sessions"], (seatScope) => {
				const seatDirectories = seatScope.modelDirectories
				const sessions = seatScope.sessions
				const seatAvailable = (sessionId) => {
					try { return !sessions || sessions.subagentAddress(sessionId) === undefined } catch (_noSessions) { return true }
				}
				try {
					seatScope.slots.inject("conversation.input.model", () => {
						const disposeSeat = seatScope.slots.register({
							name: "conversation.input.model",
							priority: -1,
							registrant: NS,
							inject: (sessionId) => {
								// Mirror the shipped seat exactly: directoryFor must be asked even for
								// a not-yet-saved session (the hero composer), or the merged cell would
								// lose the official half and shadow the official picker with nothing.
								const directory = (() => {
									try { return seatDirectories.directoryFor(sessionId) } catch (_noDirectory) { return undefined }
								})()
								const available = seatAvailable(sessionId)
								return {
									sessionId: sessionId,
									fallbackChip: false,
									available: available,
									directory: directory ? directory.store : undefined,
									load: () => {
										if (!directory || !available) return
										try { directory.load().catch(() => {}) } catch (_noLoad) { /* ignore */ }
									},
									select: (selection) => (directory && available ? directory.select(selection) : Promise.resolve(undefined)),
									resolveCatalog: () => (directory ? directory.store : undefined),
									loadCatalog: () => {
										if (!directory) return
										try { directory.load().catch(() => {}) } catch (_noLoad) { /* ignore */ }
									},
								}
							},
						}, ModelRouterControl)
						seatActive = true
						if (typeof disposeChip === "function") {
							try { disposeChip() } catch (_noDispose) { /* ignore */ }
							disposeChip = null
						}
						return disposeSeat
					})
				} catch (_noSeat) {
					// The shipped cell stays; the chip above remains the router's composer surface.
				}
			})
		}
		exports.name = name
		exports.inject = inject
		exports.apply = apply
		exports.ModelRouterControl = ModelRouterControl
		return module.exports
	},
})
