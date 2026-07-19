'use client'

// Snapshots tab (Financials page) — advisor side of the client-facing
// Financial Statement feature.
//
// - Generate a password-protected /statement/[token] link for a given year
//   (one statement row per client+year; regenerating updates password/expiry
//   on the same row so client-entered data is never lost).
// - Browse past years, view what the client entered (draft or submitted).
// - Apply individual sections into fact_finding ('financials' section).
//   Apply is the ONLY write path from a statement into live data, and it runs
//   here under the advisor's own RLS-protected session. Each Apply logs the
//   pre-Apply values into financial_statement_apply_log, enabling a
//   single-level Revert per section.
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

interface StatementRow {
  id: string
  client_id: string
  year: number
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

function normalizeData(raw: any): StatementData {
  const base = emptyStatementData()
  if (!raw || typeof raw !== 'object') return base
  return { ...base, ...raw, income: { ...base.income, ...(raw.income || {}) } }
}

// ---------- Apply patch builders ----------
// Each returns { fields, person1Fields } — the exact keys written into the
// fact_finding 'financials' data blob (person1Fields nested under person1).

interface ApplyPatch { fields: Record<string, any>; person1Fields: Record<string, any> }

function buildApplyPatch(section: SectionId, st: StatementData): ApplyPatch {
  const fields: Record<string, any> = {}
  const person1Fields: Record<string, any> = {}

  if (section === 'income') {
    person1Fields.gross_monthly = round0(st.income.gross_monthly || 0)
    person1Fields.gross_bonus = round0(st.income.gross_bonus || 0)
    person1Fields.other_incomes = (st.income.others || [])
      .filter(i => i.label || i.amount)
      .map(i => ({ label: i.label, amount: perMonth(i.amount) })) // annual → monthly
  }

  if (section === 'expenses') {
    fields.expense_mode = st.expense_mode
    if (st.expense_mode === 'simple') {
      for (const f of EXP_SIMPLE_FIELDS) fields[f.key] = perMonth(st.exp_simple[f.key] || 0)
      // The advisor page's simple mode has no custom rows — fold any
      // client-added simple items into Lifestyle & Miscellaneous.
      const customAnnual = (st.exp_simple_custom || []).reduce((s, i) => s + (i.amount || 0), 0)
      if (customAnnual > 0) fields.s_lifestyle = (fields.s_lifestyle || 0) + perMonth(customAnnual)
    } else {
      for (const block of EXP_DETAILED_BLOCKS) {
        for (const f of block.fields) fields[f.key] = perMonth(st.exp_detailed[f.key] || 0)
        const customKey = EXP_CUSTOM_KEY[block.id]
        fields[customKey] = (st.exp_detailed_custom || [])
          .filter(i => i.cat === block.id && (i.label || i.amount))
          .map(i => ({ label: i.label, amount: perMonth(i.amount) })) // annual → monthly
      }
    }
  }

  if (section === 'assets') {
    for (const block of ASSET_BLOCKS) {
      for (const f of block.fields) fields[f.key] = round0(st.assets[f.key] || 0)
      const customKey = ASSET_CUSTOM_KEY[block.id]
      fields[customKey] = (st.assets_custom || [])
        .filter(i => i.cat === block.id && (i.label || i.amount))
        .map(i => ({ label: i.label, amount: round0(i.amount) }))
    }
  }

  if (section === 'liabilities') {
    for (const block of LIAB_BLOCKS) {
      for (const f of block.fields) fields[f.key] = round0(st.liabilities[f.key] || 0)
      const customKey = LIAB_CUSTOM_KEY[block.id]
      fields[customKey] = (st.liabilities_custom || [])
        .filter(i => i.cat === block.id && (i.label || i.amount))
        .map(i => ({ label: i.label, amount: round0(i.amount) }))
    }
  }

  if (section === 'properties') {
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

  return { fields, person1Fields }
}

// Captures the pre-Apply value of every key the patch is about to touch.
// null = "key did not exist before" so Revert can delete it again.
function extractPrevious(existing: any, patch: ApplyPatch) {
  const prevFields: Record<string, any> = {}
  const prevP1: Record<string, any> = {}
  const ex = existing || {}
  const exP1 = ex.person1 || {}
  for (const k of Object.keys(patch.fields)) prevFields[k] = ex[k] === undefined ? null : ex[k]
  for (const k of Object.keys(patch.person1Fields)) prevP1[k] = exP1[k] === undefined ? null : exP1[k]
  return { fields: prevFields, person1: prevP1 }
}

// ---------- Component ----------

export default function SnapshotsTab({ clientId, clientName, onDataChanged }: {
  clientId: string
  clientName: string
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
  const [genPassword, setGenPassword] = useState('')
  const [genHint, setGenHint] = useState('')
  const [genExpiry, setGenExpiry] = useState<'7d' | '30d' | 'never'>('30d')
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState('')
  const [copied, setCopied] = useState('')

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

      const existing = rows.find(r => r.year === genYear)
      if (existing) {
        // Reuse the row: keep the client's data, refresh credentials + expiry.
        const { error } = await supabase.from('financial_statements')
          .update({ password_hash: hash, password_hint: genHint || null, expires_at: expiresAt, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
        if (error) throw error
        flash(`Link for ${genYear} updated — same URL, new password/expiry.`)
      } else {
        const token = crypto.randomUUID().replace(/-/g, '')
        const { error } = await supabase.from('financial_statements').insert({
          client_id: clientId, year: genYear, token,
          password_hash: hash, password_hint: genHint || null, expires_at: expiresAt,
          status: 'draft', data: {},
        })
        if (error) throw error
        flash(`Link for ${genYear} created.`)
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
    // \n\n between title and URL keeps the link tappable in WhatsApp.
    const text = `Your ${row.year} Financial Statement — ${clientName}\n\n${statementUrl(row.token)}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  async function expireNow(row: StatementRow) {
    if (!confirm(`Expire the ${row.year} link now? The client will no longer be able to open it (their entered data is kept). You can re-issue access later by updating the link for ${row.year}.`)) return
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
    const patch = buildApplyPatch(section, st)
    const label = SECTION_LIST.find(s => s.id === section)?.label || section
    const extra = section === 'properties'
      ? '\n\nNote: this REPLACES the entire Properties list on the Financials tab with what the client entered.'
      : (section === 'expenses' || section === 'income')
        ? '\n\nAnnual figures from the statement are converted to monthly (÷12) to match the Financials tab.'
        : ''
    if (!confirm(`Apply the client's ${row.year} ${label} into this client's Financials data? The current values are logged so you can revert this once.${extra}`)) return

    setBusy(`apply:${row.id}:${section}`)
    try {
      // Read current values first so the log captures the true pre-Apply state.
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
        if (Object.keys(patch.person1Fields).length > 0) {
          next.person1 = { ...(next.person1 || {}) }
          for (const k of Object.keys(patch.person1Fields)) next.person1[k] = patch.person1Fields[k]
        }
        return next
      })

      flash(`${label} applied. You can revert this once if needed.`)
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
      const prev = log.previous_value || { fields: {}, person1: {} }
      await saveFactFindingSection(supabase, clientId, 'financials', (existing: any) => {
        const next = { ...(existing || {}) }
        const pf = prev.fields || {}
        for (const k of Object.keys(pf)) {
          if (pf[k] === null) delete next[k]
          else next[k] = pf[k]
        }
        const pp = prev.person1 || {}
        if (Object.keys(pp).length > 0) {
          next.person1 = { ...(next.person1 || {}) }
          for (const k of Object.keys(pp)) {
            if (pp[k] === null) delete next.person1[k]
            else next.person1[k] = pp[k]
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

  // ---------- Render helpers (plain functions returning JSX; no components defined inside) ----------

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

  return (
    <div>
      {notice && (
        <div style={{ background: '#E8F2ED', border: '1px solid #C9E0D6', color: '#1E4536', fontSize: 12, padding: '10px 14px', marginBottom: 16 }}>{notice}</div>
      )}

      {/* ---------- Generate / update link ---------- */}
      <div style={card}>
        <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--ink3)' }}>Client Statement Link</div>
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 14, lineHeight: 1.5 }}>
          Generates a password-protected link where {clientName} fills in their own income, expenses, assets, properties and liabilities for a chosen year. Their entries stay in this tab until you explicitly Apply a section — nothing touches the live Financials data on its own.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Year</div>
            <input type="number" value={genYear} onChange={e => setGenYear(parseInt(e.target.value) || new Date().getFullYear())}
              className="text-sm px-2 py-1.5 outline-none" style={{ border: '1px solid var(--line)', width: 90, background: 'var(--cream)', color: 'var(--ink)' }} />
          </div>
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
            {genBusy ? 'Working…' : rows.some(r => r.year === genYear) ? `Update ${genYear} Link` : `Create ${genYear} Link`}
          </button>
        </div>
        {rows.some(r => r.year === genYear) && (
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 8 }}>
            A statement for {genYear} already exists — this updates its password/expiry on the same URL. The client&apos;s entered data is kept.
          </div>
        )}
        {genError && <div style={{ fontSize: 12, color: '#B04A4A', marginTop: 8 }}>{genError}</div>}
      </div>

      {/* ---------- Statement list ---------- */}
      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--ink3)', padding: '20px 0' }}>Loading snapshots…</div>
      ) : rows.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: 'var(--ink3)', fontSize: 12 }}>
          No statements yet. Create a link above and share it with {clientName}.
        </div>
      ) : rows.map(row => {
        const st = normalizeData(row.data)
        const expired = row.expires_at ? new Date(row.expires_at) < new Date() : false
        const open = openId === row.id
        return (
          <div key={row.id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <span className="font-serif" style={{ fontSize: 22, color: 'var(--ink)' }}>{row.year}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                  padding: '3px 8px',
                  background: row.status === 'submitted' ? '#E8F2ED' : '#F5EFE3',
                  color: row.status === 'submitted' ? '#2A5E46' : '#8A6C3A',
                }}>
                  {row.status === 'submitted' ? '✓ Submitted' : 'Draft'}
                </span>
                {expired && <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '3px 8px', background: '#FBEBEB', color: '#B04A4A' }}>Link expired</span>}
                {row.client_name && <span style={{ fontSize: 11, color: 'var(--ink3)' }}>by {row.client_name}{row.client_occupation ? ` · ${row.client_occupation}` : ''}</span>}
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
            </div>

            {open && (
              <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                {row.status !== 'submitted' && (
                  <div style={{ background: '#FBF3E3', border: '1px solid #EDD9AE', color: '#6E5619', fontSize: 11.5, padding: '9px 12px', marginBottom: 14, lineHeight: 1.5 }}>
                    This statement is still a <b>draft</b> — the client hasn&apos;t submitted it yet. You can still Apply sections, but the figures may be incomplete.
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
                            {applying ? 'Applying…' : 'Apply to Financials'}
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
                  Apply notes: income &amp; expense figures are converted from annual to monthly (÷12) to match the Financials tab. Applying Properties replaces the whole Properties list. Client-added items in Simplified expense mode are folded into Lifestyle &amp; Miscellaneous. Apply writes to the Client (Person 1) only.
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
