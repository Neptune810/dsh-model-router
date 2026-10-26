/**
 * dsh-model-router — spend guard arithmetic (v0.16.1).
 *
 * The guard answers one question per step: how much of each configured ceiling is
 * already spent, and is that number only worth a warning or worth refusing? The
 * arithmetic is pure and clock-explicit here so the interesting cases — a limit
 * of zero meaning "no limit", a soft band, an unreadable ledger, a month that
 * starts at local midnight rather than UTC — are unit tests instead of field
 * reports.
 *
 * Nothing in this file reads the configuration or the telemetry ledger; the
 * caller passes the numbers in.
 */

/** The four ceilings, in the order the panel shows them. */
export const BUDGET_ROW_IDS = Object.freeze(["sessionTokens", "sessionUsd", "dayUsd", "monthUsd"])

/** Local midnight for the timestamp's timezone (the user's own day). */
export function localDayStart(at) {
  const date = new Date(Number.isFinite(at) ? at : Date.now())
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Local first-of-month, midnight, for the timestamp's timezone. */
export function localMonthStart(at) {
  const date = new Date(Number.isFinite(at) ? at : Date.now())
  date.setDate(1)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function finite(value) {
  return Number.isFinite(value) ? value : null
}

/**
 * Build one report from the ceilings and what has been spent against them.
 *
 * @param options - { mode, softRatio, limits, used, ledgerAgeMs }.
 *   limits/used carry sessionTokens, sessionUsd, dayUsd, monthUsd. A limit of 0
 *   (or a missing one) means "no limit" and is reported as inactive; a used
 *   value of null means "not known yet" (the ledger was never read) and never
 *   trips a threshold — a guard that refuses work because it cannot count would
 *   be worse than no guard.
 */
export function budgetReport(options = {}) {
  const o = options && typeof options === "object" ? options : {}
  const limits = o.limits && typeof o.limits === "object" ? o.limits : {}
  const used = o.used && typeof o.used === "object" ? o.used : {}
  const softRatio = Number.isFinite(o.softRatio) ? Math.max(0, Math.min(1, o.softRatio)) : 0.8
  const rows = BUDGET_ROW_IDS.map((id) => {
    const limit = finite(limits[id])
    const spent = finite(used[id])
    const active = limit !== null && limit > 0
    const ratio = active && spent !== null ? spent / limit : 0
    return {
      id,
      unit: id === "sessionTokens" ? "tokens" : "usd",
      limit: limit === null ? 0 : limit,
      used: spent,
      active,
      ratio: Math.round(ratio * 1e4) / 1e4,
      remaining: active && spent !== null ? Math.max(0, limit - spent) : null,
      soft: active && spent !== null && ratio >= softRatio && ratio < 1,
      over: active && spent !== null && ratio >= 1,
    }
  })
  const over = rows.filter((row) => row.over).map((row) => row.id)
  return {
    mode: o.mode === "inform" || o.mode === "block" ? o.mode : "off",
    softRatio,
    limits: {
      sessionTokens: Number.isFinite(limits.sessionTokens) ? limits.sessionTokens : 0,
      sessionUsd: Number.isFinite(limits.sessionUsd) ? limits.sessionUsd : 0,
      dayUsd: Number.isFinite(limits.dayUsd) ? limits.dayUsd : 0,
      monthUsd: Number.isFinite(limits.monthUsd) ? limits.monthUsd : 0,
    },
    rows,
    ledgerAgeMs: Number.isFinite(o.ledgerAgeMs) ? o.ledgerAgeMs : null,
    soft: rows.some((row) => row.soft || row.over),
    over,
    exceeded: over.length > 0,
  }
}

/** "sessionUsd $0.4000/$0.50" — one row, for a log line or a command answer. */
export function formatBudgetRow(row) {
  if (!row || typeof row !== "object") return ""
  const limit = row.unit === "usd" ? "$" + Number(row.limit).toFixed(2) : Math.round(row.limit) + " tok"
  const spent = row.used === null || row.used === undefined
    ? "?"
    : row.unit === "usd" ? "$" + Number(row.used).toFixed(4) : String(Math.round(row.used))
  const mark = row.over ? " over" : row.soft ? " near" : ""
  return row.id + " " + spent + "/" + limit + mark
}

/** The rows worth mentioning: the active ones, worst first. */
export function budgetLine(report) {
  const rows = report && Array.isArray(report.rows) ? report.rows : []
  return rows
    .filter((row) => row.active)
    .sort((left, right) => (right.ratio - left.ratio) || (left.id < right.id ? -1 : 1))
    .map(formatBudgetRow)
    .join(", ")
}
