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
// UNITS: the statement stores ANNUAL figures for other income and expenses;
// fact_finding stores those MONTHLY — Apply divides by 12 (rounded).

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { saveFactFindingSection } from '@/lib/factFindingSave'
import {
  StatementData, emptyStatementData,
  EXP_SIMPLE_FIELDS, EXP_DETAILED_BLOCKS, EXP_CUSTOM_KEY,
  ASSET_BLOCKS, ASSET_CUSTOM_KEY, LIAB_BLOCKS, LIAB_CUSTOM_KEY,
  stmtIncomeTotal, stmtExpenseTotal, stmtAssetsTotal, stmtLiabTotal, stmtPropertyEquity,
  fmtStmtMoney,
} from '@/lib/statementFields'

type Person = 'client' | 'spouse'

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

// Suffix pattern used throughout the advisor Financials page: Client fields
// are unsuffixed (l_credit_card), Spouse fields carry a "2" (l2_credit_card).
function keyFor(baseKey: string, person: Person): string {
  if (person === 'client') return baseKey
  // s_x -> s2_x, d_x -> d2_x, a_x -> a2_x, l_x -> l2_x
  const m = baseKey.match(/^([a-z]+)_(.+)$/)
  return m ? `${m[1]}2_${m[2]}` : `${baseKey}2`
}

function normalizeData(raw: any): StatementData {
  const base = emptyStatementData()
  if (!raw || typeof raw !== 'object') return base
  return { ...base, ...raw, income: { ...base.income, ...(raw.income || {}) } }
}

// ---------- Apply patch builders ----------
// fields = top-level fact_finding keys to write (already person-suffixed where relevant)
// personFields = keys to write nested under ff.person1 / ff.person2 (Income only)

interface ApplyPatch { fields: Record<string, any>; personKey: 'person1' | 'person2' | null; personFields: Record<string, any> }

function buildApplyPatch(section: SectionId, st: StatementData, person: Person): ApplyPatch {
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
      for (const f of EXP_SIMPLE_FIELDS) fields[keyFor(f.key, person)] = perMonth(st.exp_simple[f.key] || 0)
      const customAnnual = (st.exp_simple_custom || []).reduce((s, i) => s + (i.amount || 0), 0)
      if (customAnnual > 0) {
        const lifestyleKey = keyFor('s_lifestyle', person)
        fields[lifestyleKey] = (fields[lifestyleKey] || 0) + perMonth(customAnnual)
      }
    } else {
      for (const block of EXP_DETAILED_BLOCKS) {
        for (const f of block.fields) fields[keyFor(f.key, person)] = perMonth(st.exp_detailed[f.key] || 0)
        // Custom rows only exist on the Client's key (d_custom_*) — fold
        // Spouse-entered custom items in there too rather than inventing a
        // parallel d2_custom_* key that the advisor page doesn't read.
        const customKey = EXP_CUSTOM_KEY[block.id]
        const items = (st.exp_detailed_custom || [])
          .filter(i => i.cat === block.id && (i.label || i.amount))
          .map(i => ({ label: person === 'spouse' ? `${i.label} (Spouse)` : i.label, amount: perMonth(i.amount) }))
        fields[customKey] = items
      }
    }
  }

  if (section === 'assets') {
    for (const block of ASSET_BLOCKS) {
      for (const f of block.fields) fields[keyFor(f.key, person)] = round0(st.assets[f.key] || 0)
      const customKey = ASSET_CUSTOM_KEY[block.id]
      fields[customKey] = (st.assets_custom || [])
        .filter(i => i.cat === block.id && (i.label || i.amount))
        .map(i => ({ label: person === 'spouse' ? `${i.label} (Spouse)` : i.label, amount: round0(i.amount) }))
    }
  }

  if (section === 'liabilities') {
    for (const block of LIAB_BLOCKS) {
      for (const f of block.fields) fields[keyFor(f.key, person)] = round0(st.liabilities[f.key] || 0)
      const customKey = LIAB_CUSTOM_KEY[block.id]
      fields[customKey] = (st.liabilities_custom || [])
        .filter(i => i.cat === block.id && (i.label || i.amount))
        .map(i => ({ label: person === 'spouse' ? `${i.label} (Spouse)` : i.label, amount: round0(i.amount) }))
    }
  }

  if (section === 'properties') {
    // Shared/joint — whichever statement is Applied replaces the whole list.
    fields.properties = (st.properties || []).map(p => ({
      id: p.id,
      label: p.label || '',
      propertyType: p.propertyType || 'HDB',
      isPrimaryResidence: !!p.isPrimaryResidence,
      ownershipType: p.ownershipType === 'Sole Ownership' ? 'Client Only' : (p.ownershipType || 'Client Only'),
      purchasePrice: p.purchasePrice || undefined,
      propertyValue: p.propertyValue || undefined,
      bank: p.bank || undefined,
      loanType: (p.loanType as any) || undefined,
      outstanding: p.outstanding || undefined,
      remainingTenure: p.remainingTenure || undefined,
      interestRate: p.interestRate || undefined,
      monthlyRepayment: p.monthlyRepayment || undefined,
    }))
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

export default function SnapshotsTab({ clientId, clientName, spouseName, isCouple, onDataChanged }: {
  clientId: string
  clientName: string
  spouseName?: string
  isCouple?: boolean
  onDataChanged: () => void | Promise<void>
}) {
  const supabase = useMemo(() => createClient(), [])

  const [rows, setRows] = useState<StatementRow[]>([])
  const [logs, setLogs] = useState<ApplyLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string>('') // '<action>:<id>:<section>'
  const [notice, setNotice] = useState('')

  // Generate-link form
  const [genYear, setGenYear] = useState(new Date().getFullYear())
  const [genPerson, setGenPerson] = useState<Person>('client')
  const [genPassword, setGenPassword] = useState('')
  const [genHint, setGenHint] = useState('')
  const [genExpiry, setGenExpiry] = useState<'7d' | '30d' | 'never'>('30d')
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState('')
  const [copied, setCopied] = useState('')

  const personLabel = (p: Person) => p === 'client' ? clientName : (spouseName || 'Spouse')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: stmts }, { data: logRows }] = await Promise.all([
      supabase.from('financial_statements').select('*').eq('client_id', clientId).order('year', { ascending: false }),
      supabase.from('financial_statement_apply_log').select('id,statement_id,section,previous_value,reverted_at,created_at')
        .eq('client_id', clientId).order('created_at', { ascending: false }),
    ])
    setRows((stmts as StatementRow[]) || [])
    setLogs((logRows as ApplyLogRow[]) || [])
    setLoading(false)
  }, [clientId, supabase])

  useEffect(() => { load() }, [load])
  // If the client stops being Couple mode, don't leave the form stuck on Spouse.
  useEffect(() => { if (!isCouple && genPerson === 'spouse') setGenPerson('client') }, [isCouple, genPerson])

  function flash(msg: string) {
    setNotice(msg)
    setTimeout(() => setNotice(''), 3500)
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
      if (existing) {
        const { error } = await supabase.from('financial_statements')
          .update({ password_hash: hash, password_hint: genHint || null, expires_at: expiresAt, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
        if (error) throw error
        flash(`Link for ${personLabel(genPerson)} (${genYear}) updated — same URL, new password/expiry.`)
      } else {
        const token = crypto.randomUUID().replace(/-/g, '')
        const { error } = await supabase.from('financial_statements').insert({
          client_id: clientId, year: genYear, person: genPerson, token,
          password_hash: hash, password_hint: genHint || null, expires_at: expiresAt,
          status: 'draft', data: {},
        })
        if (error) throw error
        flash(`Link for ${personLabel(genPerson)} (${genYear}) created.`)
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
    if (!confirm(`Expire ${personLabel(row.person)}'s ${row.year} link now? They will no longer be able to open it (their entered data is kept).`)) return
    setBusy(`expire:${row.id}`)
    const { error } = await supabase.from('financial_statements')
      .update({ expires_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', row.id)
    setBusy('')
    if (error) { console.error(error); flash('Failed to expire the link.') } else { flash('Link expired.'); await load() }
  }

  function latestLog(statementId: string, section: SectionId): ApplyLogRow | undefined {
    return logs.find(l => l.statement_id === statementId && l.section === section && !l.reverted_at)
  }

  async function applySection(row: StatementRow, section: SectionId) {
    const st = normalizeData(row.data)
    const patch = buildApplyPatch(section, st, row.person)
    const label = SECTION_LIST.find(s => s.id === section)?.label || section
    const who = personLabel(row.person)
    const extra = section === 'properties'
      ? `\n\nNote: this REPLACES the entire Properties list on the Financials tab with what ${who} entered. If the other spouse also filled in Properties, make sure you're Applying the right one.`
      : (section === 'expenses' || section === 'income')
        ? '\n\nAnnual figures from the statement are converted to monthly (÷12) to match the Financials tab.'
        : ''
    if (!confirm(`Apply ${who}'s ${row.year} ${label} into this client's Financials data? The current values are logged so you can revert this once.${extra}`)) return

    setBusy(`apply:${row.id}:${section}`)
    try {
      const { data: ffRow } = await supabase.from('fact_finding')
        .select('data').eq('client_id', clientId).eq('section', 'financials').maybeSingle()
      const previous = extractPrevious(ffRow?.data, patch)

      const { data: userRes } = await supabase.auth.getUser()
      const { error: logError } = await supabase.from('financial_statement_apply_log').insert({
        statement_id: row.id, client_id: clientId, section,
        previous_value: previous, applied_value: patch,
        applied_by: userRes?.user?.id || null,
      })
      if (logError) throw logError

      await saveFactFindingSection(supabase, clientId, 'financials', (existing: any) => {
        const next = { ...(existing || {}) }
        for (const k of Object.keys(patch.fields)) next[k] = patch.fields[k]
        if (patch.personKey && Object.keys(patch.personFields).length > 0) {
          next[patch.personKey] = { ...(next[patch.personKey] || {}) }
          for (const k of Object.keys(patch.personFields)) next[patch.personKey][k] = patch.personFields[k]
        }
        return next
      })

      flash(`${label} applied for ${who}. You can revert this once if needed.`)
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
    if (!confirm(`Revert ${label} to the values from before the last Apply (${new Date(log.created_at).toLocaleString('en-SG')})?`)) return

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

  function renderSectionDetail(st: StatementData, id: SectionId) {
    const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--line)', fontSize: 11.5 }
    const items: { label: string; value: string }[] = []

    if (id === 'income') {
      if (st.income.gross_monthly) items.push({ label: 'Gross Monthly Salary', value: fmtStmtMoney(st.income.gross_monthly) + ' /mo' })
      if (st.income.gross_bonus) items.push({ label: 'Gross Annual Bonus', value: fmtStmtMoney(st.income.gross_bonus) + ' /yr' })
      for (const i of st.income.others || []) if (i.label || i.amount) items.push({ label: i.label || '(unnamed)', value: fmtStmtMoney(i.amount) + ' /yr' })
    }
    if (id === 'expenses') {
      if (st.expense_mode === 'simple') {
        for (const f of EXP_SIMPLE_FIELDS) if (st.exp_simple[f.key]) items.push({ label: f.label, value: fmtStmtMoney(st.exp_simple[f.key]) + ' /yr' })
        for (const i of st.exp_simple_custom || []) if (i.label || i.amount) items.push({ label: i.label || '(unnamed)', value: fmtStmtMoney(i.amount) + ' /yr' })
      } else {
        for (const b of EXP_DETAILED_BLOCKS) {
          for (const f of b.fields) if (st.exp_detailed[f.key]) items.push({ label: `${b.title} · ${f.label}`, value: fmtStmtMoney(st.exp_detailed[f.key]) + ' /yr' })
          for (const i of st.exp_detailed_custom || []) if (i.cat === b.id && (i.label || i.amount)) items.push({ label: `${b.title} · ${i.label || '(unnamed)'}`, value: fmtStmtMoney(i.amount) + ' /yr' })
        }
      }
    }
    if (id === 'assets') {
      for (const b of ASSET_BLOCKS) {
        for (const f of b.fields) if (st.assets[f.key]) items.push({ label: f.label, value: fmtStmtMoney(st.assets[f.key]) })
        for (const i of st.assets_custom || []) if (i.cat === b.id && (i.label || i.amount)) items.push({ label: `${b.title} · ${i.label || '(unnamed)'}`, value: fmtStmtMoney(i.amount) })
      }
    }
    if (id === 'liabilities') {
      for (const b of LIAB_BLOCKS) {
        for (const f of b.fields) if (st.liabilities[f.key]) items.push({ label: `${b.title} · ${f.label}`, value: fmtStmtMoney(st.liabilities[f.key]) })
        for (const i of st.liabilities_custom || []) if (i.cat === b.id && (i.label || i.amount)) items.push({ label: `${b.title} · ${i.label || '(unnamed)'}`, value: fmtStmtMoney(i.amount) })
      }
    }
    if (id === 'properties') {
      for (const p of st.properties || []) {
        const mv = p.propertyValue || p.purchasePrice || 0
        items.push({
          label: `${p.label || '(unnamed property)'} · ${p.propertyType}${p.isPrimaryResidence ? ' · Primary' : ''}`,
          value: `${fmtStmtMoney(mv)} MV · ${fmtStmtMoney(p.outstanding || 0)} loan`,
        })
      }
    }

    if (items.length === 0) return <div style={{ fontSize: 11, color: 'var(--ink3)', padding: '6px 0' }}>Nothing entered for this section.</div>
    return (
      <div>
        {items.map((it, i) => (
          <div key={i} style={rowStyle}>
            <span style={{ color: 'var(--ink2)' }}>{it.label}</span>
            <span style={{ fontFamily: 'DM Mono,monospace', color: 'var(--ink)' }}>{it.value}</span>
          </div>
        ))}
      </div>
    )
  }

  function renderStatementCard(row: StatementRow) {
    const st = normalizeData(row.data)
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
            {expired && <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '3px 8px', background: '#FBEBEB', color: '#B04A4A' }}>Link expired</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={btnSm} onClick={() => copyLink(row)}>{copied === row.id ? '✓ Copied' : 'Copy Link'}</button>
            <button style={btnSm} onClick={() => whatsappShare(row)}>WhatsApp</button>
            {!expired && <button style={btnSm} disabled={busy === `expire:${row.id}`} onClick={() => expireNow(row)}>Expire Now</button>}
            <button style={btnSm} onClick={() => setOpenId(open ? null : row.id)}>{open ? 'Hide Details' : 'View Details'}</button>
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
                    <div style={{ fontSize: 10.5, color: '#2A5E46', marginBottom: 6 }}>
                      Applied {new Date(applied.created_at).toLocaleString('en-SG')} — one-step revert available.
                    </div>
                  )}
                  {renderSectionDetail(st, sec.id)}
                </div>
              )
            })}
            <div style={{ fontSize: 10.5, color: 'var(--ink3)', lineHeight: 1.6, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              Apply notes: income &amp; expense figures convert annual → monthly (÷12). Applying Properties replaces the whole Properties list — if both {clientName} and {spouseName || 'the spouse'} entered properties, only Apply the one you want to keep. Client-added custom items in Simplified expense mode fold into Lifestyle &amp; Miscellaneous.
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
