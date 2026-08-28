'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useConfirm } from '@/components/ConfirmDialog'

// ─── TYPES ───────────────────────────────────────────────────────────────

type PrepStatus = 'draft' | 'submitted' | 'applied'

interface WillPrepRow {
  id: string
  client_id: string
  token: string
  password_hint: string | null
  expires_at: string | null
  status: PrepStatus
  data: Record<string, unknown>
  submitted_at: string | null
  created_at: string
  updated_at: string
}

interface ApplyLogRow {
  id: string
  will_prep_id: string
  previous_value: Record<string, unknown> | null
  reverted_at: string | null
  created_at: string
}

// ─── STYLE TOKENS (matches EstateSection.tsx) ───────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid var(--line)', borderRadius: 14, padding: '20px 24px',
}
const labelSmall: React.CSSProperties = {
  fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)',
}
const inputStyle: React.CSSProperties = {
  background: 'white', border: '1px solid var(--line)', borderRadius: 8,
  padding: '9px 12px', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)',
  outline: 'none', width: '100%', boxSizing: 'border-box' as const,
}

function StatusChip({ status }: { status: PrepStatus }) {
  const map: Record<PrepStatus, { label: string; bg: string; color: string }> = {
    draft: { label: 'Draft — awaiting client', bg: '#F5EFE3', color: '#8A6C3A' },
    submitted: { label: 'Submitted — needs review', bg: '#EAF0F7', color: '#3A5A82' },
    applied: { label: '✓ Applied to record', bg: '#E8F2ED', color: 'var(--emerald)' },
  }
  const s = map[status]
  return (
    <span style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 5, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}

// ─── MAIN PANEL ──────────────────────────────────────────────────────────

export default function WillPrepPanel({ clientId, clientName }: { clientId: string; clientName: string }) {
  const supabase = useMemo(() => createClient(), [])
  const confirmAction = useConfirm()

  const [row, setRow] = useState<WillPrepRow | null>(null)
  const [logs, setLogs] = useState<ApplyLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(false)

  const [genPassword, setGenPassword] = useState('')
  const [genHint, setGenHint] = useState('For security purposes, this document is password-protected. Use the last 4 characters of your NRIC followed by your year of birth (e.g., 567A1980) to access it.')
  const [genExpiry, setGenExpiry] = useState<'7d' | '30d' | 'never'>('30d')
  const [genError, setGenError] = useState('')
  const [showGenForm, setShowGenForm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: prepRow } = await supabase
      .from('estate_will_prep').select('*').eq('client_id', clientId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    setRow((prepRow as WillPrepRow) || null)
    if (prepRow) {
      const { data: logRows } = await supabase
        .from('estate_will_prep_apply_log').select('*')
        .eq('will_prep_id', prepRow.id).order('created_at', { ascending: false })
      setLogs((logRows as ApplyLogRow[]) || [])
    } else {
      setLogs([])
    }
    setLoading(false)
  }, [clientId, supabase])

  useEffect(() => { load() }, [load])

  function flash(msg: string) {
    setNotice(msg)
    setTimeout(() => setNotice(''), 3500)
  }

  function prepUrl(token: string) {
    return `${typeof window !== 'undefined' ? window.location.origin : ''}/will-prep/${token}`
  }

  async function copyLink() {
    if (!row) return
    try {
      await navigator.clipboard.writeText(prepUrl(row.token))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }

  async function generateLink() {
    if (!genPassword.trim()) { setGenError('Set a password for the link.'); return }
    setBusy(true); setGenError('')
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

      if (row && row.status !== 'applied') {
        // Regenerate: same behaviour as Financials — same URL, refreshed
        // password/expiry, and re-opens the draft for editing.
        const { error } = await supabase.from('estate_will_prep')
          .update({ password_hash: hash, password_hint: genHint || null, expires_at: expiresAt, status: 'draft', submitted_at: null, updated_at: new Date().toISOString() })
          .eq('id', row.id)
        if (error) throw error
        flash(`Link for ${clientName} updated — same URL, new password/expiry.`)
      } else {
        const token = crypto.randomUUID().replace(/-/g, '')
        const { error } = await supabase.from('estate_will_prep').insert({
          client_id: clientId, token,
          password_hash: hash, password_hint: genHint || null, expires_at: expiresAt,
          status: 'draft', data: {}, client_name: clientName,
        })
        if (error) throw error
        flash(`Link for ${clientName} created.`)
      }
      setGenPassword('')
      setShowGenForm(false)
      await load()
    } catch (e) {
      console.error('Generate will-prep link failed:', e)
      setGenError('Failed to create the link. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function applyToRecord() {
    if (!row) return
    if (!await confirmAction(
      `Apply ${clientName}'s submitted Will information to their Estate record? This is logged so you can revert it in one step.`,
      { confirmLabel: 'Apply' }
    )) return
    setBusy(true)
    try {
      // Log the previous data before overwriting, so this is revertible —
      // same pattern as financial_statement_apply_log.
      const { error: logError } = await supabase.from('estate_will_prep_apply_log').insert({
        will_prep_id: row.id,
        previous_value: row.data,
      })
      if (logError) throw logError

      const { error } = await supabase.from('estate_will_prep')
        .update({ status: 'applied', updated_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) throw error

      flash('Applied. This is now the working record for Prepare Now.')
      await load()
    } catch (e) {
      console.error('Apply failed:', e)
      flash('Failed to apply. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function revertApply() {
    if (!row || logs.length === 0) return
    const latest = logs.find(l => !l.reverted_at)
    if (!latest) return
    if (!await confirmAction(
      `Revert the last Apply for ${clientName}? This restores the submitted data and marks the link as Submitted again.`,
      { danger: true, confirmLabel: 'Revert' }
    )) return
    setBusy(true)
    try {
      const { error: logError } = await supabase.from('estate_will_prep_apply_log')
        .update({ reverted_at: new Date().toISOString() })
        .eq('id', latest.id)
      if (logError) throw logError

      const { error } = await supabase.from('estate_will_prep')
        .update({ status: 'submitted', data: latest.previous_value || {}, updated_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) throw error

      flash('Reverted.')
      await load()
    } catch (e) {
      console.error('Revert failed:', e)
      flash('Failed to revert. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const activeLog = logs.find(l => !l.reverted_at)

  if (loading) {
    return <div style={cardStyle}><p style={{ fontSize: 12.5, color: 'var(--ink3)' }}>Loading…</p></div>
  }

  return (
    <div style={cardStyle}>
      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17, fontWeight: 500, marginBottom: 4 }}>
        Will Preparation — Client Link
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.55, marginBottom: 16 }}>
        Generates a password-protected link where {clientName} fills in beneficiaries, guardian, executor and asset instructions on their own.
      </p>

      {notice && (
        <div style={{ fontSize: 12, color: 'var(--emerald)', background: '#E8F2ED', borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>{notice}</div>
      )}

      {!row && !showGenForm && (
        <button
          onClick={() => setShowGenForm(true)}
          style={{ width: '100%', fontFamily: 'Inter', fontSize: 12.5, fontWeight: 600, padding: 10, borderRadius: 8, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--cream)', cursor: 'pointer' }}
        >
          Generate link
        </button>
      )}

      {row && row.status !== 'applied' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <span style={{ fontSize: 12.5 }}>Status</span>
            <StatusChip status={row.status} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
            <span style={{ fontSize: 12.5 }}>{row.status === 'submitted' ? 'Submitted' : 'Password hint'}</span>
            <span style={{ fontSize: 12, color: 'var(--ink3)' }}>
              {row.status === 'submitted'
                ? (row.submitted_at ? new Date(row.submitted_at).toLocaleString() : '—')
                : (row.password_hint || '—')}
            </span>
          </div>
          <div style={{ fontFamily: 'Inter', fontSize: 11.5, color: 'var(--ink3)', marginTop: 4, background: 'var(--cream)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prepUrl(row.token)}</span>
            <span onClick={copyLink} style={{ fontSize: 11, fontWeight: 600, color: 'var(--gold)', cursor: 'pointer', flexShrink: 0 }}>{copied ? 'Copied' : 'Copy'}</span>
          </div>
          {row.expires_at && (
            <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 8 }}>
              Expires {new Date(row.expires_at).toLocaleDateString()}
            </p>
          )}

          {row.status === 'submitted' && (
            <button
              disabled={busy}
              onClick={applyToRecord}
              style={{ marginTop: 10, width: '100%', fontFamily: 'Inter', fontSize: 12.5, fontWeight: 600, padding: 10, borderRadius: 8, border: '1px solid var(--emerald)', background: '#E8F2ED', color: 'var(--emerald)', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
            >
              Review &amp; Apply to record
            </button>
          )}

          {!showGenForm && (
            <button
              disabled={busy}
              onClick={() => setShowGenForm(true)}
              style={{ marginTop: 10, width: '100%', fontFamily: 'Inter', fontSize: 12.5, fontWeight: 600, padding: 10, borderRadius: 8, border: '1px solid var(--ink)', background: '#fff', color: 'var(--ink)', cursor: 'pointer' }}
            >
              Resend / regenerate
            </button>
          )}
        </>
      )}

      {row && row.status === 'applied' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <span style={{ fontSize: 12.5 }}>Status</span>
            <StatusChip status="applied" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
            <span style={{ fontSize: 12.5 }}>Applied</span>
            <span style={{ fontSize: 12, color: 'var(--ink3)' }}>{new Date(row.updated_at).toLocaleString()}</span>
          </div>
          <p style={{ fontSize: 11, color: 'var(--ink3)', lineHeight: 1.5, marginTop: 4 }}>
            This is now the working data in "Prepare Now." Read it off from there when you draft with getArrange.
          </p>
          {activeLog && (
            <button
              disabled={busy}
              onClick={revertApply}
              style={{ marginTop: 14, width: '100%', fontFamily: 'Inter', fontSize: 12.5, fontWeight: 600, padding: 10, borderRadius: 8, border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
            >
              Revert this Apply
            </button>
          )}
        </>
      )}

      {showGenForm && (
        <div style={{ marginTop: row ? 16 : 0, paddingTop: row ? 16 : 0, borderTop: row ? '1px solid var(--line)' : 'none' }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ ...labelSmall, display: 'block', marginBottom: 6 }}>Password</label>
            <input style={inputStyle} type="text" value={genPassword} onChange={e => setGenPassword(e.target.value)} placeholder="e.g. S1234567A1990" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ ...labelSmall, display: 'block', marginBottom: 6 }}>Password hint (shown to client)</label>
            <input style={inputStyle} type="text" value={genHint} onChange={e => setGenHint(e.target.value)} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ ...labelSmall, display: 'block', marginBottom: 6 }}>Expires</label>
            <select style={inputStyle} value={genExpiry} onChange={e => setGenExpiry(e.target.value as '7d' | '30d' | 'never')}>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="never">Never</option>
            </select>
          </div>
          {genError && <p style={{ fontSize: 11.5, color: 'var(--rouge)', marginBottom: 10 }}>{genError}</p>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => { setShowGenForm(false); setGenError('') }} style={{ flex: 1, fontFamily: 'Inter', fontSize: 12.5, fontWeight: 600, padding: 10, borderRadius: 8, border: '1px solid var(--line)', background: '#fff', color: 'var(--ink3)', cursor: 'pointer' }}>Cancel</button>
            <button disabled={busy} onClick={generateLink} style={{ flex: 1, fontFamily: 'Inter', fontSize: 12.5, fontWeight: 600, padding: 10, borderRadius: 8, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--cream)', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Creating…' : row ? 'Update link' : 'Create link'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}