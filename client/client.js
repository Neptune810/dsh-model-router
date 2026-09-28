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
				title: "模型路由", scope: "控制范围", full: "全授权", effort: "思考", model: "模型",
				engaged: "已接管", yielded: "已让位，你手动选过", resume: "重新接管",
				task: "任务类型", auto: "自动（按关键词规则）", pool: "模型池", poolHint: "只有勾选的模型会被选中",
				tier: "档位", cheap: "便宜", strong: "强", cost: "成本", vision: "视觉",
				presets: "任务预设", newPreset: "新建预设", edit: "编辑", remove: "删除",
				name: "名称", keywords: "关键词", add: "添加", custom: "自定义词，回车添加",
				weights: "各模型权重", none: "不参与", save: "保存", cancel: "取消", back: "返回",
				more: "更多", images: "带图步骤", keepImages: "不干预", toVision: "用视觉模型",
				classifier: "任务识别", byRules: "关键词", byLlm: "语义",
				pressure: "上下文压力", on: "快满省", off: "关",
				noPresets: "还没有预设", current: "当前", loading: "读取中…", empty: "没有可选项",
				needName: "先给任务类型起个名字", session: "会话",
				poolAdd: "手动填模型 ID", delete: "删",
			},
			en: {
				title: "Model router", scope: "Scope", full: "Full", effort: "Effort", model: "Model",
				engaged: "Controlling", yielded: "Yielded to your manual pick", resume: "Resume",
				task: "Task type", auto: "Auto (keyword rules)", pool: "Model pool", poolHint: "only ticked models are selectable",
				tier: "Tier", cheap: "cheap", strong: "strong", cost: "Cost", vision: "vision",
				presets: "Task presets", newPreset: "New preset", edit: "Edit", remove: "Delete",
				name: "Name", keywords: "Keywords", add: "Add", custom: "custom word, press enter",
				weights: "Weight per model", none: "off", save: "Save", cancel: "Cancel", back: "Back",
				more: "More", images: "Image steps", keepImages: "leave alone", toVision: "vision model",
				classifier: "Detection", byRules: "keywords", byLlm: "semantic",
				pressure: "Context pressure", on: "cheap", off: "off",
				noPresets: "no presets yet", current: "now", loading: "loading…", empty: "nothing to show",
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
			".mr-panel{position:fixed;z-index:2147483000;width:352px;max-height:min(72vh,540px);overflow:auto;padding:6px;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-menu,#232326);color:var(--dsw-alias-label-primary,#e8e8ea);box-shadow:var(--dsw-elevation-prominent,0 16px 48px rgba(0,0,0,.45));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));font-size:13px;line-height:20px;scrollbar-width:thin}",
			".mr-panel::-webkit-scrollbar{width:8px}",
			".mr-panel::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(127,127,127,.3));border-radius:4px}",
			".mr-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:6px;padding:4px 8px 6px;background:var(--dsw-specific-menu,#232326);color:var(--dsw-alias-label-tertiary,#8b9096);font-size:11px;letter-spacing:.02em}",
			".mr-group{color:var(--dsw-alias-label-tertiary,#8b9096);font-size:11px;font-weight:500;line-height:16px;padding:8px 8px 2px}",
			".mr-row{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:4px 8px;border:0;border-radius:var(--dsw-radius-md,8px);background:0 0;color:inherit;text-align:left;font:inherit;cursor:pointer;transition:background .12s}",
			".mr-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}",
			".mr-row[data-static=true]{cursor:default}",
			".mr-row[data-static=true]:hover{background:0 0}",
			".mr-body{display:flex;flex-direction:column;gap:2px;padding:2px 8px 6px 34px}",
			".mr-check{flex:0 0 14px;display:grid;place-items:center;color:var(--dsw-alias-label-primary,#e8e8ea)}",
			".mr-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".mr-sub{color:var(--dsw-alias-label-caption,#8b9096);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".mr-line{display:flex;align-items:center;gap:8px;padding:0 0 2px;color:var(--dsw-alias-label-secondary,#a2a8b0);font-size:11px}",
			".mr-seg{display:inline-flex;gap:2px;padding:2px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.12))}",
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
			".mr-chip{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));border-radius:999px;background:0 0;color:var(--dsw-alias-label-secondary,#a2a8b0);font:inherit;font-size:11px;cursor:pointer;transition:background .12s,color .12s}",
			".mr-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#e8e8ea)}",
			".mr-chip[data-active=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.22));border-color:transparent;color:var(--dsw-alias-label-primary,#e8e8ea)}",
			".mr-actions{display:flex;justify-content:flex-end;gap:6px;padding:8px 8px 2px}",
			".mr-div{height:1px;margin:6px 8px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.18))}",
			".mr-err{margin:4px 8px;padding:6px 8px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-interactive-bg-hover-danger,rgba(248,81,73,.14));color:var(--dsw-alias-state-error-primary,#f85149);font-size:11px;line-height:16px;word-break:break-word}",
			".mr-foot{display:flex;gap:6px;align-items:center;padding:8px 8px 2px;margin-top:2px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));color:var(--dsw-alias-label-caption,#8b9096);font-size:11px}",
			".mr-note{padding:8px;color:var(--dsw-alias-label-caption,#8b9096);font-size:11px}",
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
			return h("div", { className: "mr-seg" },
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
			const [poolOverride, setPoolOverride] = react.useState(null)
			const [hostGroups, setHostGroups] = react.useState([])
			const [catalogStore, setCatalogStore] = react.useState(props && props.resolveCatalog ? props.resolveCatalog() : undefined)
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

			const load = react.useCallback(() => {
				if (!sessionId) return
				api("/state?sessionId=" + encodeURIComponent(sessionId))
					.then((next) => { setState(next); setError("") })
					.catch((reason) => setError(String((reason && reason.message) || reason)))
			}, [sessionId])

			react.useEffect(() => { load() }, [load])
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

			const run = (path, body, after) => {
				setBusy(true)
				api(path, { method: "POST", body })
					.then(() => { setError(""); load(); if (after) after() })
					.catch((reason) => { setError(String((reason && reason.message) || reason)); if (after) after() })
					.finally(() => setBusy(false))
			}

			const openPanel = () => {
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
			const pool = poolOverride || ((state && state.pool) || [])
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

			const parts = [
				h("button", {
					key: "trigger", type: "button", className: "mr-trigger", ref: triggerRef,
					title: t.title, onClick: openPanel,
				},
					h("span", null, t[mode] || mode),
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
						h("button", { type: "button", className: "mr-btn", style: { marginLeft: "auto" }, onClick: () => setOpen(false) }, h(Icon, { name: "close", size: 12 }))
					))
					if (yielded) {
						body.push(h("div", { key: "resume", className: "mr-actions", style: { justifyContent: "flex-start" } },
							h("button", { type: "button", className: "mr-btn", "data-primary": "true", disabled: busy, onClick: () => run("/resume", { sessionId: sessionId }) }, t.resume)
						))
					}
					body.push(h("div", { key: "modes", className: "mr-line", style: { padding: "0 8px 6px" } },
						h("span", { style: { flex: "1" } }, t.scope),
						h(Segmented, {
							disabled: busy, value: mode, onChange: (value) => run("/control", { sessionId: sessionId, control: value }),
							options: [
								{ value: "full", label: t.full },
								{ value: "effort", label: t.effort },
								{ value: "model", label: t.model },
							],
						})
					))
					body.push(h("button", {
						key: "task", type: "button", className: "mr-row", disabled: busy, onClick: () => setView("task"),
					},
						h("span", { className: "mr-name" }, t.task),
						h("span", { className: "mr-sub" }, (state && state.pinnedTaskType) || t.auto),
						h("span", { className: "mr-check" }, h(Icon, { name: "chevron", size: 12 }))
					))
					body.push(h("div", { key: "div1", className: "mr-div" }))

					body.push(h("div", { key: "pool-title", className: "mr-group" }, t.pool))
					if (rows.length === 0) body.push(h("div", { key: "pool-none", className: "mr-note" }, t.empty))
					for (const model of rows) {
						const entry = pool.find((candidate) => candidate.id === model.id)
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
								h("span", { className: "mr-sub" }, t.tier),
								h(Segmented, {
									disabled: busy, value: entry.tier, onChange: (value) => patchEntry(model.id, { tier: value }),
									options: [{ value: "cheap", label: t.cheap }, { value: "strong", label: t.strong }],
								}),
								h("span", { className: "mr-sub" }, t.cost),
								h(Segmented, {
									disabled: busy, value: entry.cost, onChange: (value) => patchEntry(model.id, { cost: Number(value) }),
									options: COSTS.map((value) => ({ value: value, label: String(value) })),
								}),
								h("button", {
									type: "button", className: "mr-chip", disabled: busy,
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
					body.push(h("div", { key: "pool-add", className: "mr-line", style: { padding: "2px 8px 4px 34px" } },
						h("input", {
							className: "mr-input", value: customModel, placeholder: t.poolAdd, disabled: busy,
							onChange: (event) => setCustomModel(event.target.value),
							onKeyDown: (event) => { if (event.key === "Enter") addModel() },
						}),
						h("button", { type: "button", className: "mr-btn", disabled: busy || !customModel.trim(), onClick: addModel }, t.add)
					))

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
						h("span", { className: "mr-name" }, t.images),
						h(Segmented, {
							disabled: busy, value: settings.imagePolicy || "keep", onChange: (value) => setSetting({ imagePolicy: value }),
							options: [{ value: "keep", label: t.keepImages }, { value: "vision", label: t.toVision }],
						})
					))
					body.push(h("div", { key: "classifier", className: "mr-line", style: { padding: "2px 8px" } },
						h("span", { className: "mr-name" }, t.classifier),
						h(Segmented, {
							disabled: busy, value: settings.classifier || "rules", onChange: (value) => setSetting({ classifier: value }),
							options: [{ value: "rules", label: t.byRules }, { value: "llm", label: t.byLlm }],
						})
					))
					body.push(h("div", { key: "pressure", className: "mr-line", style: { padding: "2px 8px" } },
						h("span", { className: "mr-name" }, t.pressure),
						h(Segmented, {
							disabled: busy,
							value: settings.signals && Number(settings.signals.contextPressure) > 0 ? "on" : "off",
							onChange: (value) => setSetting({ signals: { contextPressure: value === "on" ? 0.75 : 0 } }),
							options: [{ value: "off", label: t.off }, { value: "on", label: t.on }],
						})
					))

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

				const panel = h("div", {
					key: "panel", ref: panelRef, className: "mr-panel",
					style: {
						bottom: pos ? pos.bottom : 96,
						right: pos ? pos.right : 24,
						maxHeight: pos ? pos.maxHeight : "72vh",
					},
					onMouseDown: (event) => event.stopPropagation(),
				}, body)
				parts.push(reactDom.createPortal(panel, document.body))
			}

			return h("div", { ref: rootRef, style: { position: "relative", display: "inline-flex", alignItems: "center" } }, parts)
		}

		const name = "model-router"
		const inject = ["slots"]

		function apply(ctx) {
			ensureStyles()
			ctx.inject(["slots", "modelDirectories"], (scope) => {
				const directories = scope.modelDirectories
				scope.slots.inject("conversation.input.right", () => scope.slots.register({
					name: "conversation.input.right",
					id: "model-router:composer-control",
					order: 20,
					registrant: NS,
					inject: (sessionId) => {
						const directory = () => {
							try { return directories && sessionId ? directories.directoryFor(sessionId) : undefined } catch (_noDirectory) { return undefined }
						}
						return {
							sessionId: sessionId,
							resolveCatalog: () => {
								const found = directory()
								return found ? found.store : undefined
							},
							loadCatalog: () => {
								const found = directory()
								if (!found) return
								try { found.load().catch(() => {}) } catch (_noLoad) { /* ignore */ }
							},
						}
					},
				}, ModelRouterControl))
			})
		}

		exports.name = name
		exports.inject = inject
		exports.apply = apply
		exports.ModelRouterControl = ModelRouterControl
		return module.exports
	},
})
