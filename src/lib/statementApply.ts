// Turns a client's statement into plan fields (the "Apply" patch). Pure, no I/O.
// Shared by the advisor Snapshots tab (Apply) and the public statement route
// (the "before you submit" check), so both use exactly the same mapping.
//
// UNITS: the statement stores ANNUAL figures. Plan income fields are MONTHLY
// (gross_monthly, other_incomes); plan expenses (s_*/d_*) are ANNUAL.

import { keyFor, mergeCustomRows, mergeProperties, type Person } from './statementPrefill'
import {
  StatementData, emptyStatementData,
  EXP_SIMPLE_FIELDS, EXP_DETAILED_BLOCKS, EXP_CUSTOM_KEY,
  ASSET_BLOCKS, ASSET_CUSTOM_KEY, LIAB_BLOCKS, LIAB_CUSTOM_KEY,
} from './statementFields'

export type SectionId = 'income' | 'expenses' | 'assets' | 'properties' | 'liabilities'

const round0 = (n: number) => Math.round(n || 0)
const perMonth = (annual: number) => round0((annual || 0) / 12)

export function normalizeData(raw: any): StatementData {
  const base = emptyStatementData()
  if (!raw || typeof raw !== 'object') return base
  return { ...base, ...raw, income: { ...base.income, ...(raw.income || {}) } }
}

// ---------- Apply patch builders ----------
// fields = top-level fact_finding keys to write (already person-suffixed where relevant)
// personFields = keys to write nested under ff.person1 / ff.person2 (Income only)

export interface ApplyPatch { fields: Record<string, any>; personKey: 'person1' | 'person2' | null; personFields: Record<string, any> }

// live = the plan as it is now; baseline = what a pre-filled form started with (null for a first statement).
// Custom rows and Properties are MERGED into live, never replaced, so details the form has no boxes for survive.
export function buildApplyPatch(section: SectionId, st: StatementData, person: Person, live: any, baseline: StatementData | null): ApplyPatch {
  const fields: Record<string, any> = {}
  const personFields: Record<string, any> = {}
  const personKey: 'person1' | 'person2' = person === 'client' ? 'person1' : 'person2'

  if (section === 'income') {
    personFields.gross_monthly = round0(st.income.gross_monthly || 0)
    personFields.gross_bonus = round0(st.income.gross_bonus || 0)
    personFields.other_incomes = (st.income.others || [])
      .filter(i => i.label || i.amount)
      .map(i => ({ label: i.label, amount: perMonth(i.amount) })) // annual → monthly
  }

  if (section === 'expenses') {
    // expense_mode is a shared toggle on the advisor page (not per-person) —
    // only set it from the Client's statement so the Spouse's Apply doesn't
    // flip a mode the Client already configured.
    if (person === 'client') fields.expense_mode = st.expense_mode
    if (st.expense_mode === 'simple') {
      for (const f of EXP_SIMPLE_FIELDS) fields[keyFor(f.key, person)] = round0(st.exp_simple[f.key] || 0)
      const customAnnual = (st.exp_simple_custom || []).reduce((s, i) => s + (i.amount || 0), 0)
      if (customAnnual > 0) {
        const lifestyleKey = keyFor('s_lifestyle', person)
        fields[lifestyleKey] = (fields[lifestyleKey] || 0) + round0(customAnnual)
      }
    } else {
      for (const block of EXP_DETAILED_BLOCKS) {
        for (const f of block.fields) fields[keyFor(f.key, person)] = round0(st.exp_detailed[f.key] || 0)
        // Custom rows are shared rows: Client amount in `amount`, Spouse in `amount2`.
        const customKey = EXP_CUSTOM_KEY[block.id]
        fields[customKey] = mergeCustomRows(live?.[customKey], (st.exp_detailed_custom || []).filter(i => i.cat === block.id), person,
          baseline ? (baseline.exp_detailed_custom || []).filter(i => i.cat === block.id) : null)
      }
    }
  }

  if (section === 'assets') {
    for (const block of ASSET_BLOCKS) {
      for (const f of block.fields) fields[keyFor(f.key, person)] = round0(st.assets[f.key] || 0)
      const customKey = ASSET_CUSTOM_KEY[block.id]
      fields[customKey] = mergeCustomRows(live?.[customKey], (st.assets_custom || []).filter(i => i.cat === block.id), person,
        baseline ? (baseline.assets_custom || []).filter(i => i.cat === block.id) : null)
    }
  }

  if (section === 'liabilities') {
    for (const block of LIAB_BLOCKS) {
      for (const f of block.fields) fields[keyFor(f.key, person)] = round0(st.liabilities[f.key] || 0)
      const customKey = LIAB_CUSTOM_KEY[block.id]
      fields[customKey] = mergeCustomRows(live?.[customKey], (st.liabilities_custom || []).filter(i => i.cat === block.id), person,
        baseline ? (baseline.liabilities_custom || []).filter(i => i.cat === block.id) : null)
    }
  }

  if (section === 'properties') {
    // Shared/joint — matched by id; see mergeProperties for what is kept.
    fields.properties = mergeProperties(live?.properties, st.properties || [], baseline ? baseline.properties || [] : null)
  }

  return { fields, personKey: Object.keys(personFields).length > 0 ? personKey : null, personFields }
}