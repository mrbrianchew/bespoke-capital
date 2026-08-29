'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'

// ─── TYPES ───────────────────────────────────────────────────────────────

interface Person { name: string; relationship: string; idNumber: string; mobile: string }
interface Asset { name: string; value: string; ownership: 'Sole' | 'Joint' | 'Shared %'; allocation: string }
interface Liability { name: string; value: string }
interface ResidualShare { name: string; pct: string }

interface WillPrepData {
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

const blankPerson = (): Person => ({ name: '', relationship: '', idNumber: '', mobile: '' })

const DEFAULT_DATA: WillPrepData = {
  beneficiaries: [blankPerson()],
  guardianClause: 'joint',
  guardian: blankPerson(),
  subGuardians: [],
  executors: [blankPerson()],
  subExecutors: [],
  assets: [{ name: '', value: '', ownership: 'Sole', allocation: '' }],
  liabilities: [{ name: '', value: '' }],
  residual: [{ name: '', pct: '' }],
  scope: 'Worldwide',
  survivorshipDays: '30',
  lapsedGift: 'redistribute',
  minorManager: 'executor',
  otherInstructions: '',
  funeralWishes: '',
  finalWords: '',
}

const STEPS = [
  'gate', 'intro', 'beneficiaries', 'guardian', 'subguardians',
  'executor', 'subexecutors', 'assets', 'liabilities', 'residual',
  'clauses', 'instructions', 'review', 'done',
] as const
type Step = typeof STEPS[number]

// Section label shown above each step's question — this is what makes it
// clear which part of the Will you're on (Beneficiaries, Guardian, etc.)
// rather than just a bare step counter.
const SECTION_LABEL: Partial<Record<Step, string>> = {
  intro: 'Getting Started',
  beneficiaries: 'Beneficiaries',
  guardian: 'Guardian',
  subguardians: 'Guardian — Backup',
  executor: 'Executor',
  subexecutors: 'Executor — Backup',
  assets: 'Assets',
  liabilities: 'Liabilities',
  residual: 'Residual Allocation',
  clauses: 'Clauses',
  instructions: 'Additional Instructions',
  review: 'Review',
}

// ─── STYLE TOKENS (matches EstateSection.tsx) ───────────────────────────

const T = {
  cream: '#F0EDE8', ink: '#1A1816', ink3: '#8A8478', line: '#E8E4DC',
  emerald: '#2A5E46', emeraldBg: '#E8F2ED', rouge: '#8C3B3B',
  gold: '#A8834A', amber: '#E8A838', amberBg: '#F5EFE3',
}

const inputStyle: React.CSSProperties = {
  width: '100%', border: `1px solid ${T.line}`, borderRadius: 8, background: '#fff',
  padding: '11px 13px', fontFamily: 'Inter', fontSize: 14, color: T.ink,
}
const labelStyle: React.CSSProperties = {
  fontSize: 12, color: T.ink3, marginBottom: 7, display: 'block', fontWeight: 500,
}

// ─── SMALL COMPONENTS ────────────────────────────────────────────────────

function PersonCard({ person, onChange, tag, onRemove }: {
  person: Person; onChange: (p: Person) => void; tag: string; onRemove?: () => void
}) {
  return (
    <div style={{ border: `1px solid ${T.line}`, borderRadius: 12, padding: '20px 24px', marginBottom: 14, background: '#fff', position: 'relative' }}>
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.gold, fontWeight: 600, marginBottom: 12, display: 'block' }}>{tag}</span>
      {onRemove && <span onClick={onRemove} style={{ position: 'absolute', top: 20, right: 22, fontSize: 12, color: T.ink3, cursor: 'pointer' }}>Remove</span>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div><label style={labelStyle}>Full name</label>
          <input style={inputStyle} value={person.name} onChange={e => onChange({ ...person, name: e.target.value })} />
        </div>
        <div><label style={labelStyle}>Relationship to you</label>
          <input style={inputStyle} value={person.relationship} onChange={e => onChange({ ...person, relationship: e.target.value })} />
        </div>
        <div><label style={labelStyle}>NRIC / FIN / Passport</label>
          <input style={inputStyle} value={person.idNumber} onChange={e => onChange({ ...person, idNumber: e.target.value })} />
        </div>
        <div><label style={labelStyle}>Mobile number</label>
          <input style={inputStyle} value={person.mobile} onChange={e => onChange({ ...person, mobile: e.target.value })} />
        </div>
      </div>
    </div>
  )
}

function AddLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{ fontSize: 13, color: T.emerald, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 4 }}>
      <span style={{ width: 18, height: 18, border: `1px solid ${T.emerald}`, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>+</span>
      {label}
    </div>
  )
}

function Pill({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{
      border: `1px solid ${selected ? T.emerald : T.line}`, borderRadius: 8, padding: '12px 16px', fontSize: 13.5, cursor: 'pointer',
      background: selected ? T.emeraldBg : '#fff', color: selected ? T.emerald : T.ink, fontWeight: selected ? 600 : 400,
    }}>{label}</div>
  )
}

function Head({ step, total, section, title, hint }: { step: number; total: number; section: string; title: string; hint: string }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 4, marginBottom: 22 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i < step ? T.emerald : i === step ? T.gold : T.line }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.gold, fontWeight: 700, margin: 0 }}>{section}</p>
        <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 10.5, color: T.ink3, margin: 0 }}>Step {step} of {total}</p>
      </div>
      <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 27, fontWeight: 500, margin: '0 0 8px' }}>{title}</h1>
      <p style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, marginBottom: 26 }}>{hint}</p>
    </>
  )
}

function NavBar({ onBack, onNext, backDisabled, nextLabel = 'Continue' }: {
  onBack: () => void; onNext: () => void; backDisabled?: boolean; nextLabel?: string
}) {
  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 36, paddingBottom: 48 }}>
      <button disabled={backDisabled} onClick={onBack} style={{ padding: '13px 26px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: `1px solid ${T.line}`, background: '#fff', color: T.ink3, opacity: backDisabled ? 0.4 : 1, cursor: backDisabled ? 'default' : 'pointer' }}>Back</button>
      <button onClick={onNext} style={{ padding: '13px 26px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: `1px solid ${T.ink}`, background: T.ink, color: T.cream, cursor: 'pointer' }}>{nextLabel}</button>
    </div>
  )
}

// ─── MAIN PAGE ─────────────────────────────────────────────────────────

export default function WillPrepPage() {
  const params = useParams()
  const token = params?.token as string

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [expired, setExpired] = useState(false)
  const [hint, setHint] = useState('')
  const [clientName, setClientName] = useState('')
  const [firm, setFirm] = useState<string | null>(null)

  const [unlocked, setUnlocked] = useState(false)
  const [password, setPassword] = useState('')
  const [gateError, setGateError] = useState('')
  const [gateBusy, setGateBusy] = useState(false)

  const [stepIdx, setStepIdx] = useState(0) // index into STEPS, starts at 'gate'
  const [data, setData] = useState<WillPrepData>(DEFAULT_DATA)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Initial GET — hint/expiry/status only, no data.
  useEffect(() => {
    if (!token) return
    fetch(`/api/will-prep/${token}`)
      .then(r => {
        if (!r.ok) { setNotFound(true); return null }
        return r.json()
      })
      .then(j => {
        if (!j) return
        setHint(j.hint || '')
        setExpired(!!j.expired)
        setClientName(j.clientName || '')
        setFirm(j.firm || null)
        if (j.status === 'submitted') setSubmitted(true)
      })
      .finally(() => setLoading(false))
  }, [token])

  async function unlock() {
    setGateBusy(true)
    setGateError('')
    try {
      const res = await fetch(`/api/will-prep/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlock', password }),
      })
      const j = await res.json()
      if (!res.ok) {
        setGateError(j.error === 'wrong_password' ? 'That password did not match. Please try again.' : 'Something went wrong. Please try again.')
        return
      }
      setData({ ...DEFAULT_DATA, ...(j.data || {}) })
      if (j.status === 'submitted') setSubmitted(true)
      setUnlocked(true)
      setStepIdx(1) // move to intro
    } finally {
      setGateBusy(false)
    }
  }

  // Debounced autosave whenever data changes, once unlocked and not yet submitted.
  const scheduleSave = useCallback((next: WillPrepData) => {
    if (!unlocked || submitted) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      try {
        const res = await fetch(`/api/will-prep/${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save', password, data: next }),
        })
        const j = await res.json()
        if (res.ok) setLastSavedAt(j.savedAt)
      } finally {
        setSaving(false)
      }
    }, 1200)
  }, [unlocked, submitted, password, token])

  function update(patch: Partial<WillPrepData>) {
    setData(prev => {
      const next = { ...prev, ...patch }
      scheduleSave(next)
      return next
    })
  }

  async function submit() {
    const res = await fetch(`/api/will-prep/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'submit', password, data }),
    })
    if (res.ok) {
      setSubmitted(true)
      setStepIdx(STEPS.length - 1)
    }
  }

  const residualTotal = data.residual.reduce((s, r) => s + (parseFloat(r.pct) || 0), 0)
  const stepsWithProgress = STEPS.length - 2 // exclude 'gate' and 'done' from the dots
  const step: Step = STEPS[stepIdx]
  const section = SECTION_LABEL[step] || ''

  function go(delta: number) {
    setStepIdx(i => Math.max(1, Math.min(STEPS.length - 1, i + delta)))
  }

  // ── RENDER STATES ──

  if (loading) {
    return <Shell clientName="" centerContent><div style={{ textAlign: 'center', color: T.ink3, fontSize: 13 }}>Loading…</div></Shell>
  }
  if (notFound) {
    return <Shell clientName="" centerContent><div style={{ textAlign: 'center', color: T.ink3, fontSize: 13 }}>This link isn't valid. Please check with your advisor for the correct link.</div></Shell>
  }
  if (expired && !submitted) {
    return <Shell clientName={clientName} centerContent><div style={{ textAlign: 'center', color: T.ink3, fontSize: 13 }}>This link has expired. Please ask your advisor to send you a new one.</div></Shell>
  }

  if (!unlocked) {
    return (
      <Shell clientName={clientName} centerContent>
        <div>
          <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.gold, fontWeight: 700, margin: '0 0 10px' }}>Getting Started</p>
          <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 27, margin: '0 0 10px', fontWeight: 500 }}>Verify it's you</h1>
          <p style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, marginBottom: 26 }}>
            Enter the password your advisor sent you to continue. This keeps your information private.
          </p>
          <div style={{ maxWidth: 340 }}>
            <label style={labelStyle}>Password</label>
            <input
              style={{ ...inputStyle, marginBottom: 8 }}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') unlock() }}
            />
            {hint && <p style={{ fontSize: 12, color: T.ink3, margin: '0 0 20px', lineHeight: 1.5 }}>Hint: {hint}</p>}
            {gateError && <p style={{ fontSize: 12.5, color: T.rouge, margin: '0 0 14px' }}>{gateError}</p>}
            <button
              disabled={gateBusy || !password}
              onClick={unlock}
              style={{ padding: '13px 28px', borderRadius: 8, border: 'none', background: T.ink, color: T.cream, fontWeight: 600, fontSize: 13.5, opacity: gateBusy || !password ? 0.6 : 1, cursor: gateBusy ? 'default' : 'pointer' }}
            >
              {gateBusy ? 'Checking…' : 'Continue'}
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  if (submitted && step === 'done') {
    return (
      <Shell clientName={clientName} centerContent>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 60, height: 60, borderRadius: '50%', background: T.emeraldBg, color: T.emerald, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, margin: '0 auto 24px', fontWeight: 700 }}>✓</div>
          <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 26, margin: '0 0 10px' }}>Submitted</h1>
          <p style={{ fontSize: 13.5, color: T.ink3, lineHeight: 1.65, maxWidth: 440, margin: '0 auto' }}>
            Thank you — {firm ? `your advisor at ${firm}` : 'your advisor'} will review this and follow up to go through your wishes together before anything is finalised.
            You can reopen this link with the same password to see what you sent.
          </p>
        </div>
      </Shell>
    )
  }

  // ── STEP CONTENT ──

  return (
    <Shell clientName={clientName} saving={saving} lastSavedAt={lastSavedAt}>
      {step === 'intro' && (
        <div style={{ padding: '48px 0 0' }}>
          <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.gold, fontWeight: 700, margin: '0 0 10px' }}>{section}</p>
          <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 27, fontWeight: 500, margin: '0 0 8px' }}>A few things to know</h1>
          <p style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, marginBottom: 14 }}>You can leave and come back — your answers are saved as you go.</p>
          <p style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, marginBottom: 22 }}>You will be contacted to arrange for a session if a date has not been fixed yet. A translation in Mandarin is also provided in this form, and should be used only as a reference.</p>

          <div style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: '16px 18px', marginBottom: 20, maxWidth: 560 }}>
            <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.gold, fontWeight: 700, margin: '0 0 10px' }}>Please read before filling up the form</p>
            <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.65 }}>
              {[
                'Please fill out this form as accurately as possible to avoid any delays in drafting the Will.',
                'If you have more Beneficiaries, Executors, Guardians, Assets or Liabilities than what the form provides, please add accordingly.',
                'This form is not exhaustive, and should be taken as a reference guide. Other considerations may come up in the process of drafting a Will.',
                'This form is meant strictly for your own personal use to prepare for drafting of your Will. The information filled into this form should at all times be kept in strictest confidentiality. You have a responsibility over your own personal data.',
                'The Will drafting and the Will generated are in English.',
              ].map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: i < 4 ? 6 : 0 }}>
                  <span style={{ flexShrink: 0 }}>{i + 1}.</span>
                  <span>{t}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: '16px 18px', marginBottom: 20, maxWidth: 560 }}>
            <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.gold, fontWeight: 700, margin: '0 0 10px' }}>中文（仅供参考）</p>
            <p style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.65, marginBottom: 10 }}>您将会被联系以安排会面时间（如尚未确定日期）。本表格也提供华语翻译，仅供参考之用。</p>
            <p style={{ fontSize: 11.5, color: T.ink3, lineHeight: 1.5, margin: '0 0 8px', fontWeight: 600 }}>填写表格前请先阅读以下内容：</p>
            <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.65 }}>
              {[
                '请尽可能准确地填写本表格，以免延误遗嘱的拟定。',
                '若您的受益人、执行人、监护人、资产或负债数量超过表格所提供的栏位，请自行增添。',
                '本表格并非详尽无遗，仅作参考指南之用。在拟定遗嘱的过程中，可能会出现其他需考虑的事项。',
                '本表格仅供您个人用于准备拟定遗嘱之用。填写于本表格内的资料应始终严格保密。您对自己的个人资料负有责任。',
                '遗嘱的拟定与生成均以英文进行。',
              ].map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: i < 4 ? 6 : 0 }}>
                  <span style={{ flexShrink: 0 }}>{i + 1}.</span>
                  <span>{t}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: T.amberBg, borderLeft: `3px solid ${T.amber}`, borderRadius: '0 8px 8px 0', padding: '14px 18px', fontSize: 12.5, color: '#6B5730', lineHeight: 1.6, marginBottom: 20, maxWidth: 560 }}>
            This form gathers your instructions ahead of your meeting. It is not your Will and has no legal effect on its own. Your advisor will go through everything with you before anything is finalised.
          </div>
          <p style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6 }}>Have these on hand if possible: NRIC numbers for your beneficiaries, executor and guardian, and rough values for your major assets.</p>
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} backDisabled />
        </div>
      )}

      {step === 'beneficiaries' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={1} total={stepsWithProgress} section={section} title="Who should receive your assets?" hint="List everyone you want to leave something to. You will decide exactly what they receive in a later step." />
          {data.beneficiaries.map((b, i) => (
            <PersonCard key={i} tag={`Beneficiary 0${i + 1}`} person={b}
              onChange={p => update({ beneficiaries: data.beneficiaries.map((x, xi) => xi === i ? p : x) })}
              onRemove={data.beneficiaries.length > 1 ? () => update({ beneficiaries: data.beneficiaries.filter((_, xi) => xi !== i) }) : undefined} />
          ))}
          <AddLink label="Add another beneficiary" onClick={() => update({ beneficiaries: [...data.beneficiaries, blankPerson()] })} />
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'guardian' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={2} total={stepsWithProgress} section={section} title="Who should care for your children?" hint="Only needed if you have children under 21. Skip ahead if this does not apply to you." />
          <div style={{ marginBottom: 22, maxWidth: 480 }}>
            <label style={labelStyle}>If something happens to you</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <Pill label="This doesn't apply to me" selected={data.guardianClause === 'none'} onClick={() => update({ guardianClause: 'none' })} />
              <Pill label="Care jointly with my surviving partner" selected={data.guardianClause === 'joint'} onClick={() => update({ guardianClause: 'joint' })} />
              <Pill label="Only step in if neither parent is around" selected={data.guardianClause === 'if_no_parent'} onClick={() => update({ guardianClause: 'if_no_parent' })} />
            </div>
          </div>
          {data.guardianClause !== 'none' && (
            <PersonCard tag="Guardian" person={data.guardian} onChange={p => update({ guardian: p })} />
          )}
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'subguardians' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={3} total={stepsWithProgress} section={section} title="Anyone as a backup?" hint="If your first choice of guardian is not able to take on the role, who is next? Optional, but worth thinking through." />
          {data.subGuardians.map((g, i) => (
            <PersonCard key={i} tag={`Backup ${i + 1}`} person={g}
              onChange={p => update({ subGuardians: data.subGuardians.map((x, xi) => xi === i ? p : x) })}
              onRemove={() => update({ subGuardians: data.subGuardians.filter((_, xi) => xi !== i) })} />
          ))}
          <AddLink label="Add a backup guardian" onClick={() => update({ subGuardians: [...data.subGuardians, blankPerson()] })} />
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'executor' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={4} total={stepsWithProgress} section={section} title="Who should carry out your wishes?" hint="Your Executor manages your estate and makes sure your Will is followed. You can name up to 4 people to act together, or just one." />
          {data.executors.map((ex, i) => (
            <PersonCard key={i} tag={`Executor ${i + 1}`} person={ex}
              onChange={p => update({ executors: data.executors.map((x, xi) => xi === i ? p : x) })}
              onRemove={data.executors.length > 1 ? () => update({ executors: data.executors.filter((_, xi) => xi !== i) }) : undefined} />
          ))}
          {data.executors.length < 4 && (
            <AddLink label="Add a joint executor" onClick={() => update({ executors: [...data.executors, blankPerson()] })} />
          )}
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'subexecutors' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={5} total={stepsWithProgress} section={section} title="A backup executor?" hint="If your first choice cannot act, who should step in? Optional." />
          {data.subExecutors.map((ex, i) => (
            <PersonCard key={i} tag={`Backup ${i + 1}`} person={ex}
              onChange={p => update({ subExecutors: data.subExecutors.map((x, xi) => xi === i ? p : x) })}
              onRemove={() => update({ subExecutors: data.subExecutors.filter((_, xi) => xi !== i) })} />
          ))}
          <AddLink label="Add a backup executor" onClick={() => update({ subExecutors: [...data.subExecutors, blankPerson()] })} />
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'assets' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={6} total={stepsWithProgress} section={section} title="What do you own?" hint="Bank accounts, property, insurance, investments — anything of value. Rough figures are fine." />
          {data.assets.map((a, i) => (
            <div key={i} style={{ border: `1px solid ${T.line}`, borderRadius: 12, padding: '20px 24px', marginBottom: 14, background: '#fff', position: 'relative' }}>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.gold, fontWeight: 600, marginBottom: 12, display: 'block' }}>Asset {i + 1}</span>
              {data.assets.length > 1 && <span onClick={() => update({ assets: data.assets.filter((_, xi) => xi !== i) })} style={{ position: 'absolute', top: 20, right: 22, fontSize: 12, color: T.ink3, cursor: 'pointer' }}>Remove</span>}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>What is it?</label>
                <input style={inputStyle} placeholder="e.g. DBS savings account" value={a.name} onChange={e => update({ assets: data.assets.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x) })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 16 }}>
                <div><label style={labelStyle}>Estimated value</label>
                  <input style={inputStyle} placeholder="S$" value={a.value} onChange={e => update({ assets: data.assets.map((x, xi) => xi === i ? { ...x, value: e.target.value } : x) })} />
                </div>
                <div><label style={labelStyle}>Ownership</label>
                  <select style={inputStyle} value={a.ownership} onChange={e => update({ assets: data.assets.map((x, xi) => xi === i ? { ...x, ownership: e.target.value as Asset['ownership'] } : x) })}>
                    <option>Sole</option><option>Joint</option><option>Shared %</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Leave this to (optional — leave blank to split per your general wishes later)</label>
                <input style={inputStyle} placeholder="e.g. Michelle Chia" value={a.allocation} onChange={e => update({ assets: data.assets.map((x, xi) => xi === i ? { ...x, allocation: e.target.value } : x) })} />
              </div>
            </div>
          ))}
          <AddLink label="Add another asset" onClick={() => update({ assets: [...data.assets, { name: '', value: '', ownership: 'Sole', allocation: '' }] })} />
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'liabilities' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={7} total={stepsWithProgress} section={section} title="Any outstanding debts?" hint="Home loans, car loans, credit cards — anything still owing. Skip if none." />
          {data.liabilities.map((l, i) => (
            <div key={i} style={{ border: `1px solid ${T.line}`, borderRadius: 12, padding: '20px 24px', marginBottom: 14, background: '#fff', position: 'relative' }}>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.gold, fontWeight: 600, marginBottom: 12, display: 'block' }}>Liability {i + 1}</span>
              {data.liabilities.length > 1 && <span onClick={() => update({ liabilities: data.liabilities.filter((_, xi) => xi !== i) })} style={{ position: 'absolute', top: 20, right: 22, fontSize: 12, color: T.ink3, cursor: 'pointer' }}>Remove</span>}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>What is it?</label>
                <input style={inputStyle} placeholder="e.g. Home loan — DBS" value={l.name} onChange={e => update({ liabilities: data.liabilities.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x) })} />
              </div>
              <div>
                <label style={labelStyle}>Outstanding amount</label>
                <input style={inputStyle} placeholder="S$" value={l.value} onChange={e => update({ liabilities: data.liabilities.map((x, xi) => xi === i ? { ...x, value: e.target.value } : x) })} />
              </div>
            </div>
          ))}
          <AddLink label="Add another liability" onClick={() => update({ liabilities: [...data.liabilities, { name: '', value: '' }] })} />
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'residual' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={8} total={stepsWithProgress} section={section} title="Everything else you own" hint="Anything not specifically assigned above — and anything you acquire in future — gets split this way. Shares should add up to 100%." />
          <div style={{ maxWidth: 480 }}>
            {data.residual.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: `1px solid ${T.line}`, fontSize: 13.5 }}>
                <input style={{ flex: 1, border: `1px solid ${T.line}`, borderRadius: 6, padding: '8px 10px', fontSize: 13.5, marginRight: 10 }} placeholder="Beneficiary name" value={r.name} onChange={e => update({ residual: data.residual.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x) })} />
                <input style={{ width: 60, textAlign: 'right', border: `1px solid ${T.line}`, borderRadius: 6, padding: '6px 8px', fontSize: 13, fontFamily: 'DM Mono, monospace' }} value={r.pct} onChange={e => update({ residual: data.residual.map((x, xi) => xi === i ? { ...x, pct: e.target.value } : x) })} />
                <span style={{ marginLeft: 6 }}>%</span>
              </div>
            ))}
            <div style={{ marginTop: 14 }}>
              <AddLink label="Add another share" onClick={() => update({ residual: [...data.residual, { name: '', pct: '' }] })} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12, fontWeight: 600, fontSize: 14, color: residualTotal === 100 ? T.emerald : T.rouge }}>
              <span>Total</span><span>{residualTotal}%</span>
            </div>
            {residualTotal !== 100 && (
              <p style={{ fontSize: 12.5, color: T.rouge, lineHeight: 1.55, marginTop: 8 }}>Shares should add up to 100% — your advisor can help you fix this if you're not sure yet.</p>
            )}
          </div>
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'clauses' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={9} total={stepsWithProgress} section={section} title="A few standard choices" hint="Your advisor can explain any of these further when you meet." />
          <div style={{ maxWidth: 520 }}>
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>Which of your assets does this cover?</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <Pill label="Everything, worldwide" selected={data.scope === 'Worldwide'} onClick={() => update({ scope: 'Worldwide' })} />
                <Pill label="Worldwide, except certain assets" selected={data.scope === 'Excluding'} onClick={() => update({ scope: 'Excluding' })} />
                <Pill label="Singapore assets only" selected={data.scope === 'Singapore'} onClick={() => update({ scope: 'Singapore' })} />
              </div>
            </div>
            <div style={{ marginBottom: 22, maxWidth: 200 }}>
              <label style={labelStyle}>Survivorship period (days)</label>
              <input style={inputStyle} value={data.survivorshipDays} onChange={e => update({ survivorshipDays: e.target.value })} />
            </div>
            <p style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.6, marginTop: -14, marginBottom: 22, maxWidth: 480 }}>If a beneficiary passes away within this many days after you, they're treated as if they passed before you — so their share goes to your backup plan instead of into their own estate.</p>
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>If a beneficiary passes away before you, their share should</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <Pill label="Be redistributed among the others" selected={data.lapsedGift === 'redistribute'} onClick={() => update({ lapsedGift: 'redistribute' })} />
                <Pill label="Still pass to their own estate" selected={data.lapsedGift === 'to_estate'} onClick={() => update({ lapsedGift: 'to_estate' })} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Assets left to a child under 21 should be managed by</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <Pill label="The Executor" selected={data.minorManager === 'executor'} onClick={() => update({ minorManager: 'executor' })} />
                <Pill label="The Guardian" selected={data.minorManager === 'guardian'} onClick={() => update({ minorManager: 'guardian' })} />
              </div>
            </div>
          </div>
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'instructions' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={10} total={stepsWithProgress} section={section} title="Anything else?" hint="All optional." />
          <div style={{ maxWidth: 560 }}>
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Other instructions for your Will</label>
              <textarea style={{ ...inputStyle, minHeight: 90 }} placeholder="Anything specific you'd like included" value={data.otherInstructions} onChange={e => update({ otherInstructions: e.target.value })} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Funeral wishes</label>
              <textarea style={{ ...inputStyle, minHeight: 90 }} placeholder="Optional" value={data.funeralWishes} onChange={e => update({ funeralWishes: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>A few final words</label>
              <textarea style={{ ...inputStyle, minHeight: 90 }} placeholder="Optional — a personal note, if you'd like to leave one" value={data.finalWords} onChange={e => update({ finalWords: e.target.value })} />
            </div>
          </div>
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'review' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={11} total={stepsWithProgress} section={section} title="Review before you submit" hint="Take a moment to check everything looks right. You can go back and change anything." />
          <div style={{ maxWidth: 560 }}>
            <ReviewBlock title="Beneficiaries" lines={data.beneficiaries.map(b => `${b.relationship || '—'}: ${b.name || '(not named yet)'}`)} />
            <ReviewBlock title="Executor" lines={data.executors.map(e => e.name || '(not named yet)')} />
            <ReviewBlock title="Residual split" lines={data.residual.map(r => `${r.pct || 0}%: ${r.name || '(not named yet)'}`)} />
            <div style={{ background: T.amberBg, borderLeft: `3px solid ${T.amber}`, borderRadius: '0 8px 8px 0', padding: '14px 18px', fontSize: 12.5, color: '#6B5730', lineHeight: 1.6, marginBottom: 20 }}>
              Submitting sends this to your advisor to review. It doesn't finalise your Will — they'll go through everything with you first.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8, paddingBottom: 48 }}>
            <button onClick={() => go(-1)} style={{ padding: '13px 26px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: `1px solid ${T.line}`, background: '#fff', color: T.ink3, cursor: 'pointer' }}>Back</button>
            <button onClick={submit} style={{ padding: '13px 26px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: `1px solid ${T.ink}`, background: T.ink, color: T.cream, cursor: 'pointer' }}>Submit</button>
          </div>
        </div>
      )}
    </Shell>
  )
}

function ReviewBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h5 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, fontWeight: 600, margin: '0 0 8px', color: T.gold }}>{title}</h5>
      {lines.map((l, i) => (
        <div key={i} style={{ fontSize: 13, color: T.ink, padding: '6px 0', borderBottom: `1px dashed ${T.line}` }}>{l}</div>
      ))}
    </div>
  )
}

function useViewportWidth() {
  const [vw, setVw] = useState(0)
  useEffect(() => {
    const update = () => setVw(window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return vw
}

// Website layout — no floating card, no drop shadow. Full-width page
// background with a real header/footer, and a content column that widens
// on tablet/desktop instead of staying phone-width everywhere.
function Shell({ children, clientName, saving, lastSavedAt, centerContent }: {
  children: React.ReactNode; clientName: string; saving?: boolean; lastSavedAt?: string | null; centerContent?: boolean
}) {
  const vw = useViewportWidth()
  const contentWidth = vw === 0 ? 520 : vw >= 1024 ? 720 : vw >= 640 ? 640 : 520

  return (
    <div style={{ minHeight: '100vh', background: '#FAF8F5', display: 'flex', flexDirection: 'column', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ background: '#fff', borderBottom: `1px solid ${T.line}` }}>
        <div style={{ maxWidth: contentWidth, margin: '0 auto', padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: T.gold, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: 'Cormorant Garamond, serif', flexShrink: 0 }}>B</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 19, fontWeight: 600 }}>Bespoke Capital</div>
          </div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10.5, color: T.ink3, textAlign: 'right', lineHeight: 1.5 }}>
            <div>WILL PREPARATION{clientName ? ` · ${clientName.toUpperCase()}` : ''}</div>
            {typeof saving !== 'undefined' && (
              <div>{saving ? 'Saving…' : lastSavedAt ? 'Saved' : ''}</div>
            )}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: centerContent ? 'center' : 'flex-start', padding: '0 24px' }}>
        <div style={{ width: contentWidth, maxWidth: '100%' }}>
          {children}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${T.line}`, background: '#fff' }}>
        <div style={{ maxWidth: contentWidth, margin: '0 auto', padding: '16px 24px', textAlign: 'center', fontSize: 11, color: T.ink3 }}>
          Bespoke Capital · Your information is kept private and confidential
        </div>
      </div>
    </div>
  )
}