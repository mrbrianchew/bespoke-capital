'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useConfirm } from '@/components/ConfirmDialog'

// ─── TYPES — mirrored from src/app/will-prep/[token]/page.tsx ────────────
// Kept in sync manually; the client-facing form is the source of truth for
// this shape. If that file's WillPrepData interface changes, update here too.

interface Person { name: string; relationship: string; idNumber: string; mobile: string }
interface Asset {
  name: string
  identifyingDetail: string
  value: string
  countryState: string
  ownership: 'Sole' | 'Joint' | 'Shared %'
  allocationType: 'none' | 'specific'
  allocation: string
  additionalInstructions: string
}
interface Liability {
  name: string
  identifyingDetail: string
  value: string
  countryState: string
  loanType: 'Sole' | 'Joint' | 'Shared %'
  additionalInstructions: string
}
interface ResidualShare { name: string; pct: string }

interface WillPrepData {
  testatorFullName: string
  testatorIdNo: string
  testatorIdIssuingCountry: string
  testatorCountryOfResidence: string
  testatorAddress: string
  testatorGender: 'Male' | 'Female' | ''
  testatorDob: string
  testatorReligion: string
  testatorMaritalStatus: 'Single' | 'Married' | 'Divorced' | 'Widowed' | ''
  testatorNumChildren: string
  testatorMobile: string
  beneficiaries: Person[]
  guardianClause: 'none' | 'joint' | 'if_no_parent'
  guardian: Person
  subGuardians: Person[]
  executors: Person[]
  subExecutors: Person[]
  assets: Asset[]
  liabilities: Liability[]
  residual: ResidualShare[]
  scope: 'Worldwide' | 'Excluding' | 'Singapore'
  survivorshipDays: string
  lapsedGift: 'redistribute' | 'to_estate'
  minorManager: 'executor' | 'guardian'
  otherInstructions: string
  funeralWishes: string
  finalWords: string
}

type PrepStatus = 'draft' | 'submitted' | 'applied'

interface WillPrepRow {
  id: string
  client_id: string
  client_name: string | null
  token: string
  status: PrepStatus
  data: Partial<WillPrepData>
  submitted_at: string | null
  updated_at: string
}

interface ApplyLogRow {
  id: string
  will_prep_id: string
  previous_value: Record<string, unknown> | null
  reverted_at: string | null
}

// ─── STYLE TOKENS — matches globals.css + WillPrepPanel.tsx ──────────────

const cardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid var(--line)', borderRadius: 4, overflow: 'hidden',
}
const personCardStyle: React.CSSProperties = { ...cardStyle, borderLeft: '3px solid var(--gold)' }
const fieldRow: React.CSSProperties = {
  padding: '13px 20px', borderBottom: '1px solid var(--line)',
  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12,
}
const fieldKey: React.CSSProperties = {
  fontFamily: 'Inter', fontSize: 11, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--ink3)', flexShrink: 0,
}
const fieldVal: React.CSSProperties = { fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)', textAlign: 'right' }
const emptyVal: React.CSSProperties = { ...fieldVal, color: 'var(--rouge)', fontStyle: 'italic', fontSize: 12 }
const secDividerLabel: React.CSSProperties = {
  fontFamily: 'Inter', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, whiteSpace: 'nowrap',
}
const warnBox: React.CSSProperties = {
  margin: '0 20px 16px', background: 'var(--rouge-l)', borderLeft: '3px solid var(--rouge)', borderRadius: 3,
  padding: '10px 14px', fontFamily: 'Inter', fontSize: 12, color: 'var(--rouge)', lineHeight: 1.5,
}

function SectionDivider({ label, flagged }: { label: string; flagged?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '32px 0 14px' }}>
      <span style={{ ...secDividerLabel, color: flagged ? 'var(--rouge)' : 'var(--gold)' }}>{label}{flagged ? ' ⚑' : ''}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  )
}

function Field({ k, v, empty }: { k: string; v: string; empty?: boolean }) {
  return (
    <div style={fieldRow}>
      <span style={fieldKey}>{k}</span>
      <span style={empty ? emptyVal : fieldVal}>{empty ? 'Not provided' : v}</span>
    </div>
  )
}

function money(v: string): string {
  const n = Number(String(v || '0').replace(/[^0-9.-]/g, ''))
  if (!n) return 'S$ 0'
  return `S$ ${n.toLocaleString('en-SG')}`
}

// ─── MAIN PAGE ─────────────────────────────────────────────────────────

export default function WillPrepReviewPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string
  const supabase = useMemo(() => createClient(), [])
  const confirmAction = useConfirm()

  const [row, setRow] = useState<WillPrepRow | null>(null)
  const [logs, setLogs] = useState<ApplyLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data: prepRow, error: rowError } = await supabase
      .from('estate_will_prep').select('*').eq('id', id).maybeSingle()
    if (rowError || !prepRow) {
      setError('Submission not found, or you do not have access to it.')
      setLoading(false)
      return
    }
    setRow(prepRow as WillPrepRow)
    const { data: logRows } = await supabase
      .from('estate_will_prep_apply_log').select('*')
      .eq('will_prep_id', prepRow.id).order('created_at', { ascending: false })
    setLogs((logRows as ApplyLogRow[]) || [])
    setLoading(false)
  }, [id, supabase])

  useEffect(() => { if (id) load() }, [id, load])

  async function applyToRecord() {
    if (!row) return
    if (!await confirmAction(
      `Apply ${row.client_name || 'this client'}'s submitted Will information to their Estate record? This is logged so you can revert it in one step.`,
      { confirmLabel: 'Apply' }
    )) return
    setBusy(true)
    try {
      const { error: logError } = await supabase.from('estate_will_prep_apply_log').insert({
        will_prep_id: row.id,
        previous_value: row.data,
      })
      if (logError) throw logError

      const { error: updError } = await supabase.from('estate_will_prep')
        .update({ status: 'applied', updated_at: new Date().toISOString() })
        .eq('id', row.id)
      if (updError) throw updError

      await load()
    } catch (e) {
      console.error('Apply failed:', e)
      setError('Failed to apply. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div style={{ padding: 40, fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)' }}>Loading submission…</div>
  }
  if (error || !row) {
    return (
      <div style={{ padding: 40 }}>
        <p style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--rouge)', marginBottom: 16 }}>{error || 'Submission not found.'}</p>
        <button onClick={() => router.back()} style={{ fontFamily: 'Inter', fontSize: 12.5, fontWeight: 600, padding: '9px 16px', borderRadius: 7, border: '1px solid var(--ink)', background: '#fff', color: 'var(--ink)', cursor: 'pointer' }}>
          ← Back
        </button>
      </div>
    )
  }

  const d = row.data || {}
  const clientName = row.client_name || 'Client'

  // ── Validation flags ──
  const residual = d.residual || []
  const residualTotal = residual.reduce((sum, r) => sum + (Number(r.pct) || 0), 0)
  const residualFlag = residual.length > 0 && Math.round(residualTotal) !== 100
  const hasSubExecutor = (d.subExecutors || []).some(p => p.name?.trim())
  const executorFlag = !hasSubExecutor
  const anyFlag = residualFlag

  return (
    <div style={{ padding: '32px 40px', maxWidth: 900 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
        <div>
          <button onClick={() => router.back()} style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 10 }}>
            ← Back to Estate Planning
          </button>
          <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 600, margin: 0 }}>
            {clientName} — Will Preparation
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
          {row.status !== 'applied' && (
            <button
              disabled={busy}
              onClick={applyToRecord}
              style={{ fontFamily: 'Inter', fontSize: 12.5, fontWeight: 600, padding: '10px 18px', borderRadius: 7, border: '1px solid var(--charcoal)', background: 'var(--charcoal)', color: '#fff', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
            >
              {busy ? 'Applying…' : 'Apply to record'}
            </button>
          )}
        </div>
      </div>

      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 8px' }}>
        <span style={{
          fontFamily: 'Inter', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '4px 11px', borderRadius: 5,
          background: row.status === 'applied' ? 'var(--emerald-l)' : '#EAF0F7',
          color: row.status === 'applied' ? 'var(--emerald)' : '#3A5A82',
        }}>
          {row.status === 'applied' ? '✓ Applied to record' : 'Submitted — needs review'}
        </span>
        {anyFlag && (
          <span style={{ fontFamily: 'Inter', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '4px 11px', borderRadius: 5, background: 'var(--rouge-l)', color: 'var(--rouge)' }}>
            ⚑ {[residualFlag].filter(Boolean).length} flag
          </span>
        )}
        <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>
          Submitted {row.submitted_at ? new Date(row.submitted_at).toLocaleString() : '—'}
        </span>
      </div>

      {error && <p style={{ fontFamily: 'Inter', fontSize: 12.5, color: 'var(--rouge)', marginTop: 8 }}>{error}</p>}

      {/* Testator */}
      <SectionDivider label="Testator's Personal Details" />
      <div style={cardStyle}>
        <Field k="Full name" v={d.testatorFullName || ''} empty={!d.testatorFullName} />
        <Field k="NRIC / FIN / Passport" v={d.testatorIdNo || ''} empty={!d.testatorIdNo} />
        <Field k="Issuing country" v={d.testatorIdIssuingCountry || ''} empty={!d.testatorIdIssuingCountry} />
        <Field k="Country of residence" v={d.testatorCountryOfResidence || ''} empty={!d.testatorCountryOfResidence} />
        <Field k="Address" v={d.testatorAddress || ''} empty={!d.testatorAddress} />
        <Field k="Gender" v={d.testatorGender || ''} empty={!d.testatorGender} />
        <Field k="Date of birth" v={d.testatorDob || ''} empty={!d.testatorDob} />
        <Field k="Religion" v={d.testatorReligion || ''} empty={!d.testatorReligion} />
        <Field k="Marital status" v={d.testatorMaritalStatus || ''} empty={!d.testatorMaritalStatus} />
        <Field k="Number of children" v={d.testatorNumChildren || ''} empty={!d.testatorNumChildren} />
        <Field k="Mobile" v={d.testatorMobile || ''} empty={!d.testatorMobile} />
      </div>

      {/* Beneficiaries */}
      <SectionDivider label="Beneficiaries" />
      {(d.beneficiaries || []).filter(p => p.name?.trim()).length === 0 && (
        <div style={cardStyle}><Field k="Beneficiaries" v="" empty /></div>
      )}
      {(d.beneficiaries || []).filter(p => p.name?.trim()).map((p, i) => (
        <div key={i} style={{ ...personCardStyle, marginTop: i > 0 ? 14 : 0 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17, fontWeight: 600 }}>{p.name}</span>
            <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--gold-tag)', fontWeight: 600 }}>{p.relationship || '—'}</span>
          </div>
          <Field k="NRIC / FIN" v={p.idNumber} empty={!p.idNumber} />
          <Field k="Mobile" v={p.mobile} empty={!p.mobile} />
        </div>
      ))}

      {/* Guardian */}
      <SectionDivider label="Guardian" />
      <div style={cardStyle}>
        <Field k="Clause" v={
          d.guardianClause === 'joint' ? 'Guardian and spouse act jointly'
          : d.guardianClause === 'if_no_parent' ? 'Only if no surviving parent'
          : d.guardianClause === 'none' ? 'No guardian clause'
          : ''
        } empty={!d.guardianClause} />
        <Field k="Guardian" v={d.guardian?.name || ''} empty={!d.guardian?.name} />
        <Field k="Relationship" v={d.guardian?.relationship || ''} empty={!d.guardian?.relationship} />
        <Field k="NRIC / FIN" v={d.guardian?.idNumber || ''} empty={!d.guardian?.idNumber} />
        <Field k="Mobile" v={d.guardian?.mobile || ''} empty={!d.guardian?.mobile} />
      </div>
      {(d.subGuardians || []).filter(p => p.name?.trim()).length === 0 ? (
        <div style={{ ...cardStyle, marginTop: 14 }}><Field k="Substitute guardian" v="" empty /></div>
      ) : (d.subGuardians || []).filter(p => p.name?.trim()).map((p, i) => (
        <div key={i} style={{ ...cardStyle, marginTop: 14 }}>
          <Field k={`Substitute guardian ${i + 1}`} v={p.name} />
          <Field k="NRIC / FIN" v={p.idNumber} empty={!p.idNumber} />
        </div>
      ))}

      {/* Executors */}
      <SectionDivider label="Executor" flagged={executorFlag} />
      {(d.executors || []).filter(p => p.name?.trim()).length === 0 && (
        <div style={cardStyle}><Field k="Executor" v="" empty /></div>
      )}
      {(d.executors || []).filter(p => p.name?.trim()).map((p, i) => (
        <div key={i} style={{ ...cardStyle, marginTop: i > 0 ? 14 : 0 }}>
          <Field k="Executor" v={p.name} />
          <Field k="Relationship" v={p.relationship} empty={!p.relationship} />
          <Field k="NRIC / FIN" v={p.idNumber} empty={!p.idNumber} />
          <Field k="Mobile" v={p.mobile} empty={!p.mobile} />
        </div>
      ))}
      {executorFlag && (
        <div style={{ ...warnBox, margin: '14px 0 0' }}>
          No substitute executor named — if the primary executor cannot act, there's no backup on this submission. Confirm with the client before drafting.
        </div>
      )}

      {/* Assets */}
      <SectionDivider label="Assets" />
      <div style={cardStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Inter', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink3)', textAlign: 'left', padding: '11px 20px', borderBottom: '1px solid var(--line)', background: 'var(--cream)' }}>Asset</th>
              <th style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink3)', textAlign: 'left', padding: '11px 20px', borderBottom: '1px solid var(--line)', background: 'var(--cream)' }}>Ownership / Allocation</th>
              <th style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink3)', textAlign: 'right', padding: '11px 20px', borderBottom: '1px solid var(--line)', background: 'var(--cream)' }}>Value</th>
            </tr>
          </thead>
          <tbody>
            {(d.assets || []).filter(a => a.name?.trim()).length === 0 && (
              <tr><td colSpan={3} style={{ padding: '12px 20px', color: 'var(--rouge)', fontStyle: 'italic', fontSize: 12 }}>Not provided</td></tr>
            )}
            {(d.assets || []).filter(a => a.name?.trim()).map((a, i) => (
              <tr key={i}>
                <td style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)' }}>{a.name}{a.identifyingDetail ? ` — ${a.identifyingDetail}` : ''}</td>
                <td style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', color: 'var(--ink3)' }}>
                  {a.ownership}{a.allocationType === 'specific' && a.allocation ? ` · Specific gift: ${a.allocation}` : ''}
                </td>
                <td style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>{money(a.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Liabilities */}
      <SectionDivider label="Liabilities" />
      <div style={cardStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Inter', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink3)', textAlign: 'left', padding: '11px 20px', borderBottom: '1px solid var(--line)', background: 'var(--cream)' }}>Liability</th>
              <th style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink3)', textAlign: 'left', padding: '11px 20px', borderBottom: '1px solid var(--line)', background: 'var(--cream)' }}>Loan type</th>
              <th style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink3)', textAlign: 'right', padding: '11px 20px', borderBottom: '1px solid var(--line)', background: 'var(--cream)' }}>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {(d.liabilities || []).filter(l => l.name?.trim()).length === 0 && (
              <tr><td colSpan={3} style={{ padding: '12px 20px', color: 'var(--rouge)', fontStyle: 'italic', fontSize: 12 }}>Not provided</td></tr>
            )}
            {(d.liabilities || []).filter(l => l.name?.trim()).map((l, i) => (
              <tr key={i}>
                <td style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)' }}>{l.name}{l.identifyingDetail ? ` — ${l.identifyingDetail}` : ''}</td>
                <td style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', color: 'var(--ink3)' }}>{l.loanType}</td>
                <td style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>{money(l.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Residual */}
      <SectionDivider label="Residual Allocation" flagged={residualFlag} />
      <div style={cardStyle}>
        {residual.filter(r => r.name?.trim()).length === 0 ? (
          <Field k="Residual allocation" v="" empty />
        ) : residual.filter(r => r.name?.trim()).map((r, i) => (
          <Field key={i} k={r.name} v={`${r.pct || 0}%`} />
        ))}
        {residualFlag && (
          <div style={warnBox}>
            Allocated shares total {residualTotal}%, not 100% — confirm the remaining {Math.max(0, 100 - residualTotal)}% with the client before drafting.
          </div>
        )}
      </div>

      {/* Clauses */}
      <SectionDivider label="Clauses" />
      <div style={cardStyle}>
        <Field k="Estate scope" v={d.scope || ''} empty={!d.scope} />
        <Field k="Survivorship period" v={d.survivorshipDays ? `${d.survivorshipDays} days` : ''} empty={!d.survivorshipDays} />
        <Field k="Lapsed gift" v={d.lapsedGift === 'redistribute' ? 'Redistribute among other beneficiaries' : d.lapsedGift === 'to_estate' ? 'Falls into residual estate' : ''} empty={!d.lapsedGift} />
        <Field k="Minor asset manager" v={d.minorManager === 'executor' ? 'Executor' : d.minorManager === 'guardian' ? 'Guardian' : ''} empty={!d.minorManager} />
      </div>

      {/* Instructions */}
      <SectionDivider label="Additional Instructions" />
      <div style={cardStyle}>
        <p style={{ fontFamily: 'Inter', fontSize: 11, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--ink3)', padding: '14px 20px 0' }}>Funeral wishes</p>
        {d.funeralWishes ? (
          <div style={{ margin: '10px 20px 18px', background: 'var(--cream)', border: '1px solid var(--line)', borderRadius: 3, padding: '12px 14px', fontFamily: 'Inter', fontSize: 13, lineHeight: 1.6 }}>{d.funeralWishes}</div>
        ) : (
          <div style={{ padding: '8px 20px 18px' }}><span style={emptyVal}>Not provided</span></div>
        )}
        <p style={{ fontFamily: 'Inter', fontSize: 11, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--ink3)', padding: '0 20px' }}>Final words / other instructions</p>
        {(d.finalWords || d.otherInstructions) ? (
          <div style={{ margin: '10px 20px 18px', background: 'var(--cream)', border: '1px solid var(--line)', borderRadius: 3, padding: '12px 14px', fontFamily: 'Inter', fontSize: 13, lineHeight: 1.6 }}>
            {[d.otherInstructions, d.finalWords].filter(Boolean).join(' — ')}
          </div>
        ) : (
          <div style={{ padding: '8px 20px 18px' }}><span style={emptyVal}>Not provided</span></div>
        )}
      </div>

      {/* Bottom actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 32, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
        <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>
          {row.status === 'applied'
            ? 'This is now the working data for Prepare Now. Read it off from here when drafting with getArrange.'
            : 'Applying writes to estate_will_prep_apply_log so this can be reverted in one step.'}
        </span>
        {row.status !== 'applied' && (
          <button
            disabled={busy}
            onClick={applyToRecord}
            style={{ fontFamily: 'Inter', fontSize: 12.5, fontWeight: 600, padding: '10px 18px', borderRadius: 7, border: '1px solid var(--charcoal)', background: 'var(--charcoal)', color: '#fff', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Applying…' : 'Apply to record'}
          </button>
        )}
      </div>
    </div>
  )
}