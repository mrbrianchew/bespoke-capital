// Pre-filled "review" statements: builds a statement from the live Financials
// plan, and merges a submitted statement back WITHOUT wiping live details the
// statement form has no fields for (property loan dates, notes, the other
// spouse's custom amounts, ...). Pure functions only, so they are easy to test.
//
// Live plan conventions (see SnapshotsTab.tsx header):
// - Client keys are plain (a_savings), Spouse keys carry a "2" (a2_savings).
// - Income lives in person1 / person2; other_incomes are MONTHLY, the
//   statement holds them ANNUAL.
// - Custom rows are shared rows { label, amount (Client), amount2 (Spouse), notes }.

import {
  StatementData, StmtProperty, StmtCatLineItem, emptyStatementData,
  EXP_SIMPLE_FIELDS, EXP_DETAILED_BLOCKS, EXP_CUSTOM_KEY,
  ASSET_BLOCKS, ASSET_CUSTOM_KEY, LIAB_BLOCKS, LIAB_CUSTOM_KEY,
  stmtIncomeTotal, stmtExpSimpleTotal, stmtExpDetailedTotal, stmtAssetsTotal, stmtLiabTotal,
} from './statementFields'

export type Person = 'client' | 'spouse'
export type CustomSlot = 'amount' | 'amount2'

// Client: s_x -> s_x. Spouse: s_x -> s2_x (same rule the Apply step uses).
export function keyFor(baseKey: string, person: Person): string {
  if (person === 'client') return baseKey
  const m = baseKey.match(/^([a-z]+)_(.+)$/)
  return m ? `${m[1]}2_${m[2]}` : `${baseKey}2`
}

export const slotFor = (person: Person): CustomSlot => (person === 'client' ? 'amount' : 'amount2')

const round0 = (n: number) => Math.round(n || 0)
const numOr0 = (v: unknown): number => (typeof v === 'number' && isFinite(v)) ? v : 0
const sameLabel = (a: string, b: string) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase()

interface LiveRow { label: string; amount?: number; amount2?: number; notes?: string }

function pickNumbers(ff: any, keys: string[], person: Person): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of keys) {
    const v = numOr0(ff?.[keyFor(k, person)])
    if (v) out[k] = v
  }
  return out
}

function customToStmt(ff: any, liveKey: string, cat: string, person: Person): StmtCatLineItem[] {
  const slot = slotFor(person)
  const rows: LiveRow[] = Array.isArray(ff?.[liveKey]) ? ff[liveKey] : []
  return rows
    .filter(r => numOr0(r[slot]) !== 0)
    .map(r => ({ cat, label: r.label || '', amount: numOr0(r[slot]) }))
}

// ---------- Live plan -> statement ----------

export function buildPrefill(ff: any, person: Person): StatementData {
  const d = emptyStatementData()
  const p = ff?.[person === 'client' ? 'person1' : 'person2'] || {}

  d.income.gross_monthly = numOr0(p.gross_monthly) || undefined
  d.income.gross_bonus = numOr0(p.gross_bonus) || undefined
  d.income.others = (Array.isArray(p.other_incomes) ? p.other_incomes : [])
    .filter((i: any) => i && (i.label || i.amount))
    .map((i: any) => ({ label: i.label || '', amount: round0(numOr0(i.amount) * 12) })) // monthly -> annual

  // Mirror the live toggle so Apply never flips the client's mode by accident.
  d.expense_mode = ff?.expense_mode === 'detailed' ? 'detailed' : 'simple'
  d.exp_simple = pickNumbers(ff, EXP_SIMPLE_FIELDS.map(f => f.key), person)
  d.exp_detailed = pickNumbers(ff, EXP_DETAILED_BLOCKS.flatMap(b => b.fields.map(f => f.key)), person)
  d.exp_detailed_custom = EXP_DETAILED_BLOCKS.flatMap(b => customToStmt(ff, EXP_CUSTOM_KEY[b.id], b.id, person))

  d.assets = pickNumbers(ff, ASSET_BLOCKS.flatMap(b => b.fields.map(f => f.key)), person)
  d.assets_custom = ASSET_BLOCKS.flatMap(b => customToStmt(ff, ASSET_CUSTOM_KEY[b.id], b.id, person))

  d.liabilities = pickNumbers(ff, LIAB_BLOCKS.flatMap(b => b.fields.map(f => f.key)), person)
  d.liabilities_custom = LIAB_BLOCKS.flatMap(b => customToStmt(ff, LIAB_CUSTOM_KEY[b.id], b.id, person))

  d.properties = (Array.isArray(ff?.properties) ? ff.properties : []).map((lp: any): StmtProperty => ({
    id: String(lp.id),
    label: lp.label || '',
    propertyType: lp.propertyType || 'HDB',
    isPrimaryResidence: !!lp.isPrimaryResidence,
    ownershipType: (!lp.ownershipType || lp.ownershipType === 'Client Only') ? 'Sole Ownership' : lp.ownershipType,
    purchasePrice: numOr0(lp.purchasePrice) || undefined,
    propertyValue: numOr0(lp.propertyValue) || undefined,
    bank: lp.bank || undefined,
    loanType: lp.loanType || undefined,
    outstanding: numOr0(lp.outstanding) || undefined,
    remainingTenure: numOr0(lp.remainingTenure) || undefined,
    interestRate: numOr0(lp.interestRate) || undefined,
    monthlyRepayment: numOr0(lp.monthlyRepayment) || undefined,
  }))
  return d
}

export function isPrefillEmpty(d: StatementData): boolean {
  return stmtIncomeTotal(d) === 0 && stmtExpSimpleTotal(d) === 0 && stmtExpDetailedTotal(d) === 0
    && stmtAssetsTotal(d) === 0 && stmtLiabTotal(d) === 0 && (d.properties || []).length === 0
}

// ---------- Statement -> live plan (merge, never replace) ----------

/**
 * Writes ONE person's amounts into the shared custom rows.
 * - Rows are matched by label (case-insensitive), so notes and the other
 *   person's amount are kept.
 * - baseline = what the form was pre-filled with. With a baseline, live rows
 *   that were never on the form are left alone; only rows the client removed
 *   get this person's amount zeroed. Without a baseline (a first statement)
 *   every live row not in the statement is zeroed for this person, which is
 *   what replacing this person's section means.
 * - A row left with no amount for anyone is dropped.
 */
export function mergeCustomRows(
  live: unknown,
  stmtRows: { label: string; amount: number }[],
  person: Person,
  baselineRows?: { label: string }[] | null,
): LiveRow[] {
  const slot = slotFor(person)
  const rows: LiveRow[] = (Array.isArray(live) ? live : []).map((r: any) => ({ ...r }))
  const matched = new Set<number>()

  for (const s of stmtRows) {
    if (!s.label && !s.amount) continue
    const idx = rows.findIndex((r, i) => !matched.has(i) && sameLabel(r.label, s.label))
    if (idx >= 0) {
      matched.add(idx)
      rows[idx][slot] = round0(s.amount)
    } else {
      rows.push({ label: s.label, amount: 0, amount2: 0, [slot]: round0(s.amount) })
      matched.add(rows.length - 1)
    }
  }

  const zeroed = new Set<number>()
  rows.forEach((r, i) => {
    if (matched.has(i)) return
    const wasOnForm = !baselineRows || baselineRows.some(b => sameLabel(b.label, r.label))
    if (wasOnForm) { r[slot] = 0; zeroed.add(i) }
  })

  return rows.filter((r, i) => !(zeroed.has(i) && numOr0(r.amount) === 0 && numOr0(r.amount2) === 0))
}

const PROP_FIELDS: (keyof StmtProperty)[] = [
  'label', 'propertyType', 'isPrimaryResidence', 'ownershipType',
  'purchasePrice', 'propertyValue', 'bank', 'loanType',
  'outstanding', 'remainingTenure', 'interestRate', 'monthlyRepayment',
]

const toLiveOwnership = (t: string | undefined) => (t === 'Sole Ownership' ? 'Client Only' : (t || 'Client Only'))
const norm = (v: unknown) => (typeof v === 'boolean' ? v : (v === undefined || v === null || v === 0 || v === '' ? undefined : v))

function toLiveValue(f: keyof StmtProperty, v: unknown): unknown {
  if (f === 'ownershipType') return toLiveOwnership(v as string | undefined)
  if (f === 'label') return (v as string) || ''
  if (f === 'isPrimaryResidence') return !!v
  if (f === 'propertyType') return (v as string) || 'HDB'
  return norm(v)
}

/**
 * Merges the statement's property list into the live list (matched by id).
 * - Matched property: with a baseline, only the boxes the client changed are
 *   written (a cleared box clears the value); everything else on the live
 *   property (loan start date, lock-in, ownership split, notes, ...) is kept.
 *   Without a baseline, the boxes the client filled in overwrite.
 * - New property: added.
 * - Live property missing from the statement: removed if it was on the form
 *   (client deleted it, or there is no baseline = old replace behaviour);
 *   kept if it was added to the plan after the link was made.
 */
export function mergeProperties(
  live: unknown,
  stmtProps: StmtProperty[],
  baselineProps?: StmtProperty[] | null,
): any[] {
  const liveList: any[] = Array.isArray(live) ? live : []
  const baseById = new Map((baselineProps || []).map(b => [b.id, b]))
  const stmtIds = new Set(stmtProps.map(p => p.id))
  const out: any[] = []

  for (const sp of stmtProps) {
    const lp = liveList.find(x => x.id === sp.id)
    const base = baseById.get(sp.id)
    if (lp && base) {
      const next = { ...lp }
      for (const f of PROP_FIELDS) {
        if (norm(sp[f]) === norm(base[f])) continue // client left it alone
        const val = toLiveValue(f, sp[f])
        if (val === undefined) delete next[f]; else next[f] = val
      }
      out.push(next)
    } else {
      const built: Record<string, unknown> = { id: sp.id }
      for (const f of PROP_FIELDS) {
        const val = toLiveValue(f, sp[f])
        if (val !== undefined) built[f] = val
      }
      out.push(lp ? { ...lp, ...built } : built)
    }
  }

  for (const lp of liveList) {
    if (stmtIds.has(lp.id)) continue
    const wasOnForm = !baselineProps || baseById.has(lp.id)
    if (!wasOnForm) out.push(lp)
  }
  return out
}