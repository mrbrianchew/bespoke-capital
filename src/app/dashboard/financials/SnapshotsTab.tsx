'use client'

// Snapshots tab (Financials page) — advisor side of the client-facing
// Financial Statement feature.
//
// Each spouse gets their OWN link and fills in their own Income / Expenses /
// Assets / Liabilities individually (no need to sit down together). This
// maps cleanly onto the advisor page's data model: Expenses/Assets/
// Liabilities are already stored as parallel per-person keys there
// (e.g. l_credit_card = Client, l2_credit_card = Spouse — summed only for
// display), and Income is already person1/person2. So a person-tagged
// statement writes straight into the matching key set, with zero manual
// splitting.
//
// - Properties is the one section that's genuinely shared (joint asset), so
//   BOTH statements can enter it, and the advisor picks which one to Apply
//   (per Brian's decision — no auto-merge, no silent guessing).
// - Apply is the only write path into fact_finding, gated behind the
//   advisor's own RLS session, and logs pre-Apply values for a one-step Revert.
//
// UNITS: the statement stores ANNUAL figures throughout. fact_finding's
// income fields (person1/person2.gross_monthly, .other_incomes) are stored
// MONTHLY, so Apply divides other_incomes by 12 (gross_monthly is already
// monthly on both sides — no conversion needed). Expenses (s_*/d_* keys) are
// stored ANNUAL in fact_finding — same as the statement — so Apply writes
// them straight through with no conversion. Do NOT add a ÷12 here: the
// Financials tab's own Expenses UI, its annual_surplus save calc, and the
// Financial Report's Overview snapshot all read these fields as annual.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { saveFactFindingSection } from '@/lib/factFindingSave'
import { currentMonthStartSG } from '@/lib/cpfHistory'
import { replaceVersionWithPlan } from '@/lib/replaceVersion'
import { buildPrefill, isPrefillEmpty, keyFor, mergeCustomRows, mergeProperties, type Person } from '@/lib/statementPrefill'
import { useConfirm } from '@/components/ConfirmDialog'
import {
  StatementData, emptyStatementData,
  EXP_SIMPLE_FIELDS, EXP_DETAILED_BLOCKS, EXP_CUSTOM_KEY,
  ASSET_BLOCKS, ASSET_CUSTOM_KEY, LIAB_BLOCKS, LIAB_CUSTOM_KEY,
  stmtIncomeTotal, stmtExpenseTotal, stmtAssetsTotal, stmtLiabTotal, stmtPropertyEquity,
  fmtStmtMoney,
} from '@/lib/statementFields'

interface StatementRow {
  id: string
  client_id: string
  year: number
  person: Person
  token: string
  password_hint: string | null
  expires_at: string | null
  status: 'draft' | 'submitted'
  data: any
  kind?: 'first' | 'review' | null
  baseline?: any
  client_name: string | null
  client_occupation: string | null
  submitted_at: string | null
  updated_at: string
  created_at: string
}

interface ApplyLogRow {
  id: string
  statement_id: string
  section: string
  previous_value: any
  reverted_at: string | null
  created_at: string
}

type SectionId = 'income' | 'expenses' | 'assets' | 'properties' | 'liabilities'

const SECTION_LIST: { id: SectionId; label: string }[] = [
  { id: 'income',      label: 'Income' },
  { id: 'expenses',    label: 'Expenses' },
  { id: 'assets',      label: 'Assets' },
  { id: 'properties',  label: 'Properties' },
  { id: 'liabilities', label: 'Liabilities' },
]

const round0 = (n: number) => Math.round(n || 0)
const perMonth = (annual: number) => round0((annual || 0) / 12)

function normalizeData(raw: any): StatementData {
  const base = emptyStatementData()
  if (!raw || typeof raw !== 'object') return base
  return { ...base, ...raw, income: { ...base.income, ...(raw.income || {}) } }
}

// ---------- Apply patch builders ----------
// fields = top-level fact_finding keys to write (already person-suffixed where relevant)
// personFields = keys to write nested under ff.person1 / ff.person2 (Income only)

interface ApplyPatch { fields: Record<string, any>; personKey: 'person1' | 'person2' | null; personFields: Record<string, any> }

// live = the plan as it is now; baseline = what a pre-filled form started with (null for a first statement).
// Custom rows and Properties are MERGED into live, never replaced, so details the form has no boxes for survive.
function buildApplyPatch(section: SectionId, st: StatementData, person: Person, live: any, baseline: StatementData | null): ApplyPatch {
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

// Captures the pre-Apply value of every key the patch is about to touch.
// null = "key did not exist before" so Revert can delete it again.
function extractPrevious(existing: any, patch: ApplyPatch) {
  const prevFields: Record<string, any> = {}
  const prevPerson: Record<string, any> = {}
  const ex = existing || {}
  const exPerson = (patch.personKey && ex[patch.personKey]) || {}
  for (const k of Object.keys(patch.fields)) prevFields[k] = ex[k] === undefined ? null : ex[k]
  for (const k of Object.keys(patch.personFields)) prevPerson[k] = exPerson[k] === undefined ? null : exPerson[k]
  return { fields: prevFields, personKey: patch.personKey, person: prevPerson }
}

// ---------- Component ----------

export default function SnapshotsTab({ clientId, clientName, spouseName, isCouple, userId, onDataChanged, onVersionSaved }: {
  clientId: string
  clientName: string
  spouseName?: string
  isCouple?: boolean
  userId?: string
  onDataChanged: () => void | Promise<void>
  onVersionSaved?: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const confirmAction = useConfirm()

  const [rows, setRows] = useState<StatementRow[]>([])
  const [logs, setLogs] = useState<ApplyLogRow[]>([])
  const [versions, setVersions] = useState<{ id: string; as_at: string; created_at: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string>('') // '<action>:<id>:<section>'
  const [notice, setNotice] = useState('')

  // Generate-link form
  const [genYear, setGenYear] = useState(new Date().getFullYear())
  const [genPerson, setGenPerson] = useState<Person>('client')
  const [genPassword, setGenPassword] = useState('')
  const [genHint, setGenHint] = useState('For security purposes, this document is password-protected. Use the last 4 characters of your NRIC followed by your year of birth (e.g., 567A1980) to access it.')
  const [genExpiry, setGenExpiry] = useState<'7d' | '30d' | 'never'>('30d')
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState('')
  const [copied, setCopied] = useState('')
  const [copyBusy, setCopyBusy] = useState(false)

  const personLabel = (p: Person) => p === 'client' ? clientName : (spouseName || 'Spouse')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: stmts }, { data: logRows }, { data: verRows }] = await Promise.all([
      supabase.from('financial_statements').select('*').eq('client_id', clientId).order('year', { ascending: false }),
      supabase.from('financial_statement_apply_log').select('id,statement_id,section,previous_value,reverted_at,created_at')
        .eq('client_id', clientId).order('created_at', { ascending: false }),
      supabase.from('fact_finding_versions').select('id,as_at,created_at')
        .eq('client_id', clientId).eq('section', 'financials').order('as_at', { ascending: false }),
    ])
    setRows((stmts as StatementRow[]) || [])
    setLogs((logRows as ApplyLogRow[]) || [])
    setVersions((verRows as { id: string; as_at: string; created_at: string }[]) || [])
    setLoading(false)
  }, [clientId, supabase])

  useEffect(() => { load() }, [load])
  // If the client stops being Couple mode, don't leave the form stuck on Spouse.
  useEffect(() => { if (!isCouple && genPerson === 'spouse') setGenPerson('client') }, [isCouple, genPerson])

  function flash(msg: string) {
    setNotice(msg)
    setTimeout(() => setNotice(''), 3500)
  }

  // Returns the live plan as a statement, or null when this should be a normal first statement.
  async function loadPrefill(person: Person): Promise<StatementData | null> {
    const [{ data: vers }, { data: ffRow }] = await Promise.all([
      supabase.from('fact_finding_versions').select('id').eq('client_id', clientId).eq('section', 'financials').limit(1),
      supabase.from('fact_finding').select('data').eq('client_id', clientId).eq('section', 'financials').maybeSingle(),
    ])
    if (!vers || vers.length === 0) return null
    const pre = buildPrefill(ffRow?.data, person)
    return isPrefillEmpty(pre) ? null : pre
  }

  // Keeps today's live plan as a dated, locked record (same as Annual Reviews > Save annual review).
  async function saveCopy() {
    const asAt = currentMonthStartSG()
    const monthName = new Date(asAt + 'T00:00:00').toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })
    setCopyBusy(true)
    try {
      const [{ data: vers, error: vErr }, { data: ffRow, error: fErr }] = await Promise.all([
        supabase.from('fact_finding_versions').select('as_at').eq('client_id', clientId).eq('section', 'financials').order('as_at', { ascending: false }),
        supabase.from('fact_finding').select('data').eq('client_id', clientId).eq('section', 'financials').maybeSingle(),
      ])
      if (vErr || fErr || !ffRow?.data) { flash('Could not read the plan. Nothing was saved.'); return }
      const list = (vers || []) as { as_at: string }[]
      if (list.some(v => v.as_at === asAt)) { flash(`A ${monthName} record already exists. Open Annual Reviews to replace it.`); return }
      if (list.length > 0 && asAt < list[0].as_at) { flash('A newer record already exists. Use Annual Reviews instead.'); return }
      if (!await confirmAction(
        `Keep a copy of today's plan as the ${monthName} record? It is locked, so the figures cannot be changed later.`,
        { title: 'Save a copy?', confirmLabel: 'Save copy' },
      )) return
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { client_id: _omit, ...planData } = ffRow.data as Record<string, unknown>
      const { error } = await supabase.from('fact_finding_versions').insert({
        client_id: clientId, section: 'financials', as_at: asAt,
        kind: list.length === 0 ? 'initial' : 'review',
        data: JSON.parse(JSON.stringify(planData)), created_by: userId || null,
      })
      if (error) { flash(error.code === '23505' ? `A ${monthName} record already exists.` : 'Could not save the copy. Nothing was changed.'); return }
      flash(`${monthName} record saved. See it in Annual Reviews.`)
      onVersionSaved?.()
    } finally {
      setCopyBusy(false)
    }
  }

  async function generateLink() {
    if (!genPassword.trim()) { setGenError('Set a password for the link.'); return }
    setGenBusy(true); setGenError('')
    try {
      const hashRes = await fetch('/api/hash-share-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: genPassword.trim() }),
      })
      if (!hashRes.ok) throw new Error('Password hashing failed')
      const { hash } = await hashRes.json()

      let expiresAt: string | null = null
      if (genExpiry === '7d') expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
      if (genExpiry === '30d') expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()

      const existing = rows.find(r => r.year === genYear && r.person === genPerson)
      const existingEmpty = !!existing && existing.status === 'draft' && (!existing.data || Object.keys(existing.data).length === 0)
      // Pre-fill only when this is a new (or still-empty draft) link AND the client already
      // has saved records AND the live plan has figures for this person.
      let prefill: StatementData | null = null
      if (!existing || existingEmpty) prefill = await loadPrefill(genPerson)

      if (existing) {
        const { error } = await supabase.from('financial_statements')
          .update({
            password_hash: hash, password_hint: genHint || null, expires_at: expiresAt, updated_at: new Date().toISOString(),
            ...(prefill && existingEmpty ? { data: prefill, baseline: prefill, kind: 'review' } : {}),
          })
          .eq('id', existing.id)
        if (error) throw error
        flash(`Link for ${personLabel(genPerson)} (${genYear}) updated — same URL, new password/expiry.${prefill && existingEmpty ? ' Current figures filled in.' : ''}`)
      } else {
        const token = crypto.randomUUID().replace(/-/g, '')
        const { error } = await supabase.from('financial_statements').insert({
          client_id: clientId, year: genYear, person: genPerson, token,
          password_hash: hash, password_hint: genHint || null, expires_at: expiresAt,
          status: 'draft', data: prefill || {},
          ...(prefill ? { baseline: prefill, kind: 'review' } : {}),
        })
        if (error) throw error
        flash(prefill
          ? `Link for ${personLabel(genPerson)} (${genYear}) created with their current figures filled in.`
          : `Link for ${personLabel(genPerson)} (${genYear}) created.`)
      }
      setGenPassword('')
      await load()
    } catch (e) {
      console.error('Generate statement link failed:', e)
      setGenError('Failed to create the link. Please try again.')
    } finally {
      setGenBusy(false)
    }
  }

  function statementUrl(token: string) {
    return `${typeof window !== 'undefined' ? window.location.origin : ''}/statement/${token}`
  }

  async function copyLink(row: StatementRow) {
    try {
      await navigator.clipboard.writeText(statementUrl(row.token))
      setCopied(row.id)
      setTimeout(() => setCopied(''), 2000)
    } catch { /* clipboard unavailable */ }
  }

  function whatsappShare(row: StatementRow) {
    const text = `Your ${row.year} Financial Statement — ${personLabel(row.person)}\n\n${statementUrl(row.token)}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  async function expireNow(row: StatementRow) {
    if (!await confirmAction(`Expire ${personLabel(row.person)}'s ${row.year} link now? They will no longer be able to open it (their entered data is kept).`, { danger: true, confirmLabel: 'Expire' })) return
    setBusy(`expire:${row.id}`)
    const { error } = await supabase.from('financial_statements')
      .update({ expires_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', row.id)
    setBusy('')
    if (error) { console.error(error); flash('Failed to expire the link.') } else { flash('Link expired.'); await load() }
  }

  // Advisor-only: unlock a submitted statement so the client can edit and submit again.
  // Keeps everything they entered. Sections already applied keep the OLD figures until re-applied.
  async function reopenStatement(row: StatementRow) {
    const expired = row.expires_at ? new Date(row.expires_at) < new Date() : false
    const anyApplied = SECTION_LIST.some(s => latestLog(row.id, s.id))
    if (!await confirmAction(
      `Reopen ${personLabel(row.person)}'s ${row.year} statement? They can edit and submit it again on the same link. What they entered is kept.`
      + (anyApplied ? ' Sections you already applied keep the old figures. Apply them again after they resubmit.' : '')
      + (expired ? ' This link has expired, so use Update Link to give it a new expiry, or they cannot open it.' : ''),
      { title: 'Reopen for changes?', confirmLabel: 'Reopen' },
    )) return
    setBusy(`reopen:${row.id}`)
    const { data, error } = await supabase.from('financial_statements')
      .update({ status: 'draft', submitted_at: null, acknowledged_at: null, updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', 'submitted').select('id')
    setBusy('')
    if (error || !data || data.length === 0) { console.error(error); flash('Could not reopen. Nothing was changed.'); return }
    flash(`${personLabel(row.person)}'s ${row.year} statement reopened. Send them the same link.`)
    await load()
  }

  // Removes the statement row. Its Apply history goes with it (database cascade), so Revert is lost.
  // Plan and saved records are never touched. A submitted statement needs DELETE typed.
  async function deleteStatement(row: StatementRow) {
    const submitted = row.status === 'submitted'
    const applied = SECTION_LIST.filter(s => latestLog(row.id, s.id)).map(s => s.label)
    if (!await confirmAction(
      `Delete ${personLabel(row.person)}'s ${row.year} statement? The link stops working and what was entered is removed for good. The plan and saved records are not changed.`
      + (applied.length ? ` You already applied ${applied.join(', ')} from it. Those figures stay in the plan, but you can no longer revert them.` : '')
      + (submitted ? ' The client submitted this one, so type DELETE to confirm.' : ''),
      { title: 'Delete statement?', confirmLabel: 'Delete', danger: true, ...(submitted ? { requireText: 'DELETE' } : {}) },
    )) return
    setBusy(`delete:${row.id}`)
    // Matching the status I showed means a draft the client has just submitted is not deleted by surprise.
    const { data, error } = await supabase.from('financial_statements').delete().eq('id', row.id).eq('status', row.status).select('id')
    setBusy('')
    if (error || !data || data.length === 0) { console.error(error); flash('Could not delete. Nothing was changed. If the client just submitted, refresh and try again.'); await load(); return }
    if (openId === row.id) setOpenId(null)
    flash(`${personLabel(row.person)}'s ${row.year} statement deleted.`)
    await load()
  }

  const monthNow = currentMonthStartSG()
  const monthLabel = (asAt: string) => new Date(asAt + 'T00:00:00').toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })
  const latestVer = versions[0]
  // The saved record is out of date when the plan was changed (Apply or Revert) after it was saved.
  const lastPlanChange = logs.reduce((m, l) => Math.max(m, +new Date(l.created_at), l.reverted_at ? +new Date(l.reverted_at) : 0), 0)
  const needsRecord = lastPlanChange > 0 && (!latestVer || +new Date(latestVer.created_at) < lastPlanChange)
  const canSaveNew = !latestVer || latestVer.as_at < monthNow

  async function replaceLatest() {
    if (!latestVer) return
    const name = monthLabel(latestVer.as_at)
    if (!await confirmAction(
      `Replace the saved figures of the ${name} record with the plan as it is now? The old figures of that record are overwritten. Its date and note are kept.`
      + (latestVer.as_at < monthNow ? ` That record is from an earlier month, so only do this to correct ${name}. To keep ${name} as it was, save a new ${monthLabel(monthNow)} record instead.` : ''),
      { title: 'Replace the record?', confirmLabel: 'Replace figures', danger: true },
    )) return
    setCopyBusy(true)
    try {
      const res = await replaceVersionWithPlan(supabase, clientId, latestVer.id, userId)
      if (!res.ok) { flash(res.message); return }
      flash(`${name} record updated with the current plan.`)
      onVersionSaved?.()
      await load()
    } finally {
      setCopyBusy(false)
    }
  }

  function latestLog(statementId: string, section: SectionId): ApplyLogRow | undefined {
    return logs.find(l => l.statement_id === statementId && l.section === section && !l.reverted_at)
  }

  async function applySection(row: StatementRow, section: SectionId) {
    const st = normalizeData(row.data)
    const baseline: StatementData | null = row.kind === 'review' && row.baseline ? normalizeData(row.baseline) : null
    const label = SECTION_LIST.find(s => s.id === section)?.label || section
    const who = personLabel(row.person)
    const extra = section === 'properties'
      ? (baseline
        ? ' Properties not changed on the form keep all their details. Ones removed on the form are removed here.'
        : ` Note: this REPLACES the Properties list on the Financials tab with what ${who} entered. If the other spouse also filled in Properties, make sure you're Applying the right one.`)
      : section === 'income'
        ? ' Other income figures are converted to monthly (÷12) to match the Financials tab.'
        : ''
    const thisYear = new Date().getFullYear()
    const wrongYear = row.year !== thisYear
    const wrongYearNote = wrongYear
      ? `This statement is for ${row.year}, not ${thisYear}. Applying it replaces today's live plan with ${row.year} figures. To keep an older year as a record, use Annual Reviews, then Add past record. `
      : ''
    if (!await confirmAction(
      `${wrongYearNote}Apply ${who}'s ${row.year} ${label} into this client's Financials data? The current values are logged so you can revert this once.${extra}`,
      wrongYear
        ? { title: 'Check the year', confirmLabel: 'Apply anyway', danger: true }
        : { confirmLabel: 'Apply' },
    )) return

    setBusy(`apply:${row.id}:${section}`)
    try {
      const { data: ffRow } = await supabase.from('fact_finding')
        .select('data').eq('client_id', clientId).eq('section', 'financials').maybeSingle()
      const patch = buildApplyPatch(section, st, row.person, ffRow?.data, baseline)
      const previous = extractPrevious(ffRow?.data, patch)

      const { error: logError } = await supabase.from('financial_statement_apply_log').insert({
        statement_id: row.id, client_id: clientId, section,
        previous_value: previous, applied_value: patch,
        applied_by: userId || null,
      })
      if (logError) throw logError

      await saveFactFindingSection(supabase, clientId, 'financials', (existing: any) => {
        // Rebuilt from the freshest copy so a save that landed in between is merged, not overwritten.
        const p = buildApplyPatch(section, st, row.person, existing, baseline)
        const next = { ...(existing || {}) }
        for (const k of Object.keys(p.fields)) next[k] = p.fields[k]
        if (p.personKey && Object.keys(p.personFields).length > 0) {
          next[p.personKey] = { ...(next[p.personKey] || {}) }
          for (const k of Object.keys(p.personFields)) next[p.personKey][k] = p.personFields[k]
        }
        return next
      })

      flash(`${label} applied for ${who}. When you finish applying, update the saved record (see the gold box near the top).`)
      await load()
      await onDataChanged()
    } catch (e) {
      console.error('Apply failed:', e)
      flash('Apply failed — nothing was changed. Please try again.')
    } finally {
      setBusy('')
    }
  }

  async function revertSection(row: StatementRow, section: SectionId) {
    const log = latestLog(row.id, section)
    if (!log) return
    const label = SECTION_LIST.find(s => s.id === section)?.label || section
    if (!await confirmAction(`Revert ${label} to the values from before the last Apply (${new Date(log.created_at).toLocaleString('en-SG')})?`, { confirmLabel: 'Revert' })) return

    setBusy(`revert:${row.id}:${section}`)
    try {
      const prev = log.previous_value || { fields: {}, personKey: null, person: {} }
      await saveFactFindingSection(supabase, clientId, 'financials', (existing: any) => {
        const next = { ...(existing || {}) }
        const pf = prev.fields || {}
        for (const k of Object.keys(pf)) {
          if (pf[k] === null) delete next[k]
          else next[k] = pf[k]
        }
        const pKey = prev.personKey as 'person1' | 'person2' | null
        const pp = prev.person || {}
        if (pKey && Object.keys(pp).length > 0) {
          next[pKey] = { ...(next[pKey] || {}) }
          for (const k of Object.keys(pp)) {
            if (pp[k] === null) delete next[pKey][k]
            else next[pKey][k] = pp[k]
          }
        }
        return next
      })

      const { error } = await supabase.from('financial_statement_apply_log')
        .update({ reverted_at: new Date().toISOString() }).eq('id', log.id)
      if (error) throw error

      flash(`${label} reverted to pre-Apply values.`)
      await load()
      await onDataChanged()
    } catch (e) {
      console.error('Revert failed:', e)
      flash('Revert failed. Please try again.')
    } finally {
      setBusy('')
    }
  }

  // ---------- Render helpers ----------

  const card: React.CSSProperties = { background: 'white', border: '1px solid var(--line)', padding: '20px 24px', marginBottom: 20 }
  const btnSm: React.CSSProperties = { fontSize: 11, fontWeight: 600, padding: '6px 12px', border: '1px solid var(--line)', background: 'white', color: 'var(--ink)', cursor: 'pointer' }
  const btnGold: React.CSSProperties = { ...btnSm, background: 'var(--gold)', borderColor: 'var(--gold)', color: 'white' }
  const btnGreen: React.CSSProperties = { ...btnSm, background: '#2A5E46', borderColor: '#2A5E46', color: 'white' }

  function sectionTotal(st: StatementData, id: SectionId): string {
    if (id === 'income') return fmtStmtMoney(stmtIncomeTotal(st)) + ' /yr'
    if (id === 'expenses') return fmtStmtMoney(stmtExpenseTotal(st)) + ' /yr'
    if (id === 'assets') return fmtStmtMoney(stmtAssetsTotal(st))
    if (id === 'liabilities') return fmtStmtMoney(stmtLiabTotal(st))
    return fmtStmtMoney(stmtPropertyEquity(st)) + ' equity'
  }

  // One line per figure in a section, with a stable key so a pre-filled statement can be compared to what it started with.
  type DetailItem = { key: string; label: string; value: string }
  function collectItems(st: StatementData, id: SectionId): DetailItem[] {
    const items: DetailItem[] = []
    const ck = (cat: string, label: string) => `${cat}|${(label || '').trim().toLowerCase()}`
    if (id === 'income') {
      if (st.income.gross_monthly) items.push({ key: 'gm', label: 'Gross Monthly Salary', value: fmtStmtMoney(st.income.gross_monthly) + ' /mo' })
      if (st.income.gross_bonus) items.push({ key: 'gb', label: 'Gross Annual Bonus', value: fmtStmtMoney(st.income.gross_bonus) + ' /yr' })
      for (const i of st.income.others || []) if (i.label || i.amount) items.push({ key: 'o|' + (i.label || '').trim().toLowerCase(), label: i.label || '(unnamed)', value: fmtStmtMoney(i.amount) + ' /yr' })
    }
    if (id === 'expenses') {
      if (st.expense_mode === 'simple') {
        for (const f of EXP_SIMPLE_FIELDS) if (st.exp_simple[f.key]) items.push({ key: f.key, label: f.label, value: fmtStmtMoney(st.exp_simple[f.key]) + ' /yr' })
        for (const i of st.exp_simple_custom || []) if (i.label || i.amount) items.push({ key: 'sc|' + (i.label || '').trim().toLowerCase(), label: i.label || '(unnamed)', value: fmtStmtMoney(i.amount) + ' /yr' })
      } else {
        for (const b of EXP_DETAILED_BLOCKS) {
          for (const f of b.fields) if (st.exp_detailed[f.key]) items.push({ key: f.key, label: `${b.title} · ${f.label}`, value: fmtStmtMoney(st.exp_detailed[f.key]) + ' /yr' })
          for (const i of st.exp_detailed_custom || []) if (i.cat === b.id && (i.label || i.amount)) items.push({ key: 'dc|' + ck(i.cat, i.label), label: `${b.title} · ${i.label || '(unnamed)'}`, value: fmtStmtMoney(i.amount) + ' /yr' })
        }
      }
    }
    if (id === 'assets') {
      for (const b of ASSET_BLOCKS) {
        for (const f of b.fields) if (st.assets[f.key]) items.push({ key: f.key, label: f.label, value: fmtStmtMoney(st.assets[f.key]) })
        for (const i of st.assets_custom || []) if (i.cat === b.id && (i.label || i.amount)) items.push({ key: 'ac|' + ck(i.cat, i.label), label: `${b.title} · ${i.label || '(unnamed)'}`, value: fmtStmtMoney(i.amount) })
      }
    }
    if (id === 'liabilities') {
      for (const b of LIAB_BLOCKS) {
        for (const f of b.fields) if (st.liabilities[f.key]) items.push({ key: f.key, label: `${b.title} · ${f.label}`, value: fmtStmtMoney(st.liabilities[f.key]) })
        for (const i of st.liabilities_custom || []) if (i.cat === b.id && (i.label || i.amount)) items.push({ key: 'lc|' + ck(i.cat, i.label), label: `${b.title} · ${i.label || '(unnamed)'}`, value: fmtStmtMoney(i.amount) })
      }
    }
    if (id === 'properties') {
      for (const p of st.properties || []) {
        const mv = p.propertyValue || p.purchasePrice || 0
        items.push({
          key: 'p|' + p.id,
          label: `${p.label || '(unnamed property)'} · ${p.propertyType}${p.isPrimaryResidence ? ' · Primary' : ''}`,
          value: `${fmtStmtMoney(mv)} MV · ${fmtStmtMoney(p.outstanding || 0)} loan`,
        })
      }
    }
    return items
  }

  // What the client changed versus the pre-filled figures. Empty for a first statement.
  function diffItems(st: StatementData, base: StatementData | null, id: SectionId) {
    const cur = collectItems(st, id)
    if (!base) return { cur, changed: new Map<string, string>(), removed: [] as DetailItem[] }
    const old = collectItems(base, id)
    const oldByKey = new Map(old.map(o => [o.key, o]))
    const changed = new Map<string, string>() // key -> "NEW" or the old value
    for (const c of cur) {
      const o = oldByKey.get(c.key)
      if (!o) changed.set(c.key, 'NEW')
      else if (o.value !== c.value) changed.set(c.key, o.value)
    }
    const curKeys = new Set(cur.map(c => c.key))
    return { cur, changed, removed: old.filter(o => !curKeys.has(o.key)) }
  }

  function renderSectionDetail(st: StatementData, id: SectionId, base: StatementData | null) {
    const { cur, changed, removed } = diffItems(st, base, id)
    const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 6px', borderBottom: '1px solid var(--line)', fontSize: 11.5 }
    const mono: React.CSSProperties = { fontFamily: 'DM Mono,monospace', color: 'var(--ink)', textAlign: 'right' }

    if (cur.length === 0 && removed.length === 0) return <div style={{ fontSize: 11, color: 'var(--ink3)', padding: '6px 0' }}>Nothing entered for this section.</div>
    return (
      <div>
        {cur.map(it => {
          const was = changed.get(it.key)
          return (
            <div key={it.key} style={was ? { ...rowStyle, background: '#FBF3E3', borderLeft: '3px solid var(--gold)', fontWeight: 600 } : rowStyle}>
              <span style={{ color: 'var(--ink2)' }}>
                {it.label}
                {was && <span style={{ marginLeft: 8, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 6px', background: 'var(--gold)', color: 'white' }}>{was === 'NEW' ? 'NEW' : 'CHANGED'}</span>}
              </span>
              <span style={mono}>
                {it.value}
                {was && was !== 'NEW' && <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--ink3)' }}>was {was}</div>}
              </span>
            </div>
          )
        })}
        {removed.map(it => (
          <div key={'rm' + it.key} style={{ ...rowStyle, background: '#FBEBEB', borderLeft: '3px solid #B04A4A' }}>
            <span style={{ color: '#B04A4A', textDecoration: 'line-through' }}>{it.label}</span>
            <span style={{ ...mono, color: '#B04A4A' }}>removed <span style={{ fontSize: 10 }}>(was {it.value})</span></span>
          </div>
        ))}
      </div>
    )
  }

  function renderStatementCard(row: StatementRow) {
    const st = normalizeData(row.data)
    const baseline: StatementData | null = row.kind === 'review' && row.baseline ? normalizeData(row.baseline) : null
    const expired = row.expires_at ? new Date(row.expires_at) < new Date() : false
    const open = openId === row.id
    const who = personLabel(row.person)
    return (
      <div key={row.id} style={{ ...card, borderLeft: `3px solid ${row.person === 'client' ? 'var(--gold)' : '#4A7C9E'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '3px 8px', background: row.person === 'client' ? 'var(--gold-l)' : '#EAF0F5',
              color: row.person === 'client' ? 'var(--gold-tag)' : '#4A7C9E',
            }}>
              {who}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '3px 8px',
              background: row.status === 'submitted' ? '#E8F2ED' : '#F5EFE3',
              color: row.status === 'submitted' ? '#2A5E46' : '#8A6C3A',
            }}>
              {row.status === 'submitted' ? '✓ Submitted' : 'Draft'}
            </span>
            {row.kind === 'review' && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 8px', background: '#ECEAE4', color: '#4A4740' }}>Pre-filled</span>}
            {expired && <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '3px 8px', background: '#FBEBEB', color: '#B04A4A' }}>Link expired</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={btnSm} onClick={() => copyLink(row)}>{copied === row.id ? '✓ Copied' : 'Copy Link'}</button>
            <button style={btnSm} onClick={() => whatsappShare(row)}>WhatsApp</button>
            {row.status === 'submitted' && <button style={btnSm} disabled={busy === `reopen:${row.id}`} onClick={() => reopenStatement(row)}>{busy === `reopen:${row.id}` ? 'Reopening…' : 'Reopen for changes'}</button>}
            {!expired && <button style={btnSm} disabled={busy === `expire:${row.id}`} onClick={() => expireNow(row)}>Expire Now</button>}
            <button style={btnSm} onClick={() => setOpenId(open ? null : row.id)}>{open ? 'Hide Details' : 'View Details'}</button>
            <button style={{ ...btnSm, color: '#B04A4A', borderColor: '#E3CACA' }} disabled={busy === `delete:${row.id}`} onClick={() => deleteStatement(row)}>{busy === `delete:${row.id}` ? 'Deleting…' : 'Delete'}</button>
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 6 }}>
          {row.status === 'submitted' && row.submitted_at
            ? `Submitted ${new Date(row.submitted_at).toLocaleString('en-SG')}`
            : `Last updated ${new Date(row.updated_at).toLocaleString('en-SG')}`}
          {row.expires_at && !expired && ` · link expires ${new Date(row.expires_at).toLocaleDateString('en-SG')}`}
          {row.client_name && ` · entered by "${row.client_name}"${row.client_occupation ? `, ${row.client_occupation}` : ''}`}
        </div>

        {open && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            {row.status !== 'submitted' && (
              <div style={{ background: '#FBF3E3', border: '1px solid #EDD9AE', color: '#6E5619', fontSize: 11.5, padding: '9px 12px', marginBottom: 14, lineHeight: 1.5 }}>
                Still a <b>draft</b> — {who} hasn&apos;t submitted yet. You can still Apply sections, but figures may be incomplete.
              </div>
            )}
            {baseline && (
              <div style={{ background: '#F5EFE3', border: '1px solid #E4DBC8', color: '#5E4A24', fontSize: 11.5, padding: '9px 12px', marginBottom: 14, lineHeight: 1.5 }}>
                Pre-filled review. <b>Gold rows</b> are what {who} changed or added. <b style={{ color: '#B04A4A' }}>Red rows</b> were removed. Everything else is unchanged from the plan when the link was made.
              </div>
            )}
            {SECTION_LIST.map(sec => {
              const applied = latestLog(row.id, sec.id)
              const applying = busy === `apply:${row.id}:${sec.id}`
              const reverting = busy === `revert:${row.id}:${sec.id}`
              return (
                <div key={sec.id} style={{ marginBottom: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink2)' }}>{sec.label}</span>
                      <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 11, color: 'var(--ink3)' }}>{sectionTotal(st, sec.id)}</span>
                      {baseline && (() => {
                        const d = diffItems(st, baseline, sec.id)
                        const n = d.changed.size + d.removed.length
                        return n > 0
                          ? <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 8px', background: 'var(--gold)', color: 'white' }}>{n} CHANGED</span>
                          : <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink3)' }}>no changes</span>
                      })()}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {applied && (
                        <button style={btnSm} disabled={reverting} onClick={() => revertSection(row, sec.id)}>
                          {reverting ? 'Reverting…' : '↶ Revert Last Apply'}
                        </button>
                      )}
                      <button style={btnGreen} disabled={applying} onClick={() => applySection(row, sec.id)}>
                        {applying ? 'Applying…' : `Apply ${who}'s ${sec.label}`}
                      </button>
                    </div>
                  </div>
                  {applied && (
                    row.submitted_at && +new Date(applied.created_at) < +new Date(row.submitted_at) ? (
                      <div style={{ fontSize: 10.5, color: '#8A6C3A', fontWeight: 600, marginBottom: 6 }}>
                        Applied {new Date(applied.created_at).toLocaleString('en-SG')}, before the latest submission. Apply again to use the new figures.
                      </div>
                    ) : (
                      <div style={{ fontSize: 10.5, color: '#2A5E46', marginBottom: 6 }}>
                        Applied {new Date(applied.created_at).toLocaleString('en-SG')} — one-step revert available.
                      </div>
                    )
                  )}
                  {renderSectionDetail(st, sec.id, baseline)}
                </div>
              )
            })}
            <div style={{ fontSize: 10.5, color: 'var(--ink3)', lineHeight: 1.6, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              Apply notes: other income figures convert annual → monthly (÷12); Gross Monthly and Bonus don&apos;t. Expenses apply as annual figures, unchanged, matching the Financials tab. On a first statement, Applying Properties replaces the whole Properties list — if both {clientName} and {spouseName || 'the spouse'} entered properties, only Apply the one you want to keep. On a pre-filled review, properties and custom rows are merged, so other details are kept. Custom items in Simplified expense mode fold into Lifestyle &amp; Miscellaneous.
            </div>
          </div>
        )}
      </div>
    )
  }

  // Group rows by year for display
  const years = Array.from(new Set(rows.map(r => r.year))).sort((a, b) => b - a)

  return (
    <div>
      {notice && (
        <div style={{ background: '#E8F2ED', border: '1px solid #C9E0D6', color: '#1E4536', fontSize: 12, padding: '10px 14px', marginBottom: 16 }}>{notice}</div>
      )}

      {/* ---------- Generate / update link ---------- */}
      <div style={card}>
        <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--ink3)' }}>Client Statement Link</div>
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 14, lineHeight: 1.5 }}>
          {isCouple
            ? `Each of ${clientName} and ${spouseName || 'the spouse'} fills in their own statement individually — no need to coordinate a joint session. Entries stay here until you explicitly Apply a section; nothing touches the live Financials data on its own.`
            : `Generates a password-protected link where ${clientName} fills in their own income, expenses, assets, properties and liabilities for a chosen year.`}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Year</div>
            <input type="number" value={genYear} onChange={e => setGenYear(parseInt(e.target.value) || new Date().getFullYear())}
              className="text-sm px-2 py-1.5 outline-none" style={{ border: '1px solid var(--line)', width: 90, background: 'var(--cream)', color: 'var(--ink)' }} />
          </div>
          {isCouple && (
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>For</div>
              <div style={{ display: 'flex', gap: 4, background: 'var(--cream)', border: '1px solid var(--line)', padding: 3 }}>
                <button type="button" onClick={() => setGenPerson('client')}
                  style={{ fontSize: 11.5, fontWeight: 600, padding: '6px 12px', border: 'none', cursor: 'pointer', background: genPerson === 'client' ? 'var(--gold)' : 'transparent', color: genPerson === 'client' ? 'white' : 'var(--ink3)' }}>
                  {clientName}
                </button>
                <button type="button" onClick={() => setGenPerson('spouse')}
                  style={{ fontSize: 11.5, fontWeight: 600, padding: '6px 12px', border: 'none', cursor: 'pointer', background: genPerson === 'spouse' ? '#4A7C9E' : 'transparent', color: genPerson === 'spouse' ? 'white' : 'var(--ink3)' }}>
                  {spouseName || 'Spouse'}
                </button>
              </div>
            </div>
          )}
          <div>
            <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Password</div>
            <input type="text" value={genPassword} onChange={e => setGenPassword(e.target.value)} placeholder="Link password"
              className="text-sm px-2 py-1.5 outline-none" style={{ border: '1px solid var(--line)', width: 160, background: 'var(--cream)', color: 'var(--ink)' }} />
          </div>
          <div>
            <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Hint (optional)</div>
            <input type="text" value={genHint} onChange={e => setGenHint(e.target.value)} placeholder="Shown on unlock screen"
              className="text-sm px-2 py-1.5 outline-none" style={{ border: '1px solid var(--line)', width: 180, background: 'var(--cream)', color: 'var(--ink)' }} />
          </div>
          <div>
            <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Expiry</div>
            <select value={genExpiry} onChange={e => setGenExpiry(e.target.value as any)}
              className="text-sm px-2 py-1.5 outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="never">No expiry</option>
            </select>
          </div>
          <button style={btnGold} disabled={genBusy} onClick={generateLink}>
            {genBusy ? 'Working…' : rows.some(r => r.year === genYear && r.person === genPerson) ? `Update ${personLabel(genPerson)}'s ${genYear} Link` : `Create ${personLabel(genPerson)}'s ${genYear} Link`}
          </button>
        </div>
        {rows.some(r => r.year === genYear && r.person === genPerson) && (
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 8 }}>
            A {genYear} statement for {personLabel(genPerson)} already exists — this updates its password/expiry on the same URL. Their entered data is kept.
          </div>
        )}
        {genError && <div style={{ fontSize: 12, color: '#B04A4A', marginTop: 8 }}>{genError}</div>}
      </div>

      {rows.length > 0 && (needsRecord ? (
        <div style={{ ...card, background: '#FBF3E3', borderColor: '#EDD9AE', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12.5, color: '#6E5619', lineHeight: 1.55, maxWidth: 520 }}>
            <b>The plan has changed since the last saved record.</b> The Growth chart only shows saved records, so update one once you finish applying.
            {latestVer && ` Latest record: ${monthLabel(latestVer.as_at)}.`}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {latestVer && <button style={btnSm} disabled={copyBusy} onClick={replaceLatest}>{copyBusy ? 'Working…' : `Update ${monthLabel(latestVer.as_at)} record`}</button>}
            {canSaveNew && <button style={btnGreen} disabled={copyBusy} onClick={saveCopy}>{copyBusy ? 'Working…' : `Save as new ${monthLabel(monthNow)} record`}</button>}
          </div>
        </div>
      ) : (
        <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.5, maxWidth: 520 }}>
            Done applying? Keep a dated copy of today&apos;s plan, so next year&apos;s review has something to compare with.
          </div>
          <button style={btnGreen} disabled={copyBusy} onClick={saveCopy}>{copyBusy ? 'Saving…' : 'Save a copy of the plan'}</button>
        </div>
      ))}

      {/* ---------- Statement list, grouped by year ---------- */}
      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--ink3)', padding: '20px 0' }}>Loading snapshots…</div>
      ) : rows.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: 'var(--ink3)', fontSize: 12 }}>
          No statements yet. Create a link above and share it with {clientName}{isCouple ? ` and ${spouseName || 'the spouse'}` : ''}.
        </div>
      ) : years.map(year => (
        <div key={year} style={{ marginBottom: 8 }}>
          <div className="font-serif" style={{ fontSize: 22, color: 'var(--ink)', margin: '4px 0 10px' }}>{year}</div>
          {rows.filter(r => r.year === year).sort((a, b) => a.person === 'client' ? -1 : 1).map(renderStatementCard)}
        </div>
      ))}
    </div>
  )
}