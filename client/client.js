/**
 * dsh-model-router — browser half.
 *
 * Ships as the same lazy-CJS bundle shape every third-party client plugin uses
 * (\`window.__ModuleLoader__.load({ id, factory })\`), written by hand so the
 * package needs no build step. It registers one composer contribution into the
 * list slot \`conversation.input.right\`, which renders immediately to the LEFT of
 * the manual model seat, and talks to the host over the same-origin
 * \`/model-router/*\` routes.
 *
 * Nothing here imports a host package: React is a platform seed, and the host
 * routes carry all state, so the bundle stays self-contained.
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
		const MODE_LABEL = {
			zh: { full: "全授权", effort: "思考等级", model: "模型模式", title: "模型路由", resume: "重新接管", engaged: "已接管", yielded: "已让位（手调）", task: "任务类型", none: "自动（关键词规则）", pool: "模型池", add: "添加", presets: "任务预设（JSON）", save: "保存", remove: "移除", empty: "池为空时使用插件默认模型" },
			en: { full: "Full", effort: "Effort only", model: "Model only", title: "Model router", resume: "Resume control", engaged: "Controlling", yielded: "Yielded (manual)", task: "Task type", none: "Auto (keyword rules)", pool: "Model pool", add: "Add", presets: "Task presets (JSON)", save: "Save", remove: "Remove", empty: "Empty pool falls back to the plugin default model" },
		}
		const dict = () => (typeof navigator !== "undefined" && /^en/i.test(navigator.language || "") ? MODE_LABEL.en : MODE_LABEL.zh)

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

		const chip = (active) => ({
			display: "inline-flex", alignItems: "center", gap: "4px",
			padding: "3px 8px", borderRadius: "999px", cursor: "pointer",
			font: "inherit", fontSize: "12px", lineHeight: "18px",
			color: "inherit", background: active ? "rgba(127,127,127,0.22)" : "transparent",
			border: "1px solid " + (active ? "rgba(127,127,127,0.5)" : "rgba(127,127,127,0.32)"),
			opacity: active ? 1 : 0.86,
		})

		const panelStyle = {
			position: "absolute", bottom: "calc(100% + 8px)", right: 0, zIndex: 40,
			width: "340px", maxHeight: "60vh", overflowY: "auto",
			padding: "10px 12px", borderRadius: "10px",
			background: "var(--dsh-surface, rgba(28,28,30,0.98))",
			color: "inherit", border: "1px solid rgba(127,127,127,0.35)",
			boxShadow: "0 12px 32px rgba(0,0,0,0.28)", fontSize: "12px", lineHeight: "1.5",
		}
		const rowStyle = { display: "flex", flexWrap: "wrap", gap: "6px", margin: "6px 0 10px" }
		const labelStyle = { opacity: 0.6, fontSize: "11px", marginTop: "8px" }
		const inputStyle = { flex: "1 1 auto", minWidth: 0, padding: "3px 6px", borderRadius: "6px", border: "1px solid rgba(127,127,127,0.35)", background: "transparent", color: "inherit", font: "inherit", fontSize: "12px" }

		function ModelRouterControl(props) {
			const sessionId = props && props.sessionId
			const [open, setOpen] = react.useState(false)
			const [state, setState] = react.useState(null)
			const [error, setError] = react.useState("")
			const [busy, setBusy] = react.useState(false)
			const [draft, setDraft] = react.useState("")
			const [presetDraft, setPresetDraft] = react.useState("")
			const rootRef = react.useRef(null)
			const triggerRef = react.useRef(null)
			const panelRef = react.useRef(null)
			const [pos, setPos] = react.useState(null)
			const t = dict()

			const load = react.useCallback(() => {
				if (!sessionId) return
				api("/state?sessionId=" + encodeURIComponent(sessionId))
					.then((next) => { setState(next); setError(""); setPresetDraft(JSON.stringify(next.presets || {}, null, 2)) })
					.catch((reason) => setError(String(reason.message || reason)))
			}, [sessionId])

			react.useEffect(() => { load() }, [load])
			react.useEffect(() => {
				// One line of evidence for "is the bundle loaded at all?".
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

			const run = (path, body) => {
				setBusy(true)
				api(path, { method: "POST", body })
					.then(() => { setError(""); load() })
					.catch((reason) => setError(String(reason.message || reason)))
					.finally(() => setBusy(false))
			}

			const mode = state ? state.effectiveControl : "full"
			const yielded = state ? state.engaged === false : false
			const pool = (state && state.pool) || []
			const presets = state ? Object.keys(state.presets || {}) : []

			const parts = [
				h("button", {
					key: "trigger", type: "button", title: t.title, style: chip(yielded), ref: triggerRef,
					onClick: () => {
						const next = !open
						if (next) {
							const rect = triggerRef.current && triggerRef.current.getBoundingClientRect()
							setPos(rect && window !== undefined
								? {
									bottom: Math.max(8, window.innerHeight - rect.top + 8),
									right: Math.max(8, window.innerWidth - rect.right),
									maxHeight: Math.max(240, rect.top - 16),
								}
								: null)
							load()
						}
						setOpen(next)
					},
				},
					h("span", null, t[mode] || mode),
					h("span", { style: { width: "6px", height: "6px", borderRadius: "999px", background: yielded ? "var(--dsw-warning, #d29922)" : "var(--dsw-success, #3fb950)", display: "inline-block" } })
				),
			]

			if (open) {
				const sections = []
				sections.push(h("div", { key: "session", style: labelStyle }, "session: " + (sessionId || "none")))
				sections.push(h("div", { key: "status", style: labelStyle }, yielded ? t.yielded : t.engaged))
				if (yielded) {
					sections.push(h("div", { key: "resume", style: rowStyle },
						h("button", { type: "button", style: chip(true), disabled: busy, onClick: () => run("/resume", { sessionId }) }, t.resume)
					))
				}
				sections.push(h("div", { key: "modes-label", style: labelStyle }, t.title))
				sections.push(h("div", { key: "modes", style: rowStyle },
					["full", "effort", "model"].map((scope) => h("button", {
						key: scope, type: "button", style: chip(mode === scope), disabled: busy,
						onClick: () => run("/control", { sessionId, control: scope }),
					}, t[scope]))
				))
				sections.push(h("div", { key: "task-label", style: labelStyle }, t.task))
				sections.push(h("div", { key: "task", style: rowStyle },
					h("select", {
						style: inputStyle,
						value: state && state.pinnedTaskType ? state.pinnedTaskType : "",
						disabled: busy,
						onChange: (event) => run("/task-type", { sessionId, preset: event.target.value || null }),
					},
						h("option", { value: "" }, t.none),
						presets.map((name) => h("option", { key: name, value: name }, name))
					)
				))
				sections.push(h("div", { key: "pool-label", style: labelStyle }, t.pool))
				sections.push(h("div", { key: "pool", style: { margin: "4px 0 6px" } },
					pool.length === 0 ? h("div", { style: { opacity: 0.6 } }, t.empty) : pool.map((entry) => h("div", { key: entry.id, style: { display: "flex", alignItems: "center", gap: "6px", margin: "2px 0" } },
						h("span", { style: { flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, entry.id + " · " + entry.tier + " · cost " + entry.cost),
						h("button", {
							type: "button", style: chip(false), disabled: busy,
							onClick: () => run("/pool", { pool: pool.filter((candidate) => candidate.id !== entry.id).map((candidate) => ({ id: candidate.id, tier: candidate.tier, cost: candidate.cost, tags: candidate.tags })) }),
						}, t.remove)
					))
				))
				sections.push(h("div", { key: "add", style: rowStyle },
					h("input", { style: inputStyle, placeholder: "provider/model", value: draft, onChange: (event) => setDraft(event.target.value) }),
					h("button", {
						type: "button", style: chip(false), disabled: busy || draft.trim().length === 0,
						onClick: () => {
							const name = draft.trim()
							if (!name) return
							setDraft("")
							run("/pool", { pool: pool.map((entry) => ({ id: entry.id, tier: entry.tier, cost: entry.cost, tags: entry.tags })).concat([{ id: name }]) })
						},
					}, t.add)
				))
				sections.push(h("div", { key: "presets-label", style: labelStyle }, t.presets))
				sections.push(h("textarea", {
					key: "presets", value: presetDraft, spellCheck: false, rows: 6,
					style: Object.assign({}, inputStyle, { width: "100%", fontFamily: "ui-monospace, monospace", resize: "vertical" }),
					onChange: (event) => setPresetDraft(event.target.value),
				}))
				sections.push(h("div", { key: "presets-save", style: rowStyle },
					h("button", {
						type: "button", style: chip(true), disabled: busy,
						onClick: () => {
							let parsed
							try { parsed = JSON.parse(presetDraft || "{}") } catch (reason) { setError("JSON: " + String(reason.message || reason)); return }
							run("/presets", { presets: parsed })
						},
					}, t.save)
				))
				if (state && state.current) {
					sections.push(h("div", { key: "current", style: labelStyle }, state.current.provider + "/" + state.current.model + " · " + (state.current.effort || "default") + " · " + state.current.stepClass))
				}
				if (state && state.signals) {
					const signals = state.signals
					sections.push(h("div", { key: "signals", style: labelStyle },
						"pressure " + (signals.pressure === null || signals.pressure === undefined ? "–" : signals.pressure) +
						" · tokens " + (signals.sessionTokens || 0) +
						" · depth " + (signals.delegationDepth || 0) +
						(signals.todo ? " · todo " + signals.todo : "")
					))
				}
				if (error) sections.push(h("div", { key: "error", style: { color: "var(--dsw-danger, #f85149)", marginTop: "6px" } }, error))

				// Portal to <body> with fixed coordinates, like the host's own model menu:
				// an ancestor of the composer may clip an absolutely positioned panel.
				const panel = h("div", {
					key: "panel", ref: panelRef,
					style: Object.assign({}, panelStyle, {
						position: "fixed",
						bottom: pos ? pos.bottom : 96,
						right: pos ? pos.right : 24,
						maxHeight: pos ? pos.maxHeight : "60vh",
						zIndex: 2147483000,
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
			ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
				name: "conversation.input.right",
				id: "model-router:composer-control",
				order: 20,
				registrant: NS,
				inject: (sessionId) => ({ sessionId }),
			}, ModelRouterControl))
		}

		exports.name = name
		exports.inject = inject
		exports.apply = apply
		exports.ModelRouterControl = ModelRouterControl
		return module.exports
	},
})
