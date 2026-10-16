'use client'

// Annual Reviews tab (Financials page).
//
// Step 2: history of dated, LOCKED versions of the client's Fact Finding, plus
// "Save annual review", which stores a frozen copy of the live plan under an
// as-at month. Versions live in `fact_finding_versions` (see
// migrations/20261014_fact_finding_versions.sql). This tab never writes to
// `fact_finding`, so it cannot change the live plan.
//
// Per version: View (opens that version read-only across the Fact Finding screens,
// handled by the page via onOpen), Delete (needs the delete
// policy from migrations/20261015_fact_finding_versions_delete.sql), and
// "Replace with current plan" (delete + re-insert under the same month; the
// saved data itself is never edited in place, the DB trigger forbids it).
//
// "Add past record" creates a kind 'earlier' record (copied from the closest saved
// version) and the page opens it for editing. Only 'earlier' records can have their
// figures edited (the DB trigger allows it for them alone). "Save annual review"
// still only takes the latest month or later: today's figures must never be saved
// under an old date.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useConfirm } from '@/components/ConfirmDialog'
import GrowthPanel from './GrowthPanel'
import ReviewInsights from './ReviewInsights'
import { replaceVersionWithPlan } from '@/lib/replaceVersion'

type Kind = 'initial' | 'review' | 'earlier'

interface VersionRow {
  id: string
  as_at: string // 'YYYY-MM-01'
  kind: Kind
  note: string | null
  created_at: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const KIND_LABEL: Record<Kind, string> = {
  initial: 'Initial plan',
  review: 'Annual review',
  earlier: 'Earlier record',
}

function parseAsAt(s: string): { y: number; m: number } {
  const [y, m] = s.split('-')
  return { y: Number(y), m: Number(m) - 1 }
}
const fmtAsAt = (s: string) => {
  const { y, m } = parseAsAt(s)
  return `${MONTHS[m]} ${y}`
}
const toAsAt = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}-01`

// Current month in Singapore time, so the default is right around midnight too.
function currentMonthSG(): { y: number; m: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  const y = Number(parts.find(p => p.type === 'year')?.value)
  const m = Number(parts.find(p => p.type === 'month')?.value) - 1
  return { y, m }
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--line)', padding: 24, marginBottom: 20 }
const field: React.CSSProperties = { border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }
const btnPrimary: React.CSSProperties = { background: 'var(--ink)', color: '#fff', border: 'none', padding: '9px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }
const btnSm: React.CSSProperties = { background: 'transparent', color: 'var(--ink2)', border: '1px solid var(--line2)', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }
const pill = (bg: string, fg: string): React.CSSProperties => ({ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 8px', background: bg, color: fg })

export default function AnnualReviewsTab({ clientId, ff, userId, viewingId, onOpen, onChanged }: {
  clientId: string
  ff: Record<string, unknown> | null // always the LIVE plan
  userId?: string
  viewingId?: string | null
  onOpen?: (id: string | null, edit?: boolean) => void
  onChanged?: (affectedId?: string) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const confirmAction = useConfirm()

  const [rows, setRows] = useState<VersionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const now = currentMonthSG()
  const [m, setM] = useState(now.m)
  const [y, setY] = useState(now.y)
  const [note, setNote] = useState('')

  // "Add past record"
  const [pm, setPm] = useState(11)
  const [py, setPy] = useState(now.y - 1)
  const [pnote, setPnote] = useState('')

  const [editId, setEditId] = useState<string | null>(null)
  const [editM, setEditM] = useState(0)
  const [editY, setEditY] = useState(now.y)
  const [editNote, setEditNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const { data, error: err } = await supabase
      .from('fact_finding_versions')
      .select('id, as_at, kind, note, created_at')
      .eq('client_id', clientId)
      .eq('section', 'financials')
      .order('as_at', { ascending: false })
    if (err) setLoadError('Could not load the history. Please refresh the page.')
    setRows((data as VersionRow[] | null) || [])
    setLoading(false)
  }, [clientId, supabase])

  useEffect(() => { load() }, [load])

  function flash(msg: string) {
    setNotice(msg)
    setTimeout(() => setNotice(''), 4000)
  }

  // v-numbers are display order only (oldest = v1); identity is the as-at month.
  const vNumber = (row: VersionRow) => rows.length - rows.findIndex(r => r.id === row.id)
  const latest = rows[0]
  const years = useMemo(() => {
    const out: number[] = []
    for (let yr = now.y; yr >= now.y - 30; yr--) out.push(yr)
    return out
  }, [now.y])

  const isDuplicateError = (e: { code?: string } | null) => e?.code === '23505'

  async function saveReview() {
    setError(''); setNotice('')
    const asAt = toAsAt(y, m)
    if (y > now.y || (y === now.y && m > now.m)) { setError('The as-at month cannot be in the future.'); return }
    if (rows.some(r => r.as_at === asAt)) {
      setError(`There is already a record for ${fmtAsAt(asAt)}. Pick a later month, or correct that record's date in the list below.`)
      return
    }
    if (latest && asAt < latest.as_at) {
      setError(`Choose ${fmtAsAt(latest.as_at)} or later. Entering earlier years comes in a later step, because each past year needs its own figures.`)
      return
    }
    if (!ff) { setError('The plan is still loading. Please try again in a moment.'); return }
    const ok = await confirmAction(
      `Save the current plan as the ${fmtAsAt(asAt)} annual review? It becomes a locked record: its figures cannot be changed afterwards (only its date and note).`,
      { confirmLabel: 'Save review' },
    )
    if (!ok) return

    setBusy(true)
    // Frozen copy of exactly what the plan screens hold right now.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { client_id: _omit, ...planData } = ff
    const data = JSON.parse(JSON.stringify(planData))
    const { error: err } = await supabase.from('fact_finding_versions').insert({
      client_id: clientId,
      section: 'financials',
      as_at: asAt,
      kind: rows.length === 0 ? 'initial' : 'review',
      note: note.trim() || null,
      data,
      created_by: userId || null,
    })
    setBusy(false)
    if (err) {
      setError(isDuplicateError(err) ? `There is already a record for ${fmtAsAt(asAt)}.` : 'Could not save. Nothing was changed. Please try again.')
      return
    }
    setNote('')
    flash(`${fmtAsAt(asAt)} annual review saved.`)
    load()
    onChanged?.()
  }

  // From the Growth chart: save the live plan as this month's record. If this month
  // already has a record, its figures are replaced (date, kind and note stay).
  async function saveNow() {
    setError(''); setNotice('')
    if (!ff) { setError('The plan is still loading. Please try again in a moment.'); return }
    const asAt = toAsAt(now.y, now.m)
    const existing = rows.find(r => r.as_at === asAt)
    if (latest && asAt < latest.as_at) { setError('A record later than this month already exists.'); return }
    const ok = await confirmAction(
      existing
        ? `Update the ${fmtAsAt(asAt)} record with the plan as it is now? Its old figures are overwritten. Date and note are kept.`
        : `Save the plan as it is now as the ${fmtAsAt(asAt)} review record? Its figures cannot be changed afterwards (only its date and note).`,
      { confirmLabel: existing ? 'Update record' : 'Save record', danger: !!existing },
    )
    if (!ok) return
    setBusy(true)
    if (existing) {
      const res = await replaceVersionWithPlan(supabase, clientId, existing.id, userId)
      setBusy(false)
      if (!res.ok) { setError(res.message); return }
      flash(`${fmtAsAt(asAt)} record updated.`)
      load(); onChanged?.(existing.id)
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { client_id: _omit, ...planData } = ff
    const { error: err } = await supabase.from('fact_finding_versions').insert({
      client_id: clientId, section: 'financials', as_at: asAt, kind: rows.length === 0 ? 'initial' : 'review',
      note: null, data: JSON.parse(JSON.stringify(planData)), created_by: userId || null,
    })
    setBusy(false)
    if (err) { setError(isDuplicateError(err) ? `There is already a record for ${fmtAsAt(asAt)}.` : 'Could not save. Nothing was changed. Please try again.'); return }
    flash(`${fmtAsAt(asAt)} review record saved.`)
    load(); onChanged?.()
  }

  // Past record: starts from the closest saved version (the nearest one before that
  // month, else the earliest one after it), kind 'earlier', then opens it for editing.
  async function addPastRecord() {
    setError(''); setNotice('')
    const asAt = toAsAt(py, pm)
    if (!latest) { setError('Save the first version of the plan before adding past records.'); return }
    if (rows.some(r => r.as_at === asAt)) { setError(`There is already a record for ${fmtAsAt(asAt)}. Open it from the list below.`); return }
    if (asAt >= latest.as_at) { setError(`A past record must be earlier than your latest record (${fmtAsAt(latest.as_at)}). For a later month, use Save annual review.`); return }
    const source = rows.find(r => r.as_at < asAt) || rows[rows.length - 1]
    setBusy(true)
    const { data: src, error: srcErr } = await supabase.from('fact_finding_versions').select('data').eq('id', source.id).single()
    if (srcErr || !src) { setBusy(false); setError('Could not read the record to start from. Nothing was changed.'); return }
    const { data: created, error: insErr } = await supabase.from('fact_finding_versions').insert({
      client_id: clientId, section: 'financials', as_at: asAt, kind: 'earlier', note: pnote.trim() || null,
      data: JSON.parse(JSON.stringify((src as { data: unknown }).data)), created_by: userId || null,
    }).select('id').single()
    setBusy(false)
    if (insErr || !created) {
      setError(isDuplicateError(insErr) ? `There is already a record for ${fmtAsAt(asAt)}.` : 'Could not create the record. Nothing was changed.')
      return
    }
    setPnote('')
    load()
    onChanged?.()
    onOpen?.((created as { id: string }).id, true)
  }

  function startEdit(row: VersionRow) {
    const p = parseAsAt(row.as_at)
    setEditId(row.id); setEditM(p.m); setEditY(p.y); setEditNote(row.note || ''); setError('')
  }

  async function saveEdit(row: VersionRow) {
    setError(''); setNotice('')
    const asAt = toAsAt(editY, editM)
    if (editY > now.y || (editY === now.y && editM > now.m)) { setError('The as-at month cannot be in the future.'); return }
    if (rows.some(r => r.id !== row.id && r.as_at === asAt)) { setError(`There is already a record for ${fmtAsAt(asAt)}.`); return }
    setBusy(true)
    const { error: err } = await supabase
      .from('fact_finding_versions')
      .update({ as_at: asAt, note: editNote.trim() || null })
      .eq('id', row.id)
    setBusy(false)
    if (err) {
      setError(isDuplicateError(err) ? `There is already a record for ${fmtAsAt(asAt)}.` : 'Could not save the correction. Please try again.')
      return
    }
    setEditId(null)
    flash('Record updated.')
    load()
    onChanged?.(row.id)
  }

  async function deleteVersion(row: VersionRow) {
    setError(''); setNotice('')
    const ok = await confirmAction(
      `Delete the ${fmtAsAt(row.as_at)} record (v${vNumber(row)})? This removes the saved copy permanently. Your live plan is not affected.`,
      { confirmLabel: 'Delete record', danger: true },
    )
    if (!ok) return
    setBusy(true)
    const { data, error: err } = await supabase.from('fact_finding_versions').delete().eq('id', row.id).select('id')
    setBusy(false)
    if (err) { setError('Could not delete. Nothing was changed. Please try again.'); return }
    if (!data || data.length === 0) {
      setError('Delete is not switched on yet. Run the delete SQL in Supabase once (see the instructions), then try again.')
      return
    }
    flash(`${fmtAsAt(row.as_at)} record deleted.`)
    load()
    onChanged?.(row.id)
  }

  async function replaceWithCurrent(row: VersionRow) {
    setError(''); setNotice('')
    if (!ff) { setError('The plan is still loading. Please try again in a moment.'); return }
    const ok = await confirmAction(
      `Replace the saved figures of the ${fmtAsAt(row.as_at)} record with the plan as it is now? The old figures of this record are overwritten. Date and note are kept.`,
      { confirmLabel: 'Replace figures', danger: true },
    )
    if (!ok) return
    setBusy(true)
    // Keep the old row in hand so a failed re-insert can be put back.
    const { data: old, error: readErr } = await supabase.from('fact_finding_versions')
      .select('client_id, section, as_at, kind, note, data, created_by').eq('id', row.id).single()
    if (readErr || !old) { setBusy(false); setError('Could not read the record. Nothing was changed.'); return }
    const { data: del, error: delErr } = await supabase.from('fact_finding_versions').delete().eq('id', row.id).select('id')
    if (delErr || !del || del.length === 0) {
      setBusy(false)
      setError(delErr ? 'Could not replace. Nothing was changed.' : 'Delete is not switched on yet. Run the delete SQL in Supabase once, then try again.')
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { client_id: _omit, ...planData } = ff
    const { error: insErr } = await supabase.from('fact_finding_versions').insert({
      client_id: old.client_id, section: old.section, as_at: old.as_at, kind: old.kind, note: old.note,
      data: JSON.parse(JSON.stringify(planData)), created_by: userId || old.created_by,
    })
    if (insErr) {
      await supabase.from('fact_finding_versions').insert(old) // restore the original
      setBusy(false)
      setError('Could not replace. The original record was restored.')
      load()
      return
    }
    setBusy(false)
    flash(`${fmtAsAt(row.as_at)} record replaced with the current plan.`)
    load()
    onChanged?.(row.id)
  }

  return (
    <div style={{ maxWidth: 920 }}>
      {notice && (
        <div style={{ background: '#E8F2ED', border: '1px solid #C9E0D6', color: '#1E4536', fontSize: 12, padding: '10px 14px', marginBottom: 16 }}>{notice}</div>
      )}
      {error && (
        <div style={{ background: '#F2EAEA', border: '1px solid #E3CACA', color: '#7A2323', fontSize: 12, padding: '10px 14px', marginBottom: 16 }}>{error}</div>
      )}

      {/* ---------- Growth (real figures from saved records) ---------- */}
      {!loading && rows.length > 0 && <ReviewInsights clientId={clientId} refreshKey={rows.map(r => `${r.id}:${r.as_at}`).join('|')} live={ff} />}
      {!loading && rows.length > 0 && <GrowthPanel clientId={clientId} refreshKey={rows.map(r => `${r.id}:${r.as_at}`).join('|')} live={ff} onSaveNow={saveNow} busy={busy} />}

      {/* ---------- Save annual review ---------- */}
      {viewingId ? (
        <div style={{ ...card, fontSize: 13, color: 'var(--ink2)', lineHeight: 1.6 }}>
          You are viewing a saved record. Go back to the current plan before saving a new review.
          <button type="button" style={{ ...btnSm, marginLeft: 12 }} onClick={() => onOpen?.(null)}>Back to current plan</button>
        </div>
      ) : (
      <>
      <div style={card}>
        <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--ink3)' }}>Save annual review</div>
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 16, lineHeight: 1.6, maxWidth: 640 }}>
          Update the plan on the other tabs as usual. When the review with your client is done, save it here.
          This stores a locked copy of the plan as it is now. Your live plan stays editable and is not changed.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>As at</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={m} onChange={e => setM(Number(e.target.value))} aria-label="As at month" className="text-sm px-2 py-1.5 outline-none" style={field}>
                {MONTHS.map((mm, i) => <option key={mm} value={i}>{mm}</option>)}
              </select>
              <select value={y} onChange={e => setY(Number(e.target.value))} aria-label="As at year" className="text-sm px-2 py-1.5 outline-none" style={field}>
                {years.map(yr => <option key={yr} value={yr}>{yr}</option>)}
              </select>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Note (optional)</div>
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder="e.g. Income and CPF balances updated"
              className="text-sm px-2 py-1.5 outline-none w-full" style={field} />
          </div>
          <button type="button" style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy || !ff} onClick={saveReview}>
            {busy ? 'Saving…' : 'Save annual review'}
          </button>
        </div>
      </div>

      {/* ---------- Add past record ---------- */}
      {latest && (
        <div style={card}>
          <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--ink3)' }}>Add past record</div>
          <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 16, lineHeight: 1.6, maxWidth: 640 }}>
            For an earlier year. The record starts as a copy of the closest saved version, then you correct the figures on the usual tabs.
            It saves to that record only; your current plan is not changed.
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>As at</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={pm} onChange={e => setPm(Number(e.target.value))} aria-label="Past record month" className="text-sm px-2 py-1.5 outline-none" style={field}>
                  {MONTHS.map((mm, i) => <option key={mm} value={i}>{mm}</option>)}
                </select>
                <select value={py} onChange={e => setPy(Number(e.target.value))} aria-label="Past record year" className="text-sm px-2 py-1.5 outline-none" style={field}>
                  {years.map(yr => <option key={yr} value={yr}>{yr}</option>)}
                </select>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>Note (optional)</div>
              <input value={pnote} onChange={e => setPnote(e.target.value)} maxLength={200} placeholder="e.g. From the 2019 Excel sheet"
                className="text-sm px-2 py-1.5 outline-none w-full" style={field} />
            </div>
            <button type="button" style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={addPastRecord}>
              {busy ? 'Creating…' : 'Create and edit'}
            </button>
          </div>
        </div>
      )}
      </>
      )}

      {/* ---------- History ---------- */}
      <div style={{ ...card, padding: 0 }}>
        <div style={{ padding: '20px 24px 12px' }}>
          <div className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink3)' }}>Plan history</div>
        </div>
        {loading ? (
          <div style={{ padding: '8px 24px 24px', fontSize: 12, color: 'var(--ink3)' }}>Loading…</div>
        ) : loadError ? (
          <div style={{ padding: '8px 24px 24px', fontSize: 12, color: '#7A2323' }}>{loadError}</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '8px 24px 24px', fontSize: 13, color: 'var(--ink2)', lineHeight: 1.6 }}>
            No saved versions yet. Fill in the plan on the other tabs, then save the first one above.
          </div>
        ) : (
          rows.map((row, idx) => {
            const editing = editId === row.id
            return (
              <div key={row.id} style={{ borderTop: '1px solid var(--line)' }}>
              <div style={{ padding: '14px 24px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ width: 36, fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--ink3)' }}>v{vNumber(row)}</div>
                {editing ? (
                  <>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select value={editM} onChange={e => setEditM(Number(e.target.value))} aria-label="As at month" className="text-sm px-2 py-1 outline-none" style={field}>
                        {MONTHS.map((mm, i) => <option key={mm} value={i}>{mm}</option>)}
                      </select>
                      <select value={editY} onChange={e => setEditY(Number(e.target.value))} aria-label="As at year" className="text-sm px-2 py-1 outline-none" style={field}>
                        {years.map(yr => <option key={yr} value={yr}>{yr}</option>)}
                      </select>
                    </div>
                    <input value={editNote} onChange={e => setEditNote(e.target.value)} maxLength={200} aria-label="Note"
                      className="text-sm px-2 py-1 outline-none" style={{ ...field, flex: 1, minWidth: 180 }} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" style={btnPrimary} disabled={busy} onClick={() => saveEdit(row)}>Save</button>
                      <button type="button" style={btnSm} onClick={() => setEditId(null)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-serif" style={{ fontSize: 18, color: 'var(--ink)', minWidth: 90 }}>{fmtAsAt(row.as_at)}</div>
                    <span style={row.kind === 'review' ? pill('#F5EFE3', '#8A6C3A') : pill('#ECEAE4', '#4A4740')}>{KIND_LABEL[row.kind]}</span>
                    {idx === 0 && <span style={pill('#E8F2ED', '#2A5E46')}>Current</span>}
                    <div style={{ flex: 1, minWidth: 160, fontSize: 13, color: 'var(--ink2)' }}>{row.note || ''}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" style={btnSm} onClick={() => onOpen?.(viewingId === row.id ? null : row.id)}>{viewingId === row.id ? 'Back to current' : 'View'}</button>
                      {row.kind === 'earlier' && (
                        <button type="button" style={btnSm} onClick={() => onOpen?.(row.id, true)}>Edit figures</button>
                      )}
                      <button type="button" style={btnSm} onClick={() => startEdit(row)}>Correct date / note</button>
                      {row.kind !== 'earlier' && (
                        <button type="button" style={btnSm} disabled={busy} onClick={() => replaceWithCurrent(row)}>Replace with current plan</button>
                      )}
                      <button type="button" style={{ ...btnSm, color: 'var(--rouge)', borderColor: 'var(--rouge)' }} disabled={busy} onClick={() => deleteVersion(row)}>Delete</button>
                    </div>
                  </>
                )}
              </div>
              </div>
            )
          })
        )}
        <div style={{ padding: '12px 24px 16px', borderTop: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink3)', lineHeight: 1.6 }}>
          Saved annual reviews are locked: View opens one read-only across the Fact Finding tabs, and you can correct its date and note, replace its figures with the current plan, or delete it. Past records you add stay editable (Edit figures). The first version of each existing client was created automatically from their plan and dated to the month it was last saved, so correct that date if it is not the real as-at month.
        </div>
      </div>
    </div>
  )
}