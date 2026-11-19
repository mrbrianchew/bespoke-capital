'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useDashboard } from '@/contexts/DashboardContext'
import DateInput from '@/components/DateInput'
import { useDriveUpload } from '@/lib/useDriveUpload'
import { useToast } from '@/components/Toast'
import { useConfirm } from '@/components/ConfirmDialog'
import { logClientActivity } from '@/lib/logClientActivity'
import {
  LifeClaim, LifeClaimType, LifeOutcome, LifeChecklistItem, LifeTodo, LifeNote, LifeAttachment,
  LIFE_COLUMNS, TYPE_LABEL, STAGE_LABEL, OUTCOME_LABEL, DEFAULT_CHECKLIST,
  sgDate, isOverdue, hasOverdueTodo, waitInfo, policyLabel, claimMatchesPolicy, isOpen, personLabel,
} from '@/lib/lifeClaims'

// Death / TPD / CI claims for ONE client. One card = one policy claimed.
// Rendered inside the per-client Claims page (Life & CI tab). Medical claims
// are a separate data model and are not touched here.

const T = {
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  emerald: 'var(--emerald)', emeraldSoft: 'rgba(42,94,70,.12)',
  rose: 'var(--rouge)', roseSoft: 'rgba(138,40,40,.10)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)', line: 'var(--line)',
}

interface PolicyLite { id: string; policyNo?: string; companyName?: string; productName?: string; categoryCode?: string; person?: string; jointOwners?: { personKey: string }[] }

const TYPES: LifeClaimType[] = ['death', 'tpd', 'early_ci', 'advanced_ci']
const OUTCOMES: LifeOutcome[] = ['approved', 'partly_approved', 'declined', 'withdrawn']

const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: `1px solid ${T.line}`, borderRadius: 10, background: 'var(--cream)', color: T.text, fontSize: 13 }
const primaryBtn: React.CSSProperties = { padding: '8px 16px', fontSize: 12.5, fontWeight: 700, color: 'white', background: 'var(--charcoal)', border: 'none', borderRadius: 8, cursor: 'pointer' }
const ghostBtn: React.CSSProperties = { padding: '8px 14px', fontSize: 12.5, color: T.textDim, background: 'none', border: `1px solid ${T.line}`, borderRadius: 8, cursor: 'pointer' }
const chip = (bg: string, color: string): React.CSSProperties => ({ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color, background: bg, padding: '2px 8px', borderRadius: 5, whiteSpace: 'nowrap' })

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, marginBottom: 5 }}>{children}</div>
}

function parseFolder(raw: string | null | undefined): { id: string; name: string } | null {
  if (!raw) return null
  try { const f = JSON.parse(raw); return f && f.id ? { id: f.id, name: f.name || 'Folder' } : null } catch { return null }
}

export default function LifeClaimsPanel({ clientId, clientName, initialClaimId, startNew }: {
  clientId: string; clientName: string; initialClaimId?: string | null; startNew?: boolean
}) {
  const supabase = createClient()
  const toast = useToast()
  const confirmAction = useConfirm()
  const { advisor, spouseNames } = useDashboard()
  const drive = useDriveUpload()
  const spouseName = spouseNames[clientId]

  const [loading, setLoading] = useState(true)
  const [claims, setClaims] = useState<LifeClaim[]>([])
  const [checklist, setChecklist] = useState<LifeChecklistItem[]>([])
  const [todos, setTodos] = useState<LifeTodo[]>([])
  const [notes, setNotes] = useState<LifeNote[]>([])
  const [attachments, setAttachments] = useState<LifeAttachment[]>([])
  const [policies, setPolicies] = useState<PolicyLite[]>([])
  const [folder, setFolder] = useState<{ id: string; name: string } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  async function load() {
    setLoading(true)
    const [cRes, ffRes, clRes] = await Promise.all([
      supabase.from('life_claims').select(LIFE_COLUMNS).eq('client_id', clientId).order('date_notified', { ascending: false }),
      supabase.from('fact_finding').select('data').eq('client_id', clientId).eq('section', 'protection_portfolio').maybeSingle(),
      supabase.from('clients').select('drive_folder_link').eq('id', clientId).maybeSingle(),
    ])
    const rows = (cRes.data || []) as LifeClaim[]
    setClaims(rows)
    setPolicies(((ffRes.data as any)?.data?.risk_management?.policies || []) as PolicyLite[])
    setFolder(parseFolder((clRes.data as any)?.drive_folder_link))
    const ids = rows.map(r => r.id)
    if (ids.length > 0) {
      const [ck, td, nt, at] = await Promise.all([
        supabase.from('life_claim_checklist').select('*').in('life_claim_id', ids).order('sort'),
        supabase.from('life_claim_todos').select('*').in('life_claim_id', ids).order('created_at'),
        supabase.from('life_claim_notes').select('*').in('life_claim_id', ids).order('created_at', { ascending: false }),
        supabase.from('life_claim_attachments').select('id, life_claim_id, checklist_id, file_name, drive_file_id, drive_view_url, uploaded_at').in('life_claim_id', ids),
      ])
      setChecklist((ck.data || []) as LifeChecklistItem[])
      setTodos((td.data || []) as LifeTodo[])
      setNotes((nt.data || []) as LifeNote[])
      setAttachments((at.data || []) as LifeAttachment[])
    } else {
      setChecklist([]); setTodos([]); setNotes([]); setAttachments([])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  // Deep links: ?lifeClaimId=… opens that claim once, ?new=1 opens the sheet once.
  const deepLinkConsumed = useRef(false)
  useEffect(() => {
    if (loading || deepLinkConsumed.current) return
    deepLinkConsumed.current = true
    if (initialClaimId && claims.some(c => c.id === initialClaimId)) setOpenId(initialClaimId)
    if (startNew) setShowNew(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, initialClaimId, startNew])

  const docsFor = (id: string) => checklist.filter(i => i.life_claim_id === id)
  const todosFor = (id: string) => todos.filter(t => t.life_claim_id === id)

  const open = claims.filter(isOpen)
  const closed = claims.filter(c => !isOpen(c))
  const current = claims.find(c => c.id === openId) || null

  async function patchClaim(id: string, patch: Partial<LifeClaim>): Promise<boolean> {
    const withTs = { ...patch, updated_at: new Date().toISOString() }
    setClaims(prev => prev.map(c => c.id === id ? { ...c, ...withTs } : c))
    const { error } = await supabase.from('life_claims').update(withTs).eq('id', id)
    if (error) toast('Save failed: ' + error.message, 'error')
    return !error
  }

  function renderCard(c: LifeClaim) {
    const docs = docsFor(c.id)
    const done = docs.filter(d => d.done).length
    const w = waitInfo(c, done, docs.length)
    const follow = isOpen(c) && hasOverdueTodo(todosFor(c.id))
    const siblings = c.group_id ? claims.filter(x => x.group_id === c.group_id).length : 0
    return (
      <div key={c.id} onClick={() => setOpenId(c.id)} style={{
        background: 'white', border: `1px solid ${T.line}`, borderLeft: `3px solid ${w.kind === 'your_move' ? T.gold : c.outcome === 'approved' ? T.emerald : c.outcome === 'declined' ? T.rose : T.line}`,
        borderRadius: 10, padding: '12px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={chip(T.goldSoft, T.goldText)}>{TYPE_LABEL[c.claim_type]}</span>
          <span style={chip('var(--cream2)', T.textDim)}>{c.stage === 'outcome' && c.outcome ? OUTCOME_LABEL[c.outcome] : STAGE_LABEL[c.stage]}</span>
          {w.kind === 'your_move' && <span style={chip(T.goldSoft, T.goldText)}>Your move</span>}
          {follow && <span style={chip(T.roseSoft, T.rose)}>Needs follow-up</span>}
          {c.rounds > 0 && <span style={chip('var(--cream2)', T.textFaint)}>Asked again ×{c.rounds}</span>}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{policyLabel(c)}</div>
        <div style={{ fontSize: 11.5, color: T.textFaint }}>
          {personLabel(c.life_assured_person, clientName, spouseName)} · notified {sgDate(c.date_notified)}{c.insurer_ref ? ` · Ref ${c.insurer_ref}` : ''}
        </div>
        {w.line && <div style={{ fontSize: 12, color: w.kind === 'your_move' ? T.goldText : T.textDim, fontWeight: w.kind === 'your_move' ? 700 : 400 }}>{w.line}</div>}
        {c.stage === 'outcome' && c.paid_amount ? <div style={{ fontSize: 12, color: T.emerald, fontWeight: 600 }}>Paid ${c.paid_amount.toLocaleString('en-SG')}{c.paid_date ? ` · ${sgDate(c.paid_date)}` : ''}</div> : null}
        {siblings > 1 && <div style={{ fontSize: 10.5, color: T.textFaint }}>1 of {siblings} from the same event</div>}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12 }}>
        <div style={{ fontSize: 12.5, color: T.textFaint }}>
          {loading ? 'Loading…' : `${open.length} open · ${closed.length} closed — one card per policy claimed`}
        </div>
        <button onClick={() => setShowNew(true)} style={primaryBtn}>+ New claim</button>
      </div>

      {!loading && claims.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: T.textFaint, fontSize: 13, fontStyle: 'italic' }}>No Death / TPD / CI claims for {clientName} yet.</div>
      )}

      {open.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22, maxWidth: 680 }}>{open.map(renderCard)}</div>}
      {closed.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, marginBottom: 8 }}>Closed · {closed.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 680 }}>{closed.map(renderCard)}</div>
        </>
      )}

      {showNew && (
        <NewClaimSheet
          clientId={clientId} clientName={clientName} spouseName={spouseName}
          policies={policies} claims={claims}
          onClose={() => setShowNew(false)}
          onCreated={async (firstId) => { setShowNew(false); await load(); if (firstId) setOpenId(firstId) }}
        />
      )}

      {current && (
        <ClaimWindow
          claim={current}
          clientId={clientId} clientName={clientName} spouseName={spouseName}
          advisorId={advisor?.id || null}
          checklist={docsFor(current.id)} todos={todosFor(current.id)}
          notes={notes.filter(n => n.life_claim_id === current.id)}
          attachments={attachments.filter(a => a.life_claim_id === current.id)}
          folder={folder} setFolder={setFolder} drive={drive}
          setChecklist={setChecklist} setTodos={setTodos} setNotes={setNotes} setAttachments={setAttachments}
          patchClaim={patchClaim}
          onClose={() => setOpenId(null)}
          onDeleted={() => { setClaims(prev => prev.filter(c => c.id !== current.id)); setOpenId(null) }}
          confirmAction={confirmAction}
        />
      )}
    </div>
  )
}

// ─── NEW CLAIM SHEET ────────────────────────────────────────────────────────

function NewClaimSheet({ clientId, clientName, spouseName, policies, claims, onClose, onCreated }: {
  clientId: string; clientName: string; spouseName?: string
  policies: PolicyLite[]; claims: LifeClaim[]
  onClose: () => void; onCreated: (firstId: string | null) => void
}) {
  const supabase = createClient()
  const toast = useToast()
  const [type, setType] = useState<LifeClaimType>('early_ci')
  const [person, setPerson] = useState<string>('client')
  const [notified, setNotified] = useState(() => new Date().toISOString().slice(0, 10))
  const [eventDate, setEventDate] = useState('')
  const [cause, setCause] = useState('')
  const [claimant, setClaimant] = useState('')
  const [ticked, setTicked] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const personPolicies = useMemo(() => policies.filter(p =>
    p.categoryCode !== 'medical' && (p.person === person || !!(p.jointOwners && p.jointOwners.some(o => o.personKey === person)))
  ), [policies, person])

  useEffect(() => { setTicked([]) }, [person])

  const priorFor = (p: PolicyLite) => claims.filter(c => claimMatchesPolicy(c, { id: p.id, policyNo: p.policyNo }))
  const openDupes = personPolicies.filter(p => ticked.indexOf(p.id) !== -1 && priorFor(p).some(isOpen))

  function toggle(id: string) {
    setTicked(prev => prev.indexOf(id) === -1 ? prev.concat([id]) : prev.filter(x => x !== id))
  }

  async function create() {
    if (!notified) { toast('Date notified is required', 'error'); return }
    if (ticked.length === 0) { toast('Tick at least one policy', 'error'); return }
    setSaving(true)
    const groupId = ticked.length > 1 ? crypto.randomUUID() : null
    const chosen = personPolicies.filter(p => ticked.indexOf(p.id) !== -1)
    const rows = chosen.map(p => ({
      client_id: clientId, group_id: groupId, claim_type: type, life_assured_person: person,
      date_notified: notified, event_date: eventDate || null, cause: cause.trim() || null, claimant: claimant.trim() || null,
      policy_id: p.id, policy_company: p.companyName || null, policy_product: p.productName || null, policy_no: p.policyNo || null,
      stage: 'with_client',
    }))
    const { data, error } = await supabase.from('life_claims').insert(rows).select('id')
    if (error || !data) { setSaving(false); toast('Could not create: ' + (error?.message || 'unknown error'), 'error'); return }
    const created = data as { id: string }[]
    const items: { life_claim_id: string; label: string; sort: number }[] = []
    created.forEach(c => DEFAULT_CHECKLIST[type].forEach((label, i) => items.push({ life_claim_id: c.id, label, sort: i })))
    const { error: ckErr } = await supabase.from('life_claim_checklist').insert(items)
    if (ckErr) toast('Claims created but checklist failed: ' + ckErr.message, 'error')
    setSaving(false)
    onCreated(created[0]?.id || null)
  }

  const people = [{ key: 'client', label: clientName }].concat(spouseName ? [{ key: 'spouse', label: spouseName }] : [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,24,22,0.6)' }} onClick={() => { if (!saving) onClose() }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto', background: 'white', borderRadius: 12 }}>
        <div style={{ padding: '20px 24px 6px' }}>
          <div className="font-serif" style={{ fontSize: 21, color: T.text }}>New claim</div>
          <div style={{ fontSize: 12, color: T.textFaint, marginTop: 3 }}>One card is created for each policy you tick.</div>
        </div>
        <div style={{ padding: '14px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <Label>Type</Label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {TYPES.map(t => (
                <button key={t} onClick={() => setType(t)} style={{ ...ghostBtn, padding: '6px 12px', background: type === t ? T.goldSoft : 'none', borderColor: type === t ? T.gold : T.line, color: type === t ? T.goldText : T.textDim, fontWeight: type === t ? 700 : 400 }}>{TYPE_LABEL[t]}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <Label>Life assured</Label>
              <select value={person} onChange={e => setPerson(e.target.value)} style={inputStyle}>
                {people.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <Label>Date notified *</Label>
              <DateInput value={notified} onChange={setNotified} style={inputStyle} />
            </div>
            <div>
              <Label>{type === 'death' ? 'Date of death' : 'Date of diagnosis / event'} (optional)</Label>
              <DateInput value={eventDate} onChange={setEventDate} style={inputStyle} />
            </div>
            <div>
              <Label>{type === 'death' ? 'Claimant (nominee / executor)' : 'Claimant'}</Label>
              <input value={claimant} onChange={e => setClaimant(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div>
            <Label>{type === 'death' ? 'Cause' : 'Diagnosis / cause'}</Label>
            <input value={cause} onChange={e => setCause(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <Label>Policies to claim on</Label>
            {personPolicies.length === 0 && <div style={{ fontSize: 12.5, color: T.textFaint }}>No non-medical policies on file for this person. Add them under Risk Management first.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {personPolicies.map(p => {
                const prior = priorFor(p)
                const on = ticked.indexOf(p.id) !== -1
                return (
                  <label key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 11px', border: `1px solid ${on ? T.gold : T.line}`, borderRadius: 10, cursor: 'pointer', background: on ? T.goldSoft : 'white' }}>
                    <input type="checkbox" checked={on} onChange={() => toggle(p.id)} style={{ marginTop: 3 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text }}>{[p.companyName, p.productName].filter(Boolean).join(' · ') || 'Policy'}</div>
                      {p.policyNo && <div className="font-mono" style={{ fontSize: 10.5, color: T.textFaint }}>{p.policyNo}</div>}
                      {prior.map(c => (
                        <div key={c.id} style={{ fontSize: 11, marginTop: 3, color: isOpen(c) ? T.rose : T.textFaint, fontWeight: isOpen(c) ? 600 : 400 }}>
                          {isOpen(c)
                            ? `⚠ ${TYPE_LABEL[c.claim_type]} claim already open · ${STAGE_LABEL[c.stage]} · notified ${sgDate(c.date_notified)}`
                            : `${TYPE_LABEL[c.claim_type]} claim ${c.outcome ? OUTCOME_LABEL[c.outcome].toLowerCase() : 'closed'}${c.paid_amount ? ` · paid $${c.paid_amount.toLocaleString('en-SG')}` : ''} · notified ${sgDate(c.date_notified)}`}
                        </div>
                      ))}
                    </div>
                  </label>
                )
              })}
            </div>
            {openDupes.length > 0 && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: T.roseSoft, border: `1px solid ${T.rose}`, borderRadius: 10, fontSize: 12, color: T.rose }}>
                Claim already in progress on {openDupes.map(p => p.productName || p.companyName || 'this policy').join(', ')}. Check this is not a double claim. You can still continue.
              </div>
            )}
          </div>
        </div>
        <div style={{ padding: '0 24px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={saving} style={ghostBtn}>Cancel</button>
          <button onClick={create} disabled={saving || ticked.length === 0} style={{ ...primaryBtn, opacity: saving || ticked.length === 0 ? 0.5 : 1 }}>
            {saving ? 'Creating…' : ticked.length > 1 ? `Create ${ticked.length} claims` : 'Create claim'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── CLAIM WINDOW ───────────────────────────────────────────────────────────

type DriveApi = ReturnType<typeof useDriveUpload>

function ClaimWindow({
  claim, clientId, clientName, spouseName, advisorId, checklist, todos, notes, attachments, folder, setFolder, drive,
  setChecklist, setTodos, setNotes, setAttachments, patchClaim, onClose, onDeleted, confirmAction,
}: {
  claim: LifeClaim; clientId: string; clientName: string; spouseName?: string; advisorId: string | null
  checklist: LifeChecklistItem[]; todos: LifeTodo[]; notes: LifeNote[]; attachments: LifeAttachment[]
  folder: { id: string; name: string } | null; setFolder: (f: { id: string; name: string } | null) => void; drive: DriveApi
  setChecklist: React.Dispatch<React.SetStateAction<LifeChecklistItem[]>>
  setTodos: React.Dispatch<React.SetStateAction<LifeTodo[]>>
  setNotes: React.Dispatch<React.SetStateAction<LifeNote[]>>
  setAttachments: React.Dispatch<React.SetStateAction<LifeAttachment[]>>
  patchClaim: (id: string, patch: Partial<LifeClaim>) => Promise<boolean>
  onClose: () => void; onDeleted: () => void
  confirmAction: (m: string, o?: { danger?: boolean; confirmLabel?: string }) => Promise<boolean>
}) {
  const supabase = createClient()
  const toast = useToast()
  const [askMore, setAskMore] = useState(false)
  const [askText, setAskText] = useState('')
  const [newItem, setNewItem] = useState('')
  const [todoText, setTodoText] = useState('')
  const [todoDue, setTodoDue] = useState('')
  const [noteText, setNoteText] = useState('')
  const [ref, setRef] = useState(claim.insurer_ref || '')
  const [cause, setCause] = useState(claim.cause || '')
  const [claimant, setClaimant] = useState(claim.claimant || '')
  const [reason, setReason] = useState(claim.reason || '')
  const [paid, setPaid] = useState(claim.paid_amount != null ? String(claim.paid_amount) : '')

  const done = checklist.filter(i => i.done).length
  const w = waitInfo(claim, done, checklist.length)

  async function addNote(text: string, date?: string) {
    const { data, error } = await supabase.from('life_claim_notes').insert({ life_claim_id: claim.id, text, note_date: date || new Date().toISOString().slice(0, 10) }).select('*').maybeSingle()
    if (error || !data) { toast('Could not save note: ' + (error?.message || ''), 'error'); return }
    setNotes(prev => [data as LifeNote].concat(prev))
  }

  function logActivity(title: string, description: string | null) {
    if (!advisorId) return
    logClientActivity(supabase, { clientId, advisorId, type: 'claim_status', title, description, sourceTable: 'life_claims', sourceId: claim.id })
  }

  async function markSubmitted() {
    if (w.kind !== 'your_move' && !await confirmAction(`Only ${done} of ${checklist.length} documents are ticked. Submit to the insurer anyway?`, { confirmLabel: 'Submit anyway' })) return
    await patchClaim(claim.id, { stage: 'with_insurer' })
  }

  async function insurerWantsMore() {
    const text = askText.trim()
    if (!text) { toast('Say what the insurer asked for', 'error'); return }
    const sort = checklist.reduce((m, i) => Math.max(m, i.sort), 0) + 1
    const { data, error } = await supabase.from('life_claim_checklist').insert({ life_claim_id: claim.id, label: text, sort, done: false }).select('*').maybeSingle()
    if (error || !data) { toast('Could not add item: ' + (error?.message || ''), 'error'); return }
    setChecklist(prev => prev.concat([data as LifeChecklistItem]))
    const round = claim.rounds + 1
    await patchClaim(claim.id, { stage: 'with_client', rounds: round })
    await addNote(`Insurer asked for more documents (request ${round}): ${text}`)
    setAskMore(false); setAskText('')
  }

  async function setOutcome(o: LifeOutcome) {
    await patchClaim(claim.id, { stage: 'outcome', outcome: o })
    logActivity(`${TYPE_LABEL[claim.claim_type]} claim ${OUTCOME_LABEL[o].toLowerCase()} — ${policyLabel(claim)}`, o === 'approved' ? null : (reason.trim() || null))
  }

  async function addChecklistItem() {
    const label = newItem.trim()
    if (!label) return
    const sort = checklist.reduce((m, i) => Math.max(m, i.sort), 0) + 1
    const { data, error } = await supabase.from('life_claim_checklist').insert({ life_claim_id: claim.id, label, sort }).select('*').maybeSingle()
    if (error || !data) { toast('Could not add: ' + (error?.message || ''), 'error'); return }
    setChecklist(prev => prev.concat([data as LifeChecklistItem])); setNewItem('')
  }

  async function toggleItem(item: LifeChecklistItem) {
    setChecklist(prev => prev.map(i => i.id === item.id ? { ...i, done: !item.done } : i))
    const { error } = await supabase.from('life_claim_checklist').update({ done: !item.done }).eq('id', item.id)
    if (error) toast('Save failed: ' + error.message, 'error')
  }

  async function removeItem(item: LifeChecklistItem) {
    if (!await confirmAction(`Remove "${item.label}" from the checklist?`, { danger: true, confirmLabel: 'Remove' })) return
    setChecklist(prev => prev.filter(i => i.id !== item.id))
    const { error } = await supabase.from('life_claim_checklist').delete().eq('id', item.id)
    if (error) toast('Delete failed: ' + error.message, 'error')
  }

  async function connectDrive() {
    const f = await drive.connectDriveFolder({ table: 'clients', idColumn: 'id', id: clientId })
    if (f) setFolder(f)
  }

  async function attach(item: LifeChecklistItem, files: FileList | null) {
    if (!files || files.length === 0) return
    let f = folder
    if (!f) { f = await drive.connectDriveFolder({ table: 'clients', idColumn: 'id', id: clientId }); if (f) setFolder(f) }
    if (!f) return
    const uploaded = await drive.uploadFilesGeneric(files, { table: 'life_claim_attachments', idColumn: 'life_claim_id', id: claim.id }, f)
    if (uploaded.length === 0) return
    const ids = uploaded.map(u => u.id)
    const { error } = await supabase.from('life_claim_attachments').update({ checklist_id: item.id }).in('id', ids)
    if (error) toast('Uploaded, but could not link to the item: ' + error.message, 'error')
    setAttachments(prev => prev.concat(uploaded.map(u => ({ ...(u as any), checklist_id: item.id }) as LifeAttachment)))
    if (!item.done) {
      setChecklist(prev => prev.map(i => i.id === item.id ? { ...i, done: true } : i))
      await supabase.from('life_claim_checklist').update({ done: true }).eq('id', item.id)
    }
  }

  async function detach(a: LifeAttachment) {
    const ok = await drive.deleteDocumentGeneric({ id: a.id, file_name: a.file_name, drive_file_id: a.drive_file_id }, 'life_claim_attachments')
    if (ok) setAttachments(prev => prev.filter(x => x.id !== a.id))
  }

  async function addTodo() {
    const text = todoText.trim()
    if (!text) return
    const { data, error } = await supabase.from('life_claim_todos').insert({ life_claim_id: claim.id, text, due_date: todoDue || null }).select('*').maybeSingle()
    if (error || !data) { toast('Could not add: ' + (error?.message || ''), 'error'); return }
    setTodos(prev => prev.concat([data as LifeTodo])); setTodoText(''); setTodoDue('')
  }

  async function toggleTodo(t: LifeTodo) {
    setTodos(prev => prev.map(x => x.id === t.id ? { ...x, done: !t.done } : x))
    const { error } = await supabase.from('life_claim_todos').update({ done: !t.done }).eq('id', t.id)
    if (error) toast('Save failed: ' + error.message, 'error')
  }

  async function removeTodo(t: LifeTodo) {
    setTodos(prev => prev.filter(x => x.id !== t.id))
    const { error } = await supabase.from('life_claim_todos').delete().eq('id', t.id)
    if (error) toast('Delete failed: ' + error.message, 'error')
  }

  async function removeNote(n: LifeNote) {
    if (!await confirmAction('Delete this note?', { danger: true, confirmLabel: 'Delete' })) return
    setNotes(prev => prev.filter(x => x.id !== n.id))
    const { error } = await supabase.from('life_claim_notes').delete().eq('id', n.id)
    if (error) toast('Delete failed: ' + error.message, 'error')
  }

  async function deleteClaim() {
    if (!await confirmAction('Delete this claim and everything on it? This cannot be undone.', { danger: true, confirmLabel: 'Delete' })) return
    const { error } = await supabase.from('life_claims').delete().eq('id', claim.id)
    if (error) { toast('Delete failed: ' + error.message, 'error'); return }
    onDeleted()
  }

  const savePaid = () => {
    const n = paid.trim() === '' ? null : Number(paid.replace(/,/g, ''))
    if (n !== null && isNaN(n)) { toast('Amount paid must be a number', 'error'); return }
    patchClaim(claim.id, { paid_amount: n })
  }

  const needsReason = claim.stage === 'outcome' && claim.outcome && claim.outcome !== 'approved'
  const eventLabel = claim.claim_type === 'death' ? 'Date of death' : 'Date of diagnosis / event'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,24,22,0.6)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 640, maxHeight: '92vh', overflowY: 'auto', background: 'white', borderRadius: 12 }}>
        <div style={{ padding: '18px 24px 12px', borderBottom: `1px solid ${T.line}`, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={chip(T.goldSoft, T.goldText)}>{TYPE_LABEL[claim.claim_type]}</span>
              {claim.rounds > 0 && <span style={chip('var(--cream2)', T.textFaint)}>Asked again ×{claim.rounds}</span>}
            </div>
            <div className="font-serif" style={{ fontSize: 20, color: T.text }}>{policyLabel(claim)}</div>
            <div style={{ fontSize: 12, color: T.textFaint, marginTop: 2 }}>{personLabel(claim.life_assured_person, clientName, spouseName)} · notified {sgDate(claim.date_notified)}</div>
          </div>
          <button onClick={onClose} style={{ ...ghostBtn, alignSelf: 'flex-start', padding: '4px 10px' }}>✕</button>
        </div>

        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Stage */}
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {(['with_client', 'with_insurer', 'outcome'] as const).map(s => (
                <div key={s} style={{ flex: 1, textAlign: 'center', padding: '7px 0', fontSize: 11.5, fontWeight: 700, borderRadius: 8, background: claim.stage === s ? 'var(--charcoal)' : 'var(--cream2)', color: claim.stage === s ? 'white' : T.textFaint }}>
                  {STAGE_LABEL[s]}
                </div>
              ))}
            </div>
            {w.line && (
              <div style={{ padding: '10px 12px', borderRadius: 10, fontSize: 12.5, background: w.kind === 'your_move' ? T.goldSoft : 'var(--cream)', color: w.kind === 'your_move' ? T.goldText : T.textDim, fontWeight: w.kind === 'your_move' ? 700 : 400 }}>
                {w.line}{w.kind === 'your_move' ? '. Check them and submit.' : ''}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {claim.stage === 'with_client' && <button onClick={markSubmitted} style={w.kind === 'your_move' ? primaryBtn : ghostBtn}>Mark as submitted</button>}
              {claim.stage === 'with_insurer' && (
                <>
                  <button onClick={() => setAskMore(true)} style={ghostBtn}>Insurer wants more documents</button>
                  <button onClick={() => patchClaim(claim.id, { stage: 'outcome', outcome: null })} style={primaryBtn}>Record outcome</button>
                </>
              )}
              {claim.stage === 'outcome' && <button onClick={() => patchClaim(claim.id, { stage: 'with_insurer', outcome: null })} style={ghostBtn}>Move back to With insurer (appeal)</button>}
            </div>
            {askMore && (
              <div style={{ marginTop: 10, padding: 12, border: `1px solid ${T.line}`, borderRadius: 10 }}>
                <Label>What did the insurer ask for?</Label>
                <input autoFocus value={askText} onChange={e => setAskText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') insurerWantsMore() }} placeholder="e.g. Latest oncology report" style={inputStyle} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => { setAskMore(false); setAskText('') }} style={ghostBtn}>Cancel</button>
                  <button onClick={insurerWantsMore} style={primaryBtn}>Move back to client</button>
                </div>
              </div>
            )}
            {claim.stage === 'outcome' && (
              <div style={{ marginTop: 12 }}>
                <Label>Outcome</Label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {OUTCOMES.map(o => (
                    <button key={o} onClick={() => setOutcome(o)} style={{ ...ghostBtn, padding: '6px 12px', background: claim.outcome === o ? T.goldSoft : 'none', borderColor: claim.outcome === o ? T.gold : T.line, color: claim.outcome === o ? T.goldText : T.textDim, fontWeight: claim.outcome === o ? 700 : 400 }}>{OUTCOME_LABEL[o]}</button>
                  ))}
                </div>
                {!claim.outcome && <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 6 }}>Choose how the insurer decided.</div>}
                {needsReason && (
                  <div style={{ marginTop: 10 }}>
                    <Label>Reason — please note why</Label>
                    <textarea value={reason} onChange={e => setReason(e.target.value)} onBlur={() => { if (reason !== (claim.reason || '')) patchClaim(claim.id, { reason: reason.trim() || null }) }} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
                  </div>
                )}
                {(claim.outcome === 'approved' || claim.outcome === 'partly_approved') && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
                    <div><Label>Amount paid (optional)</Label><input value={paid} onChange={e => setPaid(e.target.value)} onBlur={savePaid} inputMode="decimal" style={inputStyle} /></div>
                    <div><Label>Date paid</Label><DateInput value={claim.paid_date || ''} onChange={v => patchClaim(claim.id, { paid_date: v || null })} style={inputStyle} /></div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Details */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><Label>Insurer claim ref</Label><input value={ref} onChange={e => setRef(e.target.value)} onBlur={() => { if (ref !== (claim.insurer_ref || '')) patchClaim(claim.id, { insurer_ref: ref.trim() || null }) }} style={inputStyle} /></div>
            <div><Label>Date notified</Label><DateInput value={claim.date_notified} onChange={v => { if (v) patchClaim(claim.id, { date_notified: v }) }} style={inputStyle} /></div>
            <div><Label>{eventLabel}</Label><DateInput value={claim.event_date || ''} onChange={v => patchClaim(claim.id, { event_date: v || null })} style={inputStyle} /></div>
            <div><Label>{claim.claim_type === 'death' ? 'Claimant (nominee / executor)' : 'Claimant'}</Label><input value={claimant} onChange={e => setClaimant(e.target.value)} onBlur={() => { if (claimant !== (claim.claimant || '')) patchClaim(claim.id, { claimant: claimant.trim() || null }) }} style={inputStyle} /></div>
            <div style={{ gridColumn: '1 / -1' }}><Label>{claim.claim_type === 'death' ? 'Cause' : 'Diagnosis / cause'}</Label><input value={cause} onChange={e => setCause(e.target.value)} onBlur={() => { if (cause !== (claim.cause || '')) patchClaim(claim.id, { cause: cause.trim() || null }) }} style={inputStyle} /></div>
          </div>

          {/* Documents */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>Documents · {done} of {checklist.length}</div>
              <button onClick={connectDrive} disabled={drive.connecting} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                {folder ? `📁 ${folder.name} · change` : 'Connect Drive folder'}
              </button>
            </div>
            {drive.uploadError && <div style={{ fontSize: 11.5, color: T.rose, marginBottom: 6 }}>{drive.uploadError}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {checklist.map(item => {
                const files = attachments.filter(a => a.checklist_id === item.id)
                return (
                  <div key={item.id} style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={item.done} onChange={() => toggleItem(item)} style={{ width: 15, height: 15 }} />
                      <span style={{ flex: 1, fontSize: 12.5, color: item.done ? T.textFaint : T.text, textDecoration: item.done ? 'line-through' : 'none' }}>{item.label}</span>
                      <label style={{ fontSize: 11, color: T.goldText, cursor: 'pointer', fontWeight: 600 }}>
                        {drive.uploading ? '…' : 'Attach'}
                        <input type="file" multiple disabled={drive.uploading} style={{ display: 'none' }} onChange={e => { attach(item, e.target.files); e.target.value = '' }} />
                      </label>
                      <button onClick={() => removeItem(item)} title="Remove item" style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                    </div>
                    {files.map(a => (
                      <div key={a.id} style={{ display: 'flex', gap: 8, marginTop: 4, paddingLeft: 23, fontSize: 11.5 }}>
                        {a.drive_view_url ? <a href={a.drive_view_url} target="_blank" rel="noreferrer" style={{ color: T.goldText, textDecoration: 'underline', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.file_name}</a> : <span style={{ flex: 1 }}>{a.file_name}</span>}
                        <button onClick={() => detach(a)} style={{ fontSize: 11, color: T.rose, background: 'none', border: 'none', cursor: 'pointer' }}>Detach</button>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addChecklistItem() }} placeholder="Add a document to the checklist" style={inputStyle} />
              <button onClick={addChecklistItem} style={ghostBtn}>Add</button>
            </div>
          </div>

          {/* To-dos */}
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text, marginBottom: 8 }}>To-dos</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {todos.map(t => {
                const od = isOverdue(t.due_date, t.done)
                return (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                    <input type="checkbox" checked={t.done} onChange={() => toggleTodo(t)} style={{ width: 15, height: 15 }} />
                    <span style={{ flex: 1, color: t.done ? T.textFaint : T.text, textDecoration: t.done ? 'line-through' : 'none' }}>{t.text}</span>
                    {t.due_date && <span style={od ? chip(T.roseSoft, T.rose) : { fontSize: 11, color: T.textFaint }}>{od ? 'Overdue · ' : ''}{sgDate(t.due_date)}</span>}
                    <button onClick={() => removeTodo(t)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input value={todoText} onChange={e => setTodoText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addTodo() }} placeholder="e.g. Chase insurer for acknowledgement" style={inputStyle} />
              <div style={{ width: 140, flexShrink: 0 }}><DateInput value={todoDue} onChange={setTodoDue} style={inputStyle} /></div>
              <button onClick={addTodo} style={ghostBtn}>Add</button>
            </div>
          </div>

          {/* Notes */}
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text, marginBottom: 8 }}>Notes</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={noteText} onChange={e => setNoteText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && noteText.trim()) { addNote(noteText.trim()); setNoteText('') } }} placeholder="Add a note" style={inputStyle} />
              <button onClick={() => { if (noteText.trim()) { addNote(noteText.trim()); setNoteText('') } }} style={ghostBtn}>Add</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {notes.map(n => (
                <div key={n.id} style={{ display: 'flex', gap: 10, fontSize: 12.5 }}>
                  <span className="font-mono" style={{ fontSize: 10.5, color: T.textFaint, flexShrink: 0, paddingTop: 2 }}>{sgDate(n.note_date)}</span>
                  <span style={{ flex: 1, color: T.text }}>{n.text}</span>
                  <button onClick={() => removeNote(n)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${T.line}`, paddingTop: 12 }}>
            <button onClick={deleteClaim} style={{ ...ghostBtn, color: T.rose, borderColor: T.rose }}>Delete claim</button>
          </div>
        </div>
      </div>
    </div>
  )
}
