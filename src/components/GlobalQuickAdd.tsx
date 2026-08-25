'use client'
import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useDashboard, ClientRow } from '@/contexts/DashboardContext'
import { fetchClientOpenItems, ClientOpenItems } from '@/lib/clientOpenItems'
import NewBusinessCaseModal from '@/components/NewBusinessCaseModal'

// Floating "+" reachable from anywhere in the app (mounted once in
// dashboard/layout.tsx, gated on business dashboard access) — lets Brian
// log a todo/meeting, or start a brand-new claim / case / service request,
// against any client without first navigating into that pipeline's board.
// Aug 2026. Pulls clients/setClients/setActiveClient/router from
// useDashboard() itself rather than via props — it's mounted inside
// DashboardProvider's tree in layout.tsx, so no need to thread them down.
//
// "New Claim" and "New Service Request" replicate the exact same
// creation logic the Claims board and per-client Service Requests page
// already use (same tables, same required fields, same fallback rules) —
// not new behavior, just reachable from one more place. "New Case" reuses
// the actual NewBusinessCaseModal component via its existing presetClient
// prop, built for exactly this ("client already known, skip the search").
//
// Scope decisions carried over from the todo/meeting version:
// - Quick-add meetings are log-only, no Google Calendar sync.
// - New Claim only supports life_assured = the client themself, same
//   limitation as the Claims board's own "+ New Claim" button — adding a
//   claim for a spouse/child isn't supported there either, not something
//   this quick-add expands.
// - New Claim doesn't collect claim details here — same as the existing
//   flow, it ensures the claims container row exists then hands off to
//   the per-client Claims page (addSection param) to fill in the actual
//   line item (description, amount, documents).

const T = {
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  emerald: 'var(--emerald)', emeraldSoft: 'rgba(45,90,78,.12)',
  rose: 'var(--rouge)', slate: '#5C6B73', slateSoft: 'rgba(92,107,115,.12)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)', line: 'var(--line)',
}

const SECTION_LABEL: Record<'pre' | 'in' | 'post', string> = {
  pre: 'Pre-Hospitalisation', in: 'Inpatient / Surgery', post: 'Post-Hospitalisation',
}

type Pipe = 'claims' | 'newbiz' | 'service'
type Target = { id: string; label: string; sublabel: string; supportsMeeting: boolean }
type Step = 'client' | 'target' | 'form' | 'newClaimSection' | 'newBizModal' | 'newServiceForm' | 'done'
type DoneKind = 'todo' | 'meeting' | 'case' | 'service'

function targetsFor(pipe: Pipe, items: ClientOpenItems): Target[] {
  if (pipe === 'claims') return items.claims.map(i => ({ id: i.id, label: i.description, sublabel: i.policyLabel, supportsMeeting: false }))
  if (pipe === 'newbiz') return items.newBusiness.map(c => ({ id: c.id, label: c.title, sublabel: c.stage.replace('_', ' '), supportsMeeting: true }))
  return items.service.map(r => ({ id: r.id, label: r.requestType, sublabel: r.status.replace('_', ' '), supportsMeeting: true }))
}

export default function GlobalQuickAdd() {
  const router = useRouter()
  const { advisor, clients, setClients, setActiveClient } = useDashboard()

  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('client')
  const [search, setSearch] = useState('')
  const [client, setClient] = useState<ClientRow | null>(null)
  const [loadingItems, setLoadingItems] = useState(false)
  const [items, setItems] = useState<ClientOpenItems | null>(null)
  const [pipe, setPipe] = useState<Pipe | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const [kind, setKind] = useState<'todo' | 'meeting'>('todo')
  const [text, setText] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [doneKind, setDoneKind] = useState<DoneKind>('todo')

  // New Claim
  const [pendingClaimId, setPendingClaimId] = useState<string | null>(null)
  const [newClaimError, setNewClaimError] = useState<string | null>(null)

  // New Service Request
  const [serviceTypes, setServiceTypes] = useState<string[]>([])
  const [newSrType, setNewSrType] = useState('')
  const [newSrDesc, setNewSrDesc] = useState('')

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clients.slice(0, 8)
    return clients.filter(c => c.name.toLowerCase().includes(q)).slice(0, 8)
  }, [search, clients])

  function reset() {
    setStep('client'); setSearch(''); setClient(null); setItems(null); setPipe(null); setTarget(null)
    setKind('todo'); setText(''); setDate(''); setTime(''); setSaveError(null)
    setPendingClaimId(null); setNewClaimError(null); setNewSrType(''); setNewSrDesc('')
  }

  function close() { setOpen(false); reset() }

  async function pickClient(c: ClientRow) {
    setClient(c)
    setLoadingItems(true)
    setStep('target')
    const supabase = createClient()
    const data = await fetchClientOpenItems(supabase, c.id)
    setItems(data)
    setLoadingItems(false)
  }

  function pickTarget(p: Pipe, t: Target) {
    setPipe(p); setTarget(t); setKind('todo'); setStep('form')
  }

  async function save() {
    if (!text.trim() || !pipe || !target) return
    setSaving(true)
    setSaveError(null)
    const supabase = createClient()
    let error: any = null

    if (kind === 'todo') {
      if (pipe === 'claims') {
        ;({ error } = await supabase.from('claim_followup_todos').insert({ line_item_id: target.id, task: text.trim(), due_date: date || null, done: false }))
      } else if (pipe === 'newbiz') {
        ;({ error } = await supabase.from('new_business_case_todos').insert({ case_id: target.id, text: text.trim(), due_date: date || null }))
      } else {
        ;({ error } = await supabase.from('service_request_todos').insert({ service_request_id: target.id, text: text.trim(), due_date: date || null }))
      }
    } else {
      if (!date) { setSaveError('Pick a date for the meeting.'); setSaving(false); return }
      if (pipe === 'newbiz') {
        ;({ error } = await supabase.from('new_business_case_meetings').insert({
          case_id: target.id, title: text.trim(), meeting_type: 'other', meeting_date: date, meeting_time: time || null,
          duration_minutes: 30, is_scheduled: false, google_calendar_event_id: null,
        }))
      } else {
        ;({ error } = await supabase.from('service_request_meetings').insert({
          service_request_id: target.id, title: text.trim(), meeting_type: 'in_person', meeting_date: date, meeting_time: time || null,
          duration_minutes: 30, is_scheduled: false, google_calendar_event_id: null,
        }))
      }
    }

    setSaving(false)
    if (error) { setSaveError('Could not save: ' + error.message); return }
    setDoneKind(kind)
    setStep('done')
  }

  // ── New Claim — mirrors addLineItemForClient() in the Claims board
  // exactly: reuse the client's most recent OPEN claim on themself if one
  // exists, otherwise create one against their first "main" medical
  // policy (or first medical policy if no "main" is flagged). Errors the
  // same way if they have no medical policy on file at all.
  async function startNewClaim() {
    if (!client) return
    setNewClaimError(null)
    setSaving(true)
    const supabase = createClient()

    const { data: existingClaims } = await supabase.from('claims')
      .select('id, opened_date').eq('client_id', client.id).eq('life_assured_person', 'client').eq('status', 'open')
      .order('opened_date', { ascending: false }).limit(1)
    let claimId: string | undefined = (existingClaims || [])[0]?.id

    if (!claimId) {
      const { data: ffRows } = await supabase.from('fact_finding')
        .select('data').eq('client_id', client.id).eq('section', 'protection_portfolio')
        .order('created_at', { ascending: false }).limit(1)
      const allPolicies: any[] = (ffRows?.[0]?.data as any)?.risk_management?.policies || []
      const clientPolicies = allPolicies.filter(p => p.person === 'client' && p.categoryCode === 'medical')
      const firstMain = clientPolicies.find(p => p.policyTypeCode?.toLowerCase() === 'main') || clientPolicies[0]
      if (!firstMain) {
        setSaving(false)
        setNewClaimError(`${client.name} has no medical policy on file yet — add one on the Protection page first.`)
        return
      }
      const { data, error } = await supabase.from('claims').insert({
        client_id: client.id, policy_id: firstMain.id, life_assured_person: 'client',
        label: 'New Claim', status: 'open', opened_date: new Date().toISOString().slice(0, 10),
      }).select().maybeSingle()
      if (error || !data) {
        setSaving(false)
        setNewClaimError('Could not create claim: ' + (error?.message || 'unknown error'))
        return
      }
      claimId = (data as { id: string }).id
    }

    setSaving(false)
    setPendingClaimId(claimId)
    setStep('newClaimSection')
  }

  function finishNewClaim(section: 'pre' | 'in' | 'post') {
    if (!client || !pendingClaimId) return
    setActiveClient(client)
    try { localStorage.setItem('selectedClientId', client.id) } catch {}
    const claimId = pendingClaimId
    close()
    router.push(`/dashboard/servicing/claims?claimId=${claimId}&addSection=${section}`)
  }

  // ── New Service Request — same table/fields/status as the per-client
  // Service Requests page's own createRequest().
  async function openNewServiceForm() {
    setStep('newServiceForm')
    if (serviceTypes.length > 0) return
    const supabase = createClient()
    const { data } = await supabase.from('service_request_types').select('label').order('created_at', { ascending: true })
    const labels = (data || []).map((r: any) => r.label)
    setServiceTypes(labels)
    if (labels.length > 0) setNewSrType(labels[0])
  }

  async function saveNewServiceRequest() {
    if (!client || !newSrType || !newSrDesc.trim()) return
    setSaving(true)
    setSaveError(null)
    const supabase = createClient()
    const { error } = await supabase.from('service_requests').insert({
      client_id: client.id, request_type: newSrType, description: newSrDesc.trim(), status: 'requested', field_values: {},
    })
    setSaving(false)
    if (error) { setSaveError('Could not create: ' + error.message); return }
    setDoneKind('service')
    setStep('done')
  }

  const showBottomSheet = open && step !== 'newBizModal'

  return (
    <>
      <button onClick={() => setOpen(true)} title="Quick add — todo, meeting, or a new claim/case/request for any client"
        style={{
          position: 'fixed', bottom: 'calc(24px + env(safe-area-inset-bottom))', right: 24, width: 52, height: 52, borderRadius: '50%',
          background: 'var(--charcoal)', color: '#fff', border: 'none', fontSize: 26, fontWeight: 400,
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          boxShadow: '0 8px 22px rgba(28,26,23,0.28)', zIndex: 40, lineHeight: 1, paddingBottom: 3,
        }}>
        +
      </button>

      {showBottomSheet && (
        <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,23,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', background: 'var(--cream)',
            borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${T.line}`, position: 'sticky', top: 0, background: 'var(--cream)' }}>
              <div className="font-serif" style={{ fontSize: 19, fontWeight: 600, color: T.text }}>Quick Add</div>
              <button onClick={close} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, fontSize: 20, lineHeight: 1 }}>×</button>
            </div>

            <div style={{ padding: '20px 20px calc(28px + env(safe-area-inset-bottom))' }}>
              {step === 'client' && (
                <>
                  <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients…"
                    style={{ width: '100%', padding: '10px 12px', fontSize: 13.5, border: `1px solid ${T.line}`, borderRadius: 8, outline: 'none', background: '#fff', marginBottom: 12 }} />
                  {filteredClients.length === 0 && <div style={{ fontSize: 12, color: T.textFaint, padding: '10px 2px' }}>No matching clients.</div>}
                  {filteredClients.map(c => (
                    <div key={c.id} onClick={() => pickClient(c)} style={{ padding: '11px 12px', fontSize: 13, fontWeight: 600, color: T.text, background: '#fff', border: `1px solid ${T.line}`, borderRadius: 9, marginBottom: 6, cursor: 'pointer' }}>
                      {c.name}
                    </div>
                  ))}
                </>
              )}

              {step === 'target' && (
                <>
                  <button onClick={() => setStep('client')} style={{ background: 'none', border: 'none', color: T.textFaint, fontSize: 11.5, cursor: 'pointer', padding: 0, marginBottom: 12 }}>← {client?.name}</button>

                  {newClaimError && <div style={{ fontSize: 12, color: T.rose, marginBottom: 12 }}>{newClaimError}</div>}

                  {loadingItems ? (
                    <div style={{ fontSize: 12.5, color: T.textFaint, padding: '10px 2px' }}>Loading open items…</div>
                  ) : items && (
                    <>
                      {(['claims', 'newbiz', 'service'] as Pipe[]).map(p => {
                        const targets = targetsFor(p, items)
                        const label = p === 'claims' ? 'Claims' : p === 'newbiz' ? 'New Business' : 'Service Requests'
                        const color = p === 'claims' ? T.emerald : p === 'newbiz' ? T.goldText : T.slate
                        const soft = p === 'claims' ? T.emeraldSoft : p === 'newbiz' ? T.goldSoft : T.slateSoft
                        const newLabel = p === 'claims' ? '+ New Claim' : p === 'newbiz' ? '+ New Case' : '+ New Service Request'
                        return (
                          <div key={p} style={{ marginBottom: 18 }}>
                            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5, background: soft, color }}>{label}</span>
                            <div style={{ marginTop: 8 }}>
                              <div
                                onClick={() => { if (saving) return; if (p === 'claims') startNewClaim(); else if (p === 'newbiz') setStep('newBizModal'); else openNewServiceForm() }}
                                style={{
                                  padding: '11px 12px', background: 'none', border: `1px dashed ${T.line}`, borderRadius: 9, marginBottom: 6,
                                  cursor: saving ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, color, opacity: saving ? 0.6 : 1,
                                }}>
                                {saving && p === 'claims' ? 'Setting up…' : newLabel}
                              </div>
                              {targets.map(t => (
                                <div key={t.id} onClick={() => pickTarget(p, t)} style={{ padding: '11px 12px', background: '#fff', border: `1px solid ${T.line}`, borderRadius: 9, marginBottom: 6, cursor: 'pointer' }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{t.label}</div>
                                  <div style={{ fontSize: 11, color: T.textFaint, marginTop: 1, textTransform: 'capitalize' }}>{t.sublabel}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </>
                  )}
                </>
              )}

              {step === 'newClaimSection' && client && (
                <>
                  <button onClick={() => setStep('target')} style={{ background: 'none', border: 'none', color: T.textFaint, fontSize: 11.5, cursor: 'pointer', padding: 0, marginBottom: 12 }}>← {client.name}</button>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 4 }}>{client.name}</div>
                  <div style={{ fontSize: 11.5, color: T.textFaint, marginBottom: 16 }}>Which section is this line item for? You'll fill in the details on the Claims page next.</div>
                  {(['pre', 'in', 'post'] as const).map(sec => (
                    <div key={sec} onClick={() => finishNewClaim(sec)}
                      style={{ padding: '12px 14px', background: '#fff', border: `1px solid ${T.line}`, borderRadius: 9, marginBottom: 8, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: T.text }}>
                      {SECTION_LABEL[sec]}
                    </div>
                  ))}
                </>
              )}

              {step === 'newServiceForm' && client && (
                <>
                  <button onClick={() => setStep('target')} style={{ background: 'none', border: 'none', color: T.textFaint, fontSize: 11.5, cursor: 'pointer', padding: 0, marginBottom: 12 }}>← {client.name}</button>
                  <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 14 }}>New Service Request for {client.name}</div>

                  <select value={newSrType} onChange={e => setNewSrType(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: `1px solid ${T.line}`, borderRadius: 8, outline: 'none', background: '#fff', marginBottom: 10 }}>
                    {serviceTypes.length === 0 && <option value="">Loading types…</option>}
                    {serviceTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>

                  <textarea value={newSrDesc} onChange={e => setNewSrDesc(e.target.value)} placeholder="What does the client need?" rows={3}
                    style={{ width: '100%', padding: '10px 12px', fontSize: 13.5, border: `1px solid ${T.line}`, borderRadius: 8, outline: 'none', background: '#fff', marginBottom: 16, resize: 'vertical', fontFamily: 'Inter, sans-serif' }} />

                  {saveError && <div style={{ fontSize: 12, color: T.rose, marginBottom: 10 }}>{saveError}</div>}

                  <button onClick={saveNewServiceRequest} disabled={saving || !newSrType || !newSrDesc.trim()} style={{
                    width: '100%', padding: '11px 0', fontSize: 13, fontWeight: 700, color: '#fff',
                    background: saving || !newSrType || !newSrDesc.trim() ? 'var(--ink3)' : 'var(--charcoal)', border: 'none', borderRadius: 9,
                    cursor: saving || !newSrType || !newSrDesc.trim() ? 'default' : 'pointer',
                  }}>
                    {saving ? 'Creating…' : 'Create Service Request'}
                  </button>
                </>
              )}

              {step === 'form' && target && (
                <>
                  <button onClick={() => setStep('target')} style={{ background: 'none', border: 'none', color: T.textFaint, fontSize: 11.5, cursor: 'pointer', padding: 0, marginBottom: 4 }}>← {target.label}</button>
                  <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 16 }}>{client?.name} · {target.sublabel}</div>

                  {target.supportsMeeting && (
                    <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'var(--cream2)', border: `1px solid ${T.line}`, borderRadius: 8, padding: 3, maxWidth: 200 }}>
                      {(['todo', 'meeting'] as const).map(k => (
                        <button key={k} onClick={() => setKind(k)} style={{
                          flex: 1, fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, padding: '7px 0', border: 'none',
                          borderRadius: 5, cursor: 'pointer', color: kind === k ? T.text : T.textFaint,
                          background: kind === k ? '#fff' : 'none',
                        }}>
                          {k === 'todo' ? 'Todo' : 'Meeting'}
                        </button>
                      ))}
                    </div>
                  )}

                  <input value={text} onChange={e => setText(e.target.value)} placeholder={kind === 'todo' ? 'What needs doing?' : 'Meeting title'}
                    style={{ width: '100%', padding: '10px 12px', fontSize: 13.5, border: `1px solid ${T.line}`, borderRadius: 8, outline: 'none', background: '#fff', marginBottom: 10 }} />

                  <div style={{ display: 'flex', gap: 8, marginBottom: kind === 'meeting' ? 4 : 16 }}>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)}
                      style={{ flex: 1, padding: '9px 10px', fontSize: 13, border: `1px solid ${T.line}`, borderRadius: 8, outline: 'none', background: '#fff' }} />
                    {kind === 'meeting' && (
                      <input type="time" value={time} onChange={e => setTime(e.target.value)}
                        style={{ flex: 1, padding: '9px 10px', fontSize: 13, border: `1px solid ${T.line}`, borderRadius: 8, outline: 'none', background: '#fff' }} />
                    )}
                  </div>
                  {kind === 'meeting' && (
                    <div style={{ fontSize: 10.5, color: T.textFaint, marginBottom: 16 }}>
                      Logs the meeting only — no Google Calendar sync. Open the {pipe === 'newbiz' ? 'case' : 'request'} directly to schedule with calendar sync.
                    </div>
                  )}

                  {saveError && <div style={{ fontSize: 12, color: T.rose, marginBottom: 10 }}>{saveError}</div>}

                  <button onClick={save} disabled={saving || !text.trim()} style={{
                    width: '100%', padding: '11px 0', fontSize: 13, fontWeight: 700, color: '#fff',
                    background: saving || !text.trim() ? 'var(--ink3)' : 'var(--charcoal)', border: 'none', borderRadius: 9,
                    cursor: saving || !text.trim() ? 'default' : 'pointer',
                  }}>
                    {saving ? 'Saving…' : `Add ${kind === 'todo' ? 'Todo' : 'Meeting'}`}
                  </button>
                </>
              )}

              {step === 'done' && client && (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>✓</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 18 }}>
                    {doneKind === 'service' ? `Service request created for ${client.name}.` : `Added for ${client.name}.`}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button onClick={reset} style={{ padding: '9px 16px', fontSize: 12.5, fontWeight: 600, border: `1px solid ${T.line}`, borderRadius: 8, background: '#fff', color: T.textDim, cursor: 'pointer' }}>Add another</button>
                    <Link href={`/dashboard/business/client/${client.id}`} onClick={close} style={{ padding: '9px 16px', fontSize: 12.5, fontWeight: 600, border: 'none', borderRadius: 8, background: 'var(--charcoal)', color: '#fff', cursor: 'pointer', textDecoration: 'none' }}>
                      View all for {client.name.split(' ')[0]}
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {open && step === 'newBizModal' && advisor && client && (
        <NewBusinessCaseModal
          advisorId={advisor.id}
          clients={clients}
          setClients={setClients}
          presetClient={client}
          onClose={() => setStep('target')}
          onCreated={() => { setDoneKind('case'); setStep('done') }}
        />
      )}
    </>
  )
}