/**
 * dsh-model-router — browser half.
 *
 * Same lazy-CJS bundle shape every third-party client plugin uses
 * (window.__ModuleLoader__.load with an id and factory), written by hand so the
 * package needs no build step.
 *
 * Everything in this panel is a click: pick models from the live catalog,
 * toggle tier/cost/vision with selects, and edit task presets with keyword
 * chips and weight dropdowns. No JSON or YAML anywhere.
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

		const TEXT = {
			zh: {
				title: "模型路由", full: "全授权", effort: "思考等级", model: "模型模式",
				engaged: "已接管", yielded: "已让位（你手动选过）", resume: "重新接管",
				task: "任务类型", auto: "自动（按关键词规则）", pool: "模型池（勾选可用）",
				poolHint: "只有勾选的模型会被选中", tier: "档位", cheap: "便宜", strong: "强",
				cost: "成本", vision: "视觉",
				presets: "任务预设", newPreset: "新建预设", edit: "编辑", remove: "删除",
				name: "名称", keywords: "关键词（点一下常用词，或输入后回车）", add: "添加",
				weights: "各模型权重", none: "不参与", save: "保存", cancel: "取消",
				more: "更多设置", images: "带图步骤", keepImages: "不干预", toVision: "交给视觉模型",
				classifier: "任务识别", byRules: "关键词规则", byLlm: "语义判断（LLM）",
				pressure: "上下文压力", pressureOff: "关", pressureOn: "快满时用便宜档",
				session: "会话", noPresets: "还没有预设，点下面的「新建预设」开始",
				needName: "请先给这个任务类型起个名字", loadFailed: "读取失败",
				low: "低", mid: "中", high: "高",
			},
			en: {
				title: "Model router", full: "Full", effort: "Effort only", model: "Model only",
				engaged: "Controlling", yielded: "Yielded (you picked manually)", resume: "Resume control",
				task: "Task type", auto: "Auto (keyword rules)", pool: "Model pool (tick to allow)",
				poolHint: "only ticked models can be selected", tier: "tier", cheap: "cheap", strong: "strong",
				cost: "cost", vision: "vision",
				presets: "Task presets", newPreset: "New preset", edit: "Edit", remove: "Delete",
				name: "Name", keywords: "Keywords (click a pack, or type and press enter)", add: "Add",
				weights: "Weight per model", none: "off", save: "Save", cancel: "Cancel",
				more: "More settings", images: "Image steps", keepImages: "leave alone", toVision: "vision model",
				classifier: "Task detection", byRules: "keyword rules", byLlm: "semantic (LLM)",
				pressure: "Context pressure", pressureOff: "off", pressureOn: "prefer cheap when nearly full",
				session: "session", noPresets: "no presets yet — click New preset below",
				needName: "give this task type a name first", loadFailed: "load failed",
				low: "low", mid: "mid", high: "high",
			},
		}
		const dict = () => (typeof navigator !== "undefined" && /^en/i.test(navigator.language || "") ? TEXT.en : TEXT.zh)

		const PACKS = [
			{ key: "写作", words: ["续写", "小说", "情节", "文风", "人物", "章节"] },
			{ key: "代码", words: ["重构", "refactor", "架构", "接口", "测试", "性能"] },
			{ key: "翻译", words: ["翻译", "translate", "润色", "校对"] },
			{ key: "分析", words: ["分析", "调研", "对比", "总结", "报告"] },
		]
		const TIERS = [["cheap", "cheap"], ["strong", "strong"]]
		const COSTS = [1, 4, 8]
		const WEIGHTS = [[0, "none"], [40, "low"], [70, "mid"], [95, "high"]]

		async function api(path, options) {
			const response = await fetch(BASE + path, {
				method: (options && options.method) || "GET",
				cache: "no-store",
				headers: options && options.body ? { "content-type": "application/json" } : undefined,
				body: options && options.body ? JSON.stringify(options.body) : undefined,
			})
			let json = null
			try { json = await response.json() } catch (_noBody) { /* tolerate an empty body */ }
			if (!response.ok) throw new Error((json && json.error) || ("HTTP " + response.status))
			return json
		}

		const chipStyle = (active) => ({
			display: "inline-flex", alignItems: "center", gap: "4px",
			padding: "2px 8px", borderRadius: "999px", cursor: "pointer",
			font: "inherit", fontSize: "12px", lineHeight: "18px",
			color: "inherit", background: active ? "rgba(127,127,127,0.22)" : "transparent",
			border: "1px solid " + (active ? "rgba(127,127,127,0.55)" : "rgba(127,127,127,0.3)"),
			opacity: active ? 1 : 0.85,
		})
		const selectStyle = { padding: "2px 4px", borderRadius: "6px", border: "1px solid rgba(127,127,127,0.35)", background: "transparent", color: "inherit", font: "inherit", fontSize: "12px" }
		const inputStyle = Object.assign({}, selectStyle, { flex: "1 1 auto", minWidth: 0, padding: "3px 6px" })
		const panelStyle = {
			position: "fixed", zIndex: 2147483000,
			width: "360px", overflowY: "auto",
			padding: "10px 12px", borderRadius: "10px",
			background: "var(--dsh-surface, rgba(28,28,30,0.98))",
			color: "inherit", border: "1px solid rgba(127,127,127,0.35)",
			boxShadow: "0 12px 32px rgba(0,0,0,0.3)", fontSize: "12px", lineHeight: "1.5",
		}
		const labelStyle = { opacity: 0.6, fontSize: "11px", marginTop: "8px" }
		const rowStyle = { display: "flex", flexWrap: "wrap", gap: "6px", margin: "4px 0" }
		const modelRowStyle = { display: "flex", alignItems: "center", gap: "6px", margin: "2px 0" }

		function ModelRouterControl(props) {
			const sessionId = props && props.sessionId
			const catalogStore = props && props.catalog
			const t = dict()
			const [open, setOpen] = react.useState(false)
			const [pos, setPos] = react.useState(null)
			const [state, setState] = react.useState(null)
			const [error, setError] = react.useState("")
			const [busy, setBusy] = react.useState(false)
			const [editing, setEditing] = react.useState(null)
			const [customWord, setCustomWord] = react.useState("")
			const triggerRef = react.useRef(null)
			const panelRef = react.useRef(null)
			const rootRef = react.useRef(null)

			const catalogSnapshot = catalogStore
				? react.useSyncExternalStore((fn) => catalogStore.subscribe(fn), () => catalogStore.getSnapshot())
				: null
			const groups = (catalogSnapshot && catalogSnapshot.groups) || []

			const load = react.useCallback(() => {
				if (!sessionId) return
				api("/state?sessionId=" + encodeURIComponent(sessionId))
					.then((next) => { setState(next); setError("") })
					.catch((reason) => setError(t.loadFailed + ": " + String(reason.message || reason)))
			}, [sessionId, t])

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
					.catch((reason) => setError(String(reason.message || reason)))
					.finally(() => setBusy(false))
			}

			const openPanel = () => {
				const next = !open
				if (next) {
					const rect = triggerRef.current && triggerRef.current.getBoundingClientRect()
					setPos(rect && typeof window !== "undefined"
						? {
							bottom: Math.max(8, window.innerHeight - rect.top + 8),
							right: Math.max(8, window.innerWidth - rect.right),
							maxHeight: Math.max(240, rect.top - 16),
						}
						: null)
					load()
					if (props && props.loadCatalog) props.loadCatalog()
				}
				setOpen(next)
			}

			const mode = state ? state.effectiveControl : "full"
			const yielded = state ? state.engaged === false : false
			const pool = (state && state.pool) || []
			const presets = (state && state.presets) || {}
			const settings = (state && state.settings) || {}
			const packed = pool.map((entry) => entry.id)

			const savePool = (next) => run("/pool", { pool: next })
			const toggleModel = (id) => {
				if (packed.indexOf(id) >= 0) savePool(pool.filter((entry) => entry.id !== id))
				else savePool(pool.concat([{ id: id, tier: "cheap", cost: 1, tags: [] }]))
			}
			const patchEntry = (id, patch) => savePool(pool.map((entry) => (entry.id === id ? Object.assign({}, entry, patch) : entry)))

			const savePresets = (next, after) => run("/presets", { presets: next }, after)
			const beginNew = () => { setEditing({ original: null, name: "", match: [], weights: {} }); setCustomWord("") }
			const beginEdit = (name) => {
				const preset = presets[name] || {}
				setEditing({ original: name, name: name, match: (preset.match || []).slice(), weights: Object.assign({}, preset.weights || {}) })
				setCustomWord("")
			}
			const commitEditing = () => {
				const name = (editing.name || "").trim()
				if (!name) { setError(t.needName); return }
				const next = Object.assign({}, presets)
				if (editing.original && editing.original !== name) delete next[editing.original]
				next[name] = { match: editing.match.filter(Boolean), weights: editing.weights }
				savePresets(next, () => setEditing(null))
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
					key: "trigger", type: "button", title: t.title, style: chipStyle(yielded), ref: triggerRef,
					onClick: openPanel,
				},
					h("span", null, t[mode] || mode),
					h("span", { style: { width: "6px", height: "6px", borderRadius: "999px", display: "inline-block", background: yielded ? "var(--dsw-warning, #d29922)" : "var(--dsw-success, #3fb950)" } })
				),
			]

			if (open) {
				const sections = []
				sections.push(h("div", { key: "session", style: labelStyle }, t.session + ": " + (sessionId || "none")))
				sections.push(h("div", { key: "status", style: labelStyle }, yielded ? t.yielded : t.engaged))
				if (yielded) {
					sections.push(h("div", { key: "resume", style: rowStyle },
						h("button", { type: "button", style: chipStyle(true), disabled: busy, onClick: () => run("/resume", { sessionId: sessionId }) }, t.resume)
					))
				}
				sections.push(h("div", { key: "modes", style: rowStyle },
					["full", "effort", "model"].map((scope) => h("button", {
						key: scope, type: "button", style: chipStyle(mode === scope), disabled: busy,
						onClick: () => run("/control", { sessionId: sessionId, control: scope }),
					}, t[scope]))
				))
				sections.push(h("div", { key: "task-label", style: labelStyle }, t.task))
				sections.push(h("div", { key: "task", style: rowStyle },
					h("select", {
						style: Object.assign({}, selectStyle, { flex: "1 1 auto" }),
						value: state && state.pinnedTaskType ? state.pinnedTaskType : "",
						disabled: busy,
						onChange: (event) => run("/task-type", { sessionId: sessionId, preset: event.target.value || null }),
					},
						h("option", { value: "" }, t.auto),
						Object.keys(presets).map((name) => h("option", { key: name, value: name }, name))
					)
				))

				sections.push(h("div", { key: "pool-label", style: labelStyle }, t.pool + " · " + t.poolHint))
				const models = []
				for (const group of groups) {
					for (const model of (group.models || [])) {
						models.push({ id: group.id + "/" + model.id, label: model.name ? model.name : model.id })
					}
				}
				if (models.length === 0) {
					sections.push(h("div", { key: "pool-empty", style: { opacity: 0.6 } }, "..."))
				}
				sections.push(h("div", { key: "pool", style: { margin: "4px 0 6px" } },
					models.map((model) => {
						const entry = pool.find((candidate) => candidate.id === model.id)
						const children = [
							h("input", { key: "tick", type: "checkbox", checked: Boolean(entry), disabled: busy, onChange: () => toggleModel(model.id) }),
							h("span", { key: "name", style: { flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: model.id }, model.label),
						]
						if (entry) {
							children.push(h("select", {
								key: "tier", style: selectStyle, value: entry.tier, disabled: busy, title: t.tier,
								onChange: (event) => patchEntry(model.id, { tier: event.target.value }),
							}, TIERS.map((pair) => h("option", { key: pair[0], value: pair[0] }, pair[0] === "strong" ? t.strong : t.cheap))))
							children.push(h("select", {
								key: "cost", style: selectStyle, value: String(entry.cost), disabled: busy, title: t.cost,
								onChange: (event) => patchEntry(model.id, { cost: Number(event.target.value) }),
							}, COSTS.map((value) => h("option", { key: value, value: String(value) }, String(value)))))
							children.push(h("label", { key: "vision", style: { display: "inline-flex", gap: "4px", alignItems: "center" }, title: t.vision },
								h("input", {
									type: "checkbox", checked: (entry.tags || []).indexOf("vision") >= 0, disabled: busy,
									onChange: () => patchEntry(model.id, {
										tags: (entry.tags || []).indexOf("vision") >= 0
											? (entry.tags || []).filter((tag) => tag !== "vision")
											: (entry.tags || []).concat(["vision"]),
									}),
								}),
								t.vision
							))
						}
						return h("div", { key: model.id, style: modelRowStyle }, children)
					})
				))

				sections.push(h("div", { key: "presets-label", style: labelStyle }, t.presets))
				const names = Object.keys(presets)
				sections.push(h("div", { key: "presets", style: { margin: "4px 0" } },
					names.length === 0 && !editing ? h("div", { style: { opacity: 0.6 } }, t.noPresets) : null,
					names.map((name) => h("div", { key: name, style: modelRowStyle },
						h("span", { style: { flex: "1 1 auto" } }, name + " · " + (presets[name].match || []).join("/")),
						h("button", { type: "button", style: chipStyle(false), disabled: busy, onClick: () => beginEdit(name) }, t.edit),
						h("button", {
							type: "button", style: chipStyle(false), disabled: busy,
							onClick: () => { const next = Object.assign({}, presets); delete next[name]; savePresets(next) },
						}, t.remove)
					))
				))
				if (!editing) {
					sections.push(h("div", { key: "new-preset", style: rowStyle },
						h("button", { type: "button", style: chipStyle(true), disabled: busy, onClick: beginNew }, "+ " + t.newPreset)
					))
				} else {
					sections.push(h("div", { key: "preset-name-label", style: labelStyle }, t.name))
					sections.push(h("div", { key: "preset-name", style: rowStyle },
						h("input", { style: inputStyle, value: editing.name, disabled: busy, onChange: (event) => setEditing(Object.assign({}, editing, { name: event.target.value })) })
					))
					sections.push(h("div", { key: "preset-key-label", style: labelStyle }, t.keywords))
					sections.push(h("div", { key: "preset-packs", style: rowStyle },
						PACKS.map((pack) => h("button", {
							key: pack.key, type: "button", style: chipStyle(false), disabled: busy,
							onClick: () => {
								const all = pack.words.every((word) => editing.match.indexOf(word) >= 0)
								setEditing(Object.assign({}, editing, {
									match: all
										? editing.match.filter((word) => pack.words.indexOf(word) < 0)
										: editing.match.concat(pack.words.filter((word) => editing.match.indexOf(word) < 0)),
								}))
							},
						}, "+ " + pack.key))
					))
					sections.push(h("div", { key: "preset-words", style: rowStyle },
						editing.match.map((word) => h("button", { key: word, type: "button", style: chipStyle(true), disabled: busy, onClick: () => toggleWord(word) }, word + " x"))
					))
					sections.push(h("div", { key: "preset-custom", style: rowStyle },
						h("input", {
							style: inputStyle, value: customWord, placeholder: t.add, disabled: busy,
							onChange: (event) => setCustomWord(event.target.value),
							onKeyDown: (event) => { if (event.key === "Enter") addWord(customWord) },
						}),
						h("button", { type: "button", style: chipStyle(false), disabled: busy || customWord.trim().length === 0, onClick: () => addWord(customWord) }, t.add)
					))
					sections.push(h("div", { key: "preset-weights-label", style: labelStyle }, t.weights))
					sections.push(h("div", { key: "preset-weights" },
						pool.length === 0
							? h("div", { key: "no-pool", style: { opacity: 0.6 } }, t.poolHint)
							: pool.map((entry) => h("div", { key: entry.id, style: modelRowStyle },
								h("span", { style: { flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: entry.id }, entry.id),
								h("select", {
									style: selectStyle, value: String(editing.weights[entry.id] || 0), disabled: busy,
									onChange: (event) => setWeight(entry.id, event.target.value),
								}, WEIGHTS.map((pair) => h("option", { key: pair[0], value: String(pair[0]) }, t[pair[1]] || pair[1])))
							))
					))
					sections.push(h("div", { key: "preset-actions", style: rowStyle },
						h("button", { type: "button", style: chipStyle(true), disabled: busy, onClick: commitEditing }, t.save),
						h("button", { type: "button", style: chipStyle(false), disabled: busy, onClick: () => setEditing(null) }, t.cancel)
					))
				}

				sections.push(h("div", { key: "more-label", style: labelStyle }, t.more))
				sections.push(h("div", { key: "more", style: { margin: "4px 0" } },
					h("div", { style: modelRowStyle },
						h("span", { style: { flex: "1 1 auto" } }, t.images),
						h("select", {
							style: selectStyle, value: settings.imagePolicy || "keep", disabled: busy,
							onChange: (event) => setSetting({ imagePolicy: event.target.value }),
						},
							h("option", { value: "keep" }, t.keepImages),
							h("option", { value: "vision" }, t.toVision))
					),
					h("div", { style: modelRowStyle },
						h("span", { style: { flex: "1 1 auto" } }, t.classifier),
						h("select", {
							style: selectStyle, value: settings.classifier || "rules", disabled: busy,
							onChange: (event) => setSetting({ classifier: event.target.value }),
						},
							h("option", { value: "rules" }, t.byRules),
							h("option", { value: "llm" }, t.byLlm))
					),
					h("div", { style: modelRowStyle },
						h("span", { style: { flex: "1 1 auto" } }, t.pressure),
						h("select", {
							style: selectStyle,
							value: settings.signals && Number(settings.signals.contextPressure) > 0 ? "on" : "off",
							disabled: busy,
							onChange: (event) => setSetting({ signals: { contextPressure: event.target.value === "on" ? 0.75 : 0 } }),
						},
							h("option", { value: "off" }, t.pressureOff),
							h("option", { value: "on" }, t.pressureOn))
					)
				))

				if (state && state.current) {
					sections.push(h("div", { key: "current", style: labelStyle }, state.current.provider + "/" + state.current.model + " · " + (state.current.effort || "default") + " · " + state.current.stepClass))
				}
				if (error) sections.push(h("div", { key: "error", style: { color: "var(--dsw-danger, #f85149)", marginTop: "6px" } }, error))

				const panel = h("div", {
					key: "panel", ref: panelRef,
					style: Object.assign({}, panelStyle, {
						bottom: pos ? pos.bottom : 96,
						right: pos ? pos.right : 24,
						maxHeight: pos ? pos.maxHeight : "70vh",
					}),
					onMouseDown: (event) => event.stopPropagation(),
				}, sections)
				parts.push(reactDom.createPortal(panel, document.body))
			}

			return h("div", { ref: rootRef, style: { position: "relative", display: "inline-flex", alignItems: "center" } }, parts)
		}

		const name = "model-router"
		const inject = ["slots"]

		function apply(ctx) {
			ctx.inject(["slots", "modelDirectories"], (scope) => {
				const directories = scope.modelDirectories
				scope.slots.inject("conversation.input.right", () => scope.slots.register({
					name: "conversation.input.right",
					id: "model-router:composer-control",
					order: 20,
					registrant: NS,
					inject: (sessionId) => {
						let directory
						try { directory = directories && sessionId ? directories.directoryFor(sessionId) : undefined } catch (_noDirectory) { directory = undefined }
						return {
							sessionId: sessionId,
							catalog: directory ? directory.store : undefined,
							loadCatalog: directory ? () => { try { directory.load().catch(() => {}) } catch (_noLoad) { /* ignore */ } } : undefined,
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
