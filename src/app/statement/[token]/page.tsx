'use client'

// Client-facing Financial Statement page (/statement/[token]).
//
// Unauthenticated, password-gated form where a client fills in their own
// Income / Expenses / Assets / Properties / Liabilities for a given year.
// All persistence goes through /api/statement/[token] (service-role) — this
// page never talks to Supabase directly. Save keeps a draft; Submit locks the
// statement as a frozen snapshot the advisor can review and Apply.
//
// Design + interaction ported 1:1 from the approved HTML mockup, including:
// - Detailed expense mode as the default, with a warning when Simplified
// - Name + Occupation required for BOTH Save and Submit
// - Active accuracy-acknowledgment checkbox required for Submit only

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  StatementData, StmtProperty, emptyStatementData,
  INCOME_POOL, EXP_SIMPLE_FIELDS, EXP_DETAILED_BLOCKS,
  ASSET_BLOCKS, LIAB_BLOCKS,
  PROPERTY_TYPES, OWNERSHIP_TYPES, LOAN_TYPES,
  stmtIncomeTotal, stmtExpSimpleTotal, stmtExpDetailedBlockTotal, stmtExpDetailedTotal,
  stmtAssetBlockTotal, stmtAssetsTotal, stmtLiabBlockTotal, stmtLiabTotal, stmtPropertyEquity,
  fmtStmtMoney,
} from '@/lib/statementFields'

const SECTIONS = ['Income', 'Expenses', 'Assets', 'Properties', 'Liabilities']

const parseAmt = (v: string): number => {
  if (v === '') return 0
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? 0 : n
}

// ---------- Small building blocks (module-level: never define components inside components) ----------

function AmountInput({ value, onChange, placeholder }: {
  value: number | undefined; onChange: (n: number) => void; placeholder?: string
}) {
  return (
    <input
      type="text" inputMode="decimal" placeholder={placeholder || '$ 0'}
      value={value ? String(value) : ''}
      onChange={e => onChange(parseAmt(e.target.value))}
      className="st-amt"
    />
  )
}

function FRow({ label, unit, hint, value, onChange }: {
  label: string; unit?: string; hint?: string
  value: number | undefined; onChange: (n: number) => void
}) {
  return (
    <div className="st-frow">
      <span className="st-flabel">
        {label}{unit && <span className="st-unit">{unit}</span>}
        {hint && <span className="st-fhint">{hint}</span>}
      </span>
      <AmountInput value={value} onChange={onChange} />
    </div>
  )
}

function CustomRow({ tag, label, value, onLabel, onValue, onRemove }: {
  tag?: string; label: string; value: number | undefined
  onLabel: (s: string) => void; onValue: (n: number) => void; onRemove: () => void
}) {
  return (
    <div className="st-frow st-added">
      {tag && <span className="st-grp-tag">{tag}</span>}
      <input type="text" className="st-txt" placeholder="Item name…" value={label} onChange={e => onLabel(e.target.value)} />
      <AmountInput value={value} onChange={onValue} />
      <button type="button" className="st-rm" title="Remove" onClick={onRemove}>✕</button>
    </div>
  )
}

function SubtotalStrip({ label, value }: { label: string; value: number }) {
  return (
    <div className="st-subtotal"><span className="lbl">{label}</span><span className="val">{fmtStmtMoney(value)}</span></div>
  )
}

function PasswordGate({ hint, firm, year, onUnlock, error, busy }: {
  hint: string; firm: string; year: number | null
  onUnlock: (pw: string) => void; error: string; busy: boolean
}) {
  const [pw, setPw] = useState('')
  return (
    <div style={{ minHeight: '100vh', background: '#1C1A17', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Inter,sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(168,131,74,0.7)', marginBottom: 12 }}>{firm}</div>
          <div style={{ fontFamily: 'Cormorant Garamond,Georgia,serif', fontSize: 28, fontWeight: 300, color: '#F0EDE8', marginBottom: 8 }}>
            {year ? `Your ${year} Financial Statement` : 'Financial Statement'}
          </div>
          <div style={{ width: 40, height: 1, background: '#A8834A', margin: '0 auto' }} />
        </div>
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.1)', padding: '28px 32px' }}>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7, marginBottom: 20, textAlign: 'center' }}>
            This link is protected. Enter the password your advisor shared with you.
          </div>
          {hint && <div style={{ fontSize: 12, color: 'rgba(168,131,74,0.9)', marginBottom: 16, textAlign: 'center' }}>Hint: {hint}</div>}
          <input
            type="password" value={pw} autoFocus
            onChange={e => setPw(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && pw.trim() && !busy) onUnlock(pw.trim()) }}
            placeholder="Password"
            style={{ width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: '#F0EDE8', fontSize: 14, outline: 'none', marginBottom: 12, borderRadius: 4 }}
          />
          {error && <div style={{ fontSize: 12, color: '#E08080', marginBottom: 12, textAlign: 'center' }}>{error}</div>}
          <button
            onClick={() => { if (pw.trim() && !busy) onUnlock(pw.trim()) }}
            disabled={busy || !pw.trim()}
            style={{ width: '100%', padding: '12px', background: '#A8834A', color: '#1C1A17', border: 'none', fontSize: 13, fontWeight: 600, letterSpacing: '0.05em', cursor: busy ? 'default' : 'pointer', opacity: busy || !pw.trim() ? 0.6 : 1, borderRadius: 4 }}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CenteredNotice({ title, body, firm }: { title: string; body: string; firm: string }) {
  return (
    <div style={{ minHeight: '100vh', background: '#1C1A17', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Inter,sans-serif' }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(168,131,74,0.7)', marginBottom: 12 }}>{firm}</div>
        <div style={{ fontFamily: 'Cormorant Garamond,Georgia,serif', fontSize: 26, fontWeight: 300, color: '#F0EDE8', marginBottom: 12 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7 }}>{body}</div>
      </div>
    </div>
  )
}

// ---------- Page ----------

type Phase = 'loading' | 'gate' | 'form' | 'expired' | 'notfound'

export default function StatementPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token || ''

  const [phase, setPhase] = useState<Phase>('loading')
  const [firm, setFirm] = useState('Bespoke Capital')
  const [hint, setHint] = useState('')
  const [year, setYear] = useState<number | null>(null)
  const [status, setStatus] = useState<'draft' | 'submitted'>('draft')
  const [submittedAt, setSubmittedAt] = useState<string | null>(null)
  const [pwError, setPwError] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const passwordRef = useRef('')

  const [data, setData] = useState<StatementData>(emptyStatementData())
  const [name, setName] = useState('')
  const [occupation, setOccupation] = useState('')
  const [ack, setAck] = useState(false)
  const [nameErr, setNameErr] = useState(false)
  const [occErr, setOccErr] = useState(false)
  const [ackErr, setAckErr] = useState(false)

  const [sectionIdx, setSectionIdx] = useState(0)
  const [maxVisited, setMaxVisited] = useState(0)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState('')

  // Pickers for "add another" flows
  const [incomePicking, setIncomePicking] = useState(false)
  const [expPicking, setExpPicking] = useState(false)
  const [assetPicking, setAssetPicking] = useState(false)
  const [liabPicking, setLiabPicking] = useState(false)

  const idBlockRef = useRef<HTMLDivElement>(null)
  const ackRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!token) return
    fetch(`/api/statement/${token}`)
      .then(r => r.json().then(j => ({ ok: r.ok, status: r.status, j })))
      .then(({ ok, j }) => {
        if (!ok) { setPhase('notfound'); return }
        if (j.firm) setFirm(j.firm)
        setHint(j.hint || '')
        setYear(j.year ?? null)
        if (j.expired) { setPhase('expired'); return }
        setPhase('gate')
      })
      .catch(() => setPhase('notfound'))
  }, [token])

  async function unlock(pw: string) {
    setUnlocking(true); setPwError('')
    try {
      const res = await fetch(`/api/statement/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlock', password: pw }),
      })
      const j = await res.json()
      if (!res.ok) {
        if (j.error === 'wrong_password') setPwError('Incorrect password. Please try again.')
        else if (j.error === 'expired') { setPhase('expired'); return }
        else if (j.error === 'too_many_attempts') setPwError('Too many attempts. Please wait a minute and try again.')
        else setPwError('Something went wrong. Please try again.')
        return
      }
      passwordRef.current = pw
      if (j.firm) setFirm(j.firm)
      setYear(j.year ?? null)
      setStatus(j.status === 'submitted' ? 'submitted' : 'draft')
      setSubmittedAt(j.submittedAt || null)
      const base = emptyStatementData()
      const incoming = (j.data && typeof j.data === 'object') ? j.data : {}
      setData({ ...base, ...incoming, income: { ...base.income, ...(incoming.income || {}) } })
      setName(j.clientName || '')
      setOccupation(j.clientOccupation || '')
      setPhase('form')
    } catch {
      setPwError('Something went wrong. Please try again.')
    } finally {
      setUnlocking(false)
    }
  }

  function validateIdentity(): boolean {
    const nOk = !!name.trim(); const oOk = !!occupation.trim()
    setNameErr(!nOk); setOccErr(!oOk)
    if (!nOk || !oOk) idBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return nOk && oOk
  }

  async function persist(action: 'save' | 'submit') {
    if (!validateIdentity()) {
      alert(`Please fill in your Name and Occupation before ${action === 'save' ? 'saving' : 'submitting'}.`)
      return
    }
    if (action === 'submit') {
      if (!ack) {
        setAckErr(true)
        ackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        alert('Please confirm the accuracy checkbox before submitting.')
        return
      }
      setAckErr(false)
      if (!confirm(`Submit your ${year} financial statement? Once submitted, it becomes final and can no longer be edited.`)) return
    }
    setSaving(true); setSaveErr('')
    try {
      const res = await fetch(`/api/statement/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action, password: passwordRef.current, data,
          name: name.trim(), occupation: occupation.trim(),
          ack: action === 'submit' ? true : undefined,
        }),
      })
      const j = await res.json()
      if (!res.ok) {
        if (j.error === 'already_submitted') { setStatus('submitted'); return }
        setSaveErr('Save failed — please check your connection and try again.')
        return
      }
      setLastSaved(new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' }))
      if (action === 'submit') { setStatus('submitted'); setSubmittedAt(j.savedAt || new Date().toISOString()) }
    } catch {
      setSaveErr('Save failed — please check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  // ---------- Immutable update helpers ----------
  const setIncome = (patch: Partial<StatementData['income']>) =>
    setData(d => ({ ...d, income: { ...d.income, ...patch } }))
  const setExpSimple = (key: string, n: number) =>
    setData(d => ({ ...d, exp_simple: { ...d.exp_simple, [key]: n } }))
  const setExpDetailed = (key: string, n: number) =>
    setData(d => ({ ...d, exp_detailed: { ...d.exp_detailed, [key]: n } }))
  const setAsset = (key: string, n: number) =>
    setData(d => ({ ...d, assets: { ...d.assets, [key]: n } }))
  const setLiab = (key: string, n: number) =>
    setData(d => ({ ...d, liabilities: { ...d.liabilities, [key]: n } }))
  const updProp = (id: string, patch: Partial<StmtProperty>) =>
    setData(d => ({ ...d, properties: d.properties.map(p => p.id === id ? { ...p, ...patch } : p) }))

  function setPrimary(id: string, on: boolean) {
    // Mutually exclusive across properties
    setData(d => ({ ...d, properties: d.properties.map(p => ({ ...p, isPrimaryResidence: on ? p.id === id : (p.id === id ? false : p.isPrimaryResidence) })) }))
  }

  function addProperty() {
    const p: StmtProperty = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      label: '', propertyType: 'HDB', isPrimaryResidence: false, ownershipType: 'Sole Ownership',
    }
    setData(d => ({ ...d, properties: [...d.properties, p] }))
  }

  const totals = useMemo(() => ({
    income: stmtIncomeTotal(data),
    expSimple: stmtExpSimpleTotal(data),
    expDetailed: stmtExpDetailedTotal(data),
    assets: stmtAssetsTotal(data),
    liab: stmtLiabTotal(data),
    equity: stmtPropertyEquity(data),
  }), [data])

  function goTo(i: number) {
    setSectionIdx(i)
    setMaxVisited(m => Math.max(m, i))
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (phase === 'loading') return <CenteredNotice firm={firm} title="Loading…" body="Preparing your financial statement." />
  if (phase === 'notfound') return <CenteredNotice firm={firm} title="Link Not Found" body="This link is invalid or has been removed. Please check with your advisor for a new link." />
  if (phase === 'expired') return <CenteredNotice firm={firm} title="Link Expired" body="This link has expired. Please contact your advisor to request a new one." />
  if (phase === 'gate') return <PasswordGate hint={hint} firm={firm} year={year} onUnlock={unlock} error={pwError} busy={unlocking} />

  const locked = status === 'submitted'
  const isSimple = data.expense_mode === 'simple'

  return (
    <div className="st-body">
      <style>{STATEMENT_CSS}</style>

      <div className="st-topbar">
        <div className="brand">BESPOKE <span>CAPITAL</span></div>
        <div className="tb-right">{firm}</div>
      </div>

      <div className="st-wrap">
        <div className="st-hero">
          <div className="eyebrow">Financial Statement</div>
          <h1>Your {year} Financial Snapshot</h1>
          {!locked && <p>Fill in your income, expenses, assets and liabilities below. Save your progress and return anytime — nothing is final until you submit.</p>}
        </div>

        {locked ? (
          <div className="st-banner st-banner-done">✓ &nbsp;<span><b>Submitted</b>{submittedAt ? ` on ${new Date(submittedAt).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''} — this statement is now final and has been shared with your advisor. It can no longer be edited.</span></div>
        ) : (
          <div className="st-banner">💾 &nbsp;<span><b>Draft</b>{lastSaved ? ` — last saved at ${lastSaved}.` : ' — not yet saved.'} Nothing is final until you click <b>Submit Statement</b>.</span></div>
        )}

        <div className={`st-id-block ${locked ? 'st-locked' : ''}`} ref={idBlockRef}>
          <div className="st-id-title">YOUR DETAILS <span className="st-req-tag">Required</span></div>
          <div className="st-field-row">
            <div className="st-field">
              <label>Name <span className="st-star">*</span></label>
              <input type="text" className={`st-txt-l ${nameErr ? 'st-err' : ''}`} placeholder="Full name" value={name} disabled={locked} onChange={e => { setName(e.target.value); if (e.target.value.trim()) setNameErr(false) }} />
            </div>
            <div className="st-field">
              <label>Occupation <span className="st-star">*</span></label>
              <input type="text" className={`st-txt-l ${occErr ? 'st-err' : ''}`} placeholder="e.g. Engineer" value={occupation} disabled={locked} onChange={e => { setOccupation(e.target.value); if (e.target.value.trim()) setOccErr(false) }} />
            </div>
          </div>
        </div>

        <div className="st-rail">
          {SECTIONS.map((s, i) => (
            <div key={s} className={`seg ${i === sectionIdx ? 'active' : i <= maxVisited ? 'done' : ''}`} />
          ))}
        </div>
        <div className="st-rail-label">SECTION {sectionIdx + 1} OF {SECTIONS.length} · {SECTIONS[sectionIdx].toUpperCase()}</div>
        <div className="st-nav">
          {SECTIONS.map((s, i) => (
            <button key={s} className={i === sectionIdx ? 'active' : ''} onClick={() => goTo(i)}>
              <span className={`dot ${i <= maxVisited ? 'seen' : ''}`} />{s}
            </button>
          ))}
        </div>

        <div className={locked ? 'st-locked' : ''}>

          {/* ============ INCOME ============ */}
          {sectionIdx === 0 && (
            <div className="st-card">
              <h2>Income</h2>
              <p className="st-subhint">Your income sources for the year. Figures are <b>annual (per year)</b> — salary is entered monthly since that&apos;s how it&apos;s usually paid, but the total rolls everything up to a yearly figure.</p>
              <div className="st-block">
                <div className="st-bt" style={{ background: '#F5EFE3', color: '#8A6C3A' }}>GROSS SALARY</div>
                <FRow label="Gross Monthly" unit="/mo" hint="Before CPF deductions" value={data.income.gross_monthly} onChange={n => setIncome({ gross_monthly: n })} />
                <FRow label="Gross Annual Bonus" unit="/yr" hint="Total bonus for the year (AWS + variable)" value={data.income.gross_bonus} onChange={n => setIncome({ gross_bonus: n })} />
              </div>
              <div className="st-block">
                <div className="st-bt" style={{ background: '#E8F2ED', color: '#2A5E46' }}>OTHER INCOME <span className="bt-side">/yr</span></div>
                {data.income.others.map((it, i) => (
                  <CustomRow key={i} label={it.label} value={it.amount}
                    onLabel={s => setIncome({ others: data.income.others.map((x, j) => j === i ? { ...x, label: s } : x) })}
                    onValue={n => setIncome({ others: data.income.others.map((x, j) => j === i ? { ...x, amount: n } : x) })}
                    onRemove={() => setIncome({ others: data.income.others.filter((_, j) => j !== i) })} />
                ))}
                {incomePicking ? (
                  <select className="st-picker" autoFocus defaultValue=""
                    onChange={e => {
                      const v = e.target.value
                      if (v) {
                        const preset = INCOME_POOL.find(p => p.id === v)
                        setIncome({ others: [...data.income.others, { label: v === '__other__' ? '' : (preset?.label || ''), amount: 0 }] })
                      }
                      setIncomePicking(false)
                    }}
                    onBlur={() => setIncomePicking(false)}>
                    <option value="" disabled>Select income type to add…</option>
                    {INCOME_POOL.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    <option value="__other__">Other (please specify)</option>
                  </select>
                ) : (
                  !locked && <button type="button" className="st-add" onClick={() => setIncomePicking(true)}>+ Add another income source</button>
                )}
              </div>
              <SubtotalStrip label="Total Annual Income" value={totals.income} />
            </div>
          )}

          {/* ============ EXPENSES ============ */}
          {sectionIdx === 1 && (
            <div className="st-card">
              <div className="st-head-row">
                <div>
                  <h2>Expenses</h2>
                  <p className="st-subhint" style={{ marginBottom: 6 }}>Your spending for the year. Figures are <b>annual (per year)</b>.</p>
                </div>
                <div className="st-mode">
                  <button className={isSimple ? 'active' : ''} disabled={locked} onClick={() => setData(d => ({ ...d, expense_mode: 'simple' }))}>⚡ Simplified</button>
                  <button className={!isSimple ? 'active' : ''} disabled={locked} onClick={() => setData(d => ({ ...d, expense_mode: 'detailed' }))}>📋 Detailed</button>
                </div>
              </div>

              {isSimple && (
                <div className="st-warn">⚠️&nbsp; <span><b>Simplified view</b> gives a quick, rough total. For a more accurate picture — and one your advisor can act on with more precision — switch to <b>Detailed</b> and break each category down.</span></div>
              )}

              {isSimple ? (
                <div>
                  {EXP_SIMPLE_FIELDS.map(f => (
                    <FRow key={f.key} label={f.label} hint={f.hint} value={data.exp_simple[f.key]} onChange={n => setExpSimple(f.key, n)} />
                  ))}
                  {data.exp_simple_custom.map((it, i) => (
                    <CustomRow key={i} label={it.label} value={it.amount}
                      onLabel={s => setData(d => ({ ...d, exp_simple_custom: d.exp_simple_custom.map((x, j) => j === i ? { ...x, label: s } : x) }))}
                      onValue={n => setData(d => ({ ...d, exp_simple_custom: d.exp_simple_custom.map((x, j) => j === i ? { ...x, amount: n } : x) }))}
                      onRemove={() => setData(d => ({ ...d, exp_simple_custom: d.exp_simple_custom.filter((_, j) => j !== i) }))} />
                  ))}
                  {!locked && <button type="button" className="st-add" onClick={() => setData(d => ({ ...d, exp_simple_custom: [...d.exp_simple_custom, { label: '', amount: 0 }] }))}>+ Add another expense</button>}
                  <SubtotalStrip label="Total Annual Expenses" value={totals.expSimple} />
                </div>
              ) : (
                <div>
                  {EXP_DETAILED_BLOCKS.map(block => (
                    <div className="st-block" key={block.id}>
                      <div className="st-bt" style={{ background: block.bg, color: block.color }}>
                        {block.title.toUpperCase()} <span className="bt-side">{fmtStmtMoney(stmtExpDetailedBlockTotal(data, block.id))}</span>
                      </div>
                      {block.fields.map(f => (
                        <FRow key={f.key} label={f.label} value={data.exp_detailed[f.key]} onChange={n => setExpDetailed(f.key, n)} />
                      ))}
                      {data.exp_detailed_custom.map((it, i) => it.cat === block.id ? (
                        <CustomRow key={i} label={it.label} value={it.amount}
                          onLabel={s => setData(d => ({ ...d, exp_detailed_custom: d.exp_detailed_custom.map((x, j) => j === i ? { ...x, label: s } : x) }))}
                          onValue={n => setData(d => ({ ...d, exp_detailed_custom: d.exp_detailed_custom.map((x, j) => j === i ? { ...x, amount: n } : x) }))}
                          onRemove={() => setData(d => ({ ...d, exp_detailed_custom: d.exp_detailed_custom.filter((_, j) => j !== i) }))} />
                      ) : null)}
                    </div>
                  ))}
                  {expPicking ? (
                    <select className="st-picker" autoFocus defaultValue=""
                      onChange={e => {
                        const v = e.target.value
                        if (v) setData(d => ({ ...d, exp_detailed_custom: [...d.exp_detailed_custom, { cat: v, label: '', amount: 0 }] }))
                        setExpPicking(false)
                      }}
                      onBlur={() => setExpPicking(false)}>
                      <option value="" disabled>Which category does this expense belong to?</option>
                      {EXP_DETAILED_BLOCKS.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                    </select>
                  ) : (
                    !locked && <button type="button" className="st-add" onClick={() => setExpPicking(true)}>+ Add another expense</button>
                  )}
                  <SubtotalStrip label="Total Annual Expenses" value={totals.expDetailed} />
                </div>
              )}
            </div>
          )}

          {/* ============ ASSETS ============ */}
          {sectionIdx === 2 && (
            <div className="st-card">
              <h2>Assets</h2>
              <p className="st-subhint">Current balances, grouped the same way as your advisor&apos;s records.</p>
              {ASSET_BLOCKS.map(block => (
                <div className="st-block" key={block.id}>
                  <div className="st-bt" style={{ background: block.bg, color: block.color }}>
                    {block.title.toUpperCase()} <span className="bt-side">{fmtStmtMoney(stmtAssetBlockTotal(data, block.id))}</span>
                  </div>
                  {block.fields.map(f => (
                    <FRow key={f.key} label={f.label} value={data.assets[f.key]} onChange={n => setAsset(f.key, n)} />
                  ))}
                  {data.assets_custom.map((it, i) => it.cat === block.id ? (
                    <CustomRow key={i} label={it.label} value={it.amount}
                      onLabel={s => setData(d => ({ ...d, assets_custom: d.assets_custom.map((x, j) => j === i ? { ...x, label: s } : x) }))}
                      onValue={n => setData(d => ({ ...d, assets_custom: d.assets_custom.map((x, j) => j === i ? { ...x, amount: n } : x) }))}
                      onRemove={() => setData(d => ({ ...d, assets_custom: d.assets_custom.filter((_, j) => j !== i) }))} />
                  ) : null)}
                </div>
              ))}
              {assetPicking ? (
                <select className="st-picker" autoFocus defaultValue=""
                  onChange={e => {
                    const v = e.target.value
                    if (v) setData(d => ({ ...d, assets_custom: [...d.assets_custom, { cat: v, label: '', amount: 0 }] }))
                    setAssetPicking(false)
                  }}
                  onBlur={() => setAssetPicking(false)}>
                  <option value="" disabled>Which group does this asset belong to?</option>
                  {ASSET_BLOCKS.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                </select>
              ) : (
                !locked && <button type="button" className="st-add" onClick={() => setAssetPicking(true)}>+ Add another asset (not listed above)</button>
              )}
              <SubtotalStrip label="Total Assets" value={totals.assets} />
            </div>
          )}

          {/* ============ PROPERTIES ============ */}
          {sectionIdx === 3 && (
            <div className="st-card">
              <h2>Properties</h2>
              <p className="st-subhint">Each property you own, with its mortgage details. Only one property can be marked as your Primary Residence.</p>
              {data.properties.length === 0 && (
                <div className="st-empty">No properties added. If you own property, add it below — otherwise you can skip this section.</div>
              )}
              {data.properties.map((p, idx) => (
                <div className="st-prop" key={p.id}>
                  <div className="st-prop-head">
                    <span className="pt">PROPERTY {idx + 1}</span>
                    {!locked && <button type="button" className="st-rm" title="Remove property" onClick={() => setData(d => ({ ...d, properties: d.properties.filter(x => x.id !== p.id) }))}>✕</button>}
                  </div>
                  <div className="st-field-row">
                    <div className="st-field"><label>Property Label / Address</label><input type="text" className="st-txt-l" placeholder="e.g. Main Residence — Bishan Ave 5" value={p.label} onChange={e => updProp(p.id, { label: e.target.value })} /></div>
                    <div className="st-field"><label>Property Type</label>
                      <select value={p.propertyType} onChange={e => updProp(p.id, { propertyType: e.target.value })}>
                        {PROPERTY_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="st-field-row">
                    <div className="st-field"><label>Purchase Price</label><AmountInput value={p.purchasePrice} onChange={n => updProp(p.id, { purchasePrice: n })} /></div>
                    <div className="st-field"><label>Current Market Value</label><AmountInput value={p.propertyValue} onChange={n => updProp(p.id, { propertyValue: n })} /></div>
                  </div>
                  <div className="st-field-row">
                    <div className="st-field"><label>Ownership</label>
                      <select value={p.ownershipType} onChange={e => updProp(p.id, { ownershipType: e.target.value })}>
                        {OWNERSHIP_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="st-field"><label>Primary Residence</label>
                      <button type="button" className={`st-toggle ${p.isPrimaryResidence ? 'active' : ''}`} disabled={locked} onClick={() => setPrimary(p.id, !p.isPrimaryResidence)}>
                        <span className="track"><span className="knob" /></span>
                        <span className="txt">{p.isPrimaryResidence ? 'Yes, this is my primary home' : 'No'}</span>
                      </button>
                    </div>
                  </div>
                  <div className="st-field-row">
                    <div className="st-field"><label>Bank</label><input type="text" className="st-txt-l" placeholder="e.g. DBS" value={p.bank || ''} onChange={e => updProp(p.id, { bank: e.target.value })} /></div>
                    <div className="st-field"><label>Loan Type</label>
                      <select value={p.loanType || 'Fixed'} onChange={e => updProp(p.id, { loanType: e.target.value })}>
                        {LOAN_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="st-field-row">
                    <div className="st-field"><label>Current Outstanding Loan</label><AmountInput value={p.outstanding} onChange={n => updProp(p.id, { outstanding: n })} /></div>
                    <div className="st-field"><label>Remaining Loan Tenure (yrs)</label><AmountInput value={p.remainingTenure} onChange={n => updProp(p.id, { remainingTenure: n })} placeholder="0" /></div>
                  </div>
                  <div className="st-field-row">
                    <div className="st-field"><label>Interest Rate (%)</label>
                      <input type="text" inputMode="decimal" className="st-amt" placeholder="0.00" value={p.interestRate !== undefined && p.interestRate !== 0 ? String(p.interestRate) : ''} onChange={e => updProp(p.id, { interestRate: parseAmt(e.target.value) })} />
                    </div>
                    <div className="st-field"><label>Monthly Repayment</label><AmountInput value={p.monthlyRepayment} onChange={n => updProp(p.id, { monthlyRepayment: n })} /></div>
                  </div>
                </div>
              ))}
              {!locked && <button type="button" className="st-add" onClick={addProperty}>+ Add another property</button>}
              <SubtotalStrip label="Total Property Equity" value={totals.equity} />
            </div>
          )}

          {/* ============ LIABILITIES ============ */}
          {sectionIdx === 4 && (
            <div className="st-card">
              <h2>Liabilities</h2>
              <p className="st-subhint">Loans and debts outside of your property mortgage.</p>
              {LIAB_BLOCKS.map(block => (
                <div className="st-block" key={block.id}>
                  <div className="st-bt" style={{ background: block.bg, color: block.color }}>
                    {block.title.toUpperCase()} <span className="bt-side">{fmtStmtMoney(stmtLiabBlockTotal(data, block.id))}</span>
                  </div>
                  {block.fields.map(f => (
                    <FRow key={f.key} label={f.label} value={data.liabilities[f.key]} onChange={n => setLiab(f.key, n)} />
                  ))}
                  {data.liabilities_custom.map((it, i) => it.cat === block.id ? (
                    <CustomRow key={i} label={it.label} value={it.amount}
                      onLabel={s => setData(d => ({ ...d, liabilities_custom: d.liabilities_custom.map((x, j) => j === i ? { ...x, label: s } : x) }))}
                      onValue={n => setData(d => ({ ...d, liabilities_custom: d.liabilities_custom.map((x, j) => j === i ? { ...x, amount: n } : x) }))}
                      onRemove={() => setData(d => ({ ...d, liabilities_custom: d.liabilities_custom.filter((_, j) => j !== i) }))} />
                  ) : null)}
                </div>
              ))}
              {liabPicking ? (
                <select className="st-picker" autoFocus defaultValue=""
                  onChange={e => {
                    const v = e.target.value
                    if (v) setData(d => ({ ...d, liabilities_custom: [...d.liabilities_custom, { cat: v, label: '', amount: 0 }] }))
                    setLiabPicking(false)
                  }}
                  onBlur={() => setLiabPicking(false)}>
                  <option value="" disabled>Is this a short-term or long-term liability?</option>
                  {LIAB_BLOCKS.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                </select>
              ) : (
                !locked && <button type="button" className="st-add" onClick={() => setLiabPicking(true)}>+ Add another liability (not listed above)</button>
              )}
              <SubtotalStrip label="Total Other Liabilities" value={totals.liab} />
            </div>
          )}

        </div>

        <div className="st-arrows">
          <button disabled={sectionIdx === 0} onClick={() => goTo(sectionIdx - 1)}>← Back</button>
          <button disabled={sectionIdx === SECTIONS.length - 1} onClick={() => goTo(sectionIdx + 1)}>{sectionIdx === SECTIONS.length - 1 ? 'Review →' : 'Next →'}</button>
        </div>

        <div className="st-disclaimer">
          The information in this statement is self-reported by the client and has not been independently verified. It is provided for financial planning and record-keeping purposes only and does not constitute financial, tax, legal, or investment advice. {firm} and your advisor rely on the accuracy of the figures submitted and are not responsible for decisions made on the basis of incomplete or inaccurate information provided by the client. Please review your figures carefully before submitting.
        </div>

        {!locked && (
          <div className={`st-ack ${ackErr ? 'err' : ''}`} ref={ackRef}>
            <input type="checkbox" id="stAck" checked={ack} onChange={e => { setAck(e.target.checked); if (e.target.checked) setAckErr(false) }} />
            <label htmlFor="stAck"><b>I confirm that the information provided in this statement is accurate to the best of my knowledge.</b> I understand this will be shared with my advisor for financial planning purposes.</label>
          </div>
        )}
      </div>

      <div className="st-footer">
        <div className="status">
          {locked
            ? <><span className="dot done">●</span>Submitted — read only</>
            : <><span className="dot">●</span>Draft — {maxVisited + 1} of {SECTIONS.length} sections viewed{saveErr && <span className="save-err"> · {saveErr}</span>}</>}
        </div>
        {!locked && (
          <div className="btns">
            <button className="b-save" disabled={saving} onClick={() => persist('save')}>{saving ? 'Saving…' : 'Save & Continue Later'}</button>
            <button className="b-submit" disabled={saving} onClick={() => persist('submit')}>Submit Statement →</button>
          </div>
        )}
      </div>
    </div>
  )
}

// CSS ported from the approved mockup (namespaced st-* to avoid any collision
// with globals), including the mobile flex-shrink fix for the footer buttons.
const STATEMENT_CSS = `
.st-body{margin:0;background:#F5F3EE;color:#1C1A17;font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased;padding-bottom:110px;min-height:100vh;}
.st-topbar{background:#1C1A17;color:#F5F3EE;padding:18px 40px;display:flex;justify-content:space-between;align-items:center;}
.st-topbar .brand{font-family:'Cormorant Garamond',Georgia,serif;font-size:17px;letter-spacing:2.5px;}
.st-topbar .brand span{color:#A8834A;}
.st-topbar .tb-right{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(245,243,238,0.4);}
.st-wrap{max-width:760px;margin:0 auto;padding:36px 20px 20px;}
.st-hero{margin-bottom:22px;}
.st-hero .eyebrow{font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#8A6C3A;font-weight:600;margin-bottom:10px;}
.st-hero h1{font-family:'Cormorant Garamond',Georgia,serif;font-size:34px;font-weight:500;margin:0 0 8px;line-height:1.15;}
.st-hero p{font-size:13.5px;color:#6B665E;line-height:1.6;margin:0;max-width:560px;}
.st-banner{background:#E8F2ED;border:1px solid #C9E0D6;border-radius:8px;padding:13px 16px;margin-bottom:24px;display:flex;gap:10px;align-items:flex-start;font-size:12px;color:#1E4536;line-height:1.5;}
.st-banner b{color:#2A5E46;}
.st-banner-done{background:#F5EFE3;border-color:#E4DBC8;color:#5E4A24;}
.st-banner-done b{color:#8A6C3A;}
.st-id-block{background:#fff;border:1.5px solid #A8834A;border-radius:10px;padding:20px 22px;margin-bottom:24px;}
.st-id-title{font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8A6C3A;margin-bottom:14px;display:flex;align-items:center;gap:10px;}
.st-req-tag{background:#FBEBEB;color:#B04A4A;font-size:9.5px;font-weight:700;padding:2px 7px;border-radius:4px;letter-spacing:0.4px;}
.st-star{color:#B04A4A;font-weight:700;}
.st-rail{display:flex;gap:5px;margin-bottom:8px;}
.st-rail .seg{flex:1;height:3px;background:#E4E1DA;border-radius:2px;transition:.2s;}
.st-rail .seg.done{background:#A8834A;}
.st-rail .seg.active{background:#2A5E46;}
.st-rail-label{font-size:9.5px;letter-spacing:1.2px;color:#A39E96;font-weight:600;margin-bottom:14px;}
.st-nav{display:flex;gap:2px;margin-bottom:28px;border-bottom:1px solid #E4E1DA;overflow-x:auto;-webkit-overflow-scrolling:touch;}
.st-nav button{background:none;border:none;font-family:Inter,sans-serif;font-size:12px;padding:9px 13px;color:#A39E96;cursor:pointer;white-space:nowrap;border-bottom:2px solid transparent;}
.st-nav button.active{color:#1C1A17;border-bottom-color:#A8834A;font-weight:600;}
.st-nav button .dot{display:inline-block;width:5px;height:5px;border-radius:50%;margin-right:6px;background:#E4E1DA;vertical-align:middle;}
.st-nav button .dot.seen{background:#2A5E46;}
.st-card{background:#fff;border:1px solid #E4E1DA;border-radius:10px;padding:28px;margin-bottom:20px;}
.st-card h2{font-family:'Cormorant Garamond',Georgia,serif;font-size:24px;font-weight:600;margin:0 0 4px;}
.st-subhint{font-size:12px;color:#8B867E;line-height:1.55;margin:0 0 18px;}
.st-head-row{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;}
.st-mode{display:flex;gap:4px;background:#F5F3EE;border:1px solid #E4E1DA;border-radius:7px;padding:3px;flex-shrink:0;}
.st-mode button{background:none;border:none;font-family:Inter,sans-serif;font-size:11.5px;font-weight:600;padding:6px 12px;border-radius:5px;color:#8B867E;cursor:pointer;}
.st-mode button.active{background:#2A5E46;color:#fff;}
.st-warn{background:#FBF3E3;border:1px solid #EDD9AE;border-radius:8px;padding:12px 15px;margin:14px 0 6px;display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#6E5619;line-height:1.5;}
.st-block{margin-top:18px;}
.st-bt{font-size:10px;font-weight:700;letter-spacing:0.8px;padding:7px 12px;border-radius:6px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;}
.st-bt .bt-side{font-family:'DM Mono',monospace;font-size:11px;font-weight:500;}
.st-frow{display:grid;grid-template-columns:1fr 150px;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid #ECEAE4;}
.st-frow.st-added{grid-template-columns:1fr 150px 26px;background:#F5EFE3;border-radius:6px;padding:7px 8px;margin-top:4px;}
.st-frow.st-added .st-grp-tag{display:none;}
.st-flabel{font-size:12.5px;color:#3B372F;line-height:1.35;}
.st-unit{font-size:9.5px;color:#A39E96;margin-left:5px;font-weight:600;}
.st-fhint{display:block;font-size:10px;color:#A39E96;margin-top:1px;}
.st-amt,.st-frow select{border:1px solid #E4E1DA;background:#F5F3EE;border-radius:6px;padding:9px 11px;font-size:13.5px;font-family:'DM Mono',monospace;color:#1C1A17;width:100%;text-align:right;box-sizing:border-box;}
.st-amt:focus{outline:none;border-color:#A8834A;}
.st-txt{border:1px solid #E4E1DA;background:#fff;border-radius:6px;padding:9px 11px;font-size:13px;font-family:Inter,sans-serif;color:#1C1A17;width:100%;box-sizing:border-box;}
.st-txt:focus{outline:none;border-color:#A8834A;}
.st-rm{background:none;border:none;color:#B04A4A;font-size:13px;cursor:pointer;padding:2px;line-height:1;}
.st-add{background:none;border:1px dashed #E4E1DA;color:#8A6C3A;font-size:12px;font-weight:600;padding:10px 16px;border-radius:6px;cursor:pointer;width:100%;margin-top:10px;font-family:Inter,sans-serif;}
.st-add:hover{border-color:#A8834A;background:#F5EFE3;}
.st-picker{width:100%;margin-top:10px;padding:11px 12px;border:1.5px solid #A8834A;border-radius:6px;background:#fff;font-size:13px;font-family:Inter,sans-serif;color:#1C1A17;box-sizing:border-box;}
.st-subtotal{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;background:#F5EFE3;border-radius:8px;padding:13px 18px;margin-top:18px;}
.st-subtotal .lbl{font-size:11px;font-weight:600;color:#8A6C3A;text-transform:uppercase;letter-spacing:0.5px;}
.st-subtotal .val{font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;font-weight:600;color:#1C1A17;}
.st-field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;}
.st-field label{display:block;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:#8B867E;margin-bottom:5px;}
.st-field input,.st-field select{border:1px solid #E4E1DA;background:#F5F3EE;border-radius:6px;padding:11px 12px;font-size:14px;font-family:'DM Mono',monospace;color:#1C1A17;width:100%;box-sizing:border-box;}
.st-field input:focus,.st-field select:focus{outline:none;border-color:#A8834A;}
.st-txt-l{font-family:Inter,sans-serif !important;text-align:left !important;}
.st-err{border-color:#B04A4A !important;}
.st-empty{font-size:12px;color:#A39E96;padding:16px 0;text-align:center;}
.st-prop{border:1px solid #E4E1DA;border-radius:8px;padding:18px;margin-bottom:14px;background:#F5F3EE;}
.st-prop-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}
.st-prop-head .pt{font-size:12.5px;font-weight:700;color:#8A6C3A;}
.st-toggle{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #E4E1DA;border-radius:6px;padding:9px 12px;cursor:pointer;width:100%;font-family:Inter,sans-serif;}
.st-toggle .track{width:34px;height:18px;border-radius:10px;background:#E4E1DA;position:relative;flex-shrink:0;transition:.15s;}
.st-toggle .knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:.15s;box-shadow:0 1px 2px rgba(0,0,0,0.15);}
.st-toggle.active .track{background:#2A5E46;}
.st-toggle.active .knob{left:18px;}
.st-toggle .txt{font-size:11.5px;color:#8B867E;text-align:left;}
.st-toggle.active .txt{color:#2A5E46;font-weight:600;}
.st-arrows{display:flex;justify-content:space-between;margin-top:4px;}
.st-arrows button{background:none;border:1px solid #E4E1DA;color:#1C1A17;padding:9px 16px;border-radius:6px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;}
.st-arrows button:disabled{opacity:0.35;cursor:default;}
.st-disclaimer{font-size:10px;color:#A39E96;line-height:1.6;margin-top:24px;padding-top:16px;border-top:1px solid #E4E1DA;}
.st-ack{display:flex;align-items:flex-start;gap:10px;background:#F5EFE3;border:1px solid #E4E1DA;border-radius:8px;padding:14px 16px;margin-top:16px;}
.st-ack.err{border-color:#B04A4A;background:#FBEBEB;}
.st-ack input[type="checkbox"]{width:17px;height:17px;margin-top:1px;flex-shrink:0;accent-color:#2A5E46;cursor:pointer;}
.st-ack label{font-size:12.5px;line-height:1.5;color:#1C1A17;cursor:pointer;}
.st-footer{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #E4E1DA;padding:14px 40px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;z-index:20;}
.st-footer .status{font-size:11px;color:#8B867E;min-width:0;}
.st-footer .status .dot{color:#A8834A;margin-right:6px;}
.st-footer .status .dot.done{color:#2A5E46;}
.st-footer .save-err{color:#B04A4A;}
.st-footer .btns{display:flex;gap:10px;flex-wrap:wrap;min-width:0;}
.st-footer button{font-family:Inter,sans-serif;font-size:12.5px;font-weight:600;padding:11px 18px;border-radius:7px;cursor:pointer;border:none;min-width:0;}
.st-footer .b-save{background:#ECEAE4;color:#1C1A17;border:1px solid #E4E1DA;}
.st-footer .b-submit{background:#2A5E46;color:#fff;}
.st-footer button:disabled{opacity:0.5;cursor:default;}
.st-locked input,.st-locked select,.st-locked button.st-toggle{pointer-events:none;opacity:0.75;}
@media (max-width:640px){
  .st-topbar{padding:14px 18px;}
  .st-wrap{padding:24px 14px 16px;}
  .st-hero h1{font-size:27px;}
  .st-card{padding:18px 14px;}
  .st-frow{grid-template-columns:1fr 110px;}
  .st-frow.st-added{grid-template-columns:1fr 110px 24px;}
  .st-field-row{grid-template-columns:1fr;}
  .st-footer{padding:12px 14px;}
  .st-footer button{padding:10px 12px;font-size:11.5px;white-space:normal;flex:1;}
  .st-footer .btns{width:100%;}
  .st-footer .status{width:100%;}
}
`
