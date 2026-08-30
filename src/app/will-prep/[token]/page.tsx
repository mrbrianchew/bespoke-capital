'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { BrandMark } from '@/components/BrandMark'

// ─── TYPES ───────────────────────────────────────────────────────────────

interface Person { name: string; relationship: string; idNumber: string; mobile: string }
interface Asset { name: string; value: string; ownership: 'Sole' | 'Joint' | 'Shared %'; allocation: string }
interface Liability { name: string; value: string }
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

const blankPerson = (): Person => ({ name: '', relationship: '', idNumber: '', mobile: '' })

// Validates the checksum on Singapore NRIC/FIN numbers (S/T/F/G prefixes).
// Returns true for anything that doesn't look like an NRIC/FIN shape (e.g.
// a foreign passport number) since those aren't subject to this checksum
// at all — this only catches typos in numbers that are meant to be
// NRIC/FIN. M-series FINs (issued from 2022) use a less publicly
// documented algorithm and are deliberately left unchecked here to avoid
// wrongly flagging a valid M-series number as an error.
function isLikelyValidNric(raw: string): boolean {
  const v = raw.trim().toUpperCase()
  const m = /^([STFG])(\d{7})([A-Z])$/.exec(v)
  if (!m) return true
  const [, prefix, digitsStr, letter] = m
  const weights = [2, 7, 6, 5, 4, 3, 2]
  let sum = digitsStr.split('').reduce((acc, d, i) => acc + Number(d) * weights[i], 0)
  if (prefix === 'T' || prefix === 'G') sum += 4
  const remainder = sum % 11
  const table = (prefix === 'S' || prefix === 'T')
    ? ['J', 'Z', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A']
    : ['X', 'W', 'U', 'T', 'R', 'Q', 'P', 'N', 'J', 'L', 'K']
  return table[remainder] === letter
}

const DEFAULT_DATA: WillPrepData = {
  testatorFullName: '',
  testatorIdNo: '',
  testatorIdIssuingCountry: '',
  testatorCountryOfResidence: '',
  testatorAddress: '',
  testatorGender: '',
  testatorDob: '',
  testatorReligion: '',
  testatorMaritalStatus: '',
  testatorNumChildren: '',
  testatorMobile: '',
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
  'gate', 'intro', 'considerations', 'testator', 'beneficiaries', 'guardian', 'subguardians',
  'executor', 'subexecutors', 'assets', 'liabilities', 'residual',
  'clauses', 'instructions', 'review', 'done',
] as const
type Step = typeof STEPS[number]

// Section label shown above each step's question — this is what makes it
// clear which part of the Will you're on (Beneficiaries, Guardian, etc.)
// rather than just a bare step counter.
const SECTION_LABEL: Partial<Record<Step, string>> = {
  intro: 'Getting Started 开始',
  considerations: 'Getting Ready 准备工作',
  testator: 'Your Personal Details 您的个人资料',
  beneficiaries: 'Beneficiaries 受益人',
  guardian: 'Guardian 监护人',
  subguardians: 'Substitute Guardian 替代监护人',
  executor: 'Executor 执行人',
  subexecutors: 'Substitute Executor 替代执行人',
  assets: 'Assets 资产',
  liabilities: 'Liabilities 债务',
  residual: 'Residual Allocation 剩余资产分配',
  clauses: 'Clauses 条款',
  instructions: 'Additional Instructions 其他指示',
  review: 'Review 审阅',
}

// ─── STYLE TOKENS (matches EstateSection.tsx) ───────────────────────────

const T = {
  cream: '#F0EDE8', ink: '#1A1816', ink3: '#8A8478', line: '#E8E4DC',
  emerald: '#2A5E46', emeraldBg: '#E8F2ED', rouge: '#8C3B3B',
  gold: '#A8834A', amber: '#E8A838', amberBg: '#F5EFE3',
}

const inputStyle: React.CSSProperties = {
  width: '100%', border: `1px solid ${T.line}`, borderRadius: 8, background: '#fff',
  padding: '11px 13px', fontFamily: 'Inter', fontSize: 15.5, color: T.ink,
}
const labelStyle: React.CSSProperties = {
  fontSize: 13, color: T.ink3, marginBottom: 7, display: 'block', fontWeight: 500,
}

// ─── SMALL COMPONENTS ────────────────────────────────────────────────────

function PersonCard({ person, onChange, tag, onRemove }: {
  person: Person; onChange: (p: Person) => void; tag: string; onRemove?: () => void
}) {
  return (
    <div style={{ border: `1px solid ${T.line}`, borderRadius: 12, padding: '20px 24px', marginBottom: 14, background: '#fff', position: 'relative' }}>
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.gold, fontWeight: 600, marginBottom: 12, display: 'block' }}>{tag}</span>
      {onRemove && <span onClick={onRemove} style={{ position: 'absolute', top: 20, right: 22, fontSize: 13, color: T.ink3, cursor: 'pointer' }}>Remove 移除</span>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div><label style={labelStyle}>Full name 全名</label>
          <input style={inputStyle} value={person.name} onChange={e => onChange({ ...person, name: e.target.value })} />
        </div>
        <div><label style={labelStyle}>Relationship to you 与您的关系</label>
          <input style={inputStyle} value={person.relationship} onChange={e => onChange({ ...person, relationship: e.target.value })} />
        </div>
        <div><label style={labelStyle}>NRIC / FIN / Passport 身份证/FIN/护照</label>
          <input style={inputStyle} value={person.idNumber} onChange={e => onChange({ ...person, idNumber: e.target.value })} />
          {person.idNumber.trim() !== '' && !isLikelyValidNric(person.idNumber) && (
            <div style={{ fontSize: 12, color: T.rouge, marginTop: 4 }}>This doesn't look like a valid NRIC/FIN — please double-check it. 这看起来不是有效的身份证/FIN号码，请再次检查。</div>
          )}
        </div>
        <div><label style={labelStyle}>Mobile number 手机号码</label>
          <input style={inputStyle} value={person.mobile} onChange={e => onChange({ ...person, mobile: e.target.value })} />
        </div>
      </div>
    </div>
  )
}

function AddLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{ fontSize: 14.5, color: T.emerald, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 4 }}>
      <span style={{ width: 18, height: 18, border: `1px solid ${T.emerald}`, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>+</span>
      {label}
    </div>
  )
}

function Pill({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{
      border: `1px solid ${selected ? T.emerald : T.line}`, borderRadius: 8, padding: '12px 16px', fontSize: 15, cursor: 'pointer',
      background: selected ? T.emeraldBg : '#fff', color: selected ? T.emerald : T.ink, fontWeight: selected ? 600 : 400,
    }}>{label}</div>
  )
}

function Head({ step, total, section, title, hint }: { step: number; total: number; section: string; title: React.ReactNode; hint: React.ReactNode }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 4, marginBottom: 22 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i < step ? T.emerald : i === step ? T.gold : T.line }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.gold, fontWeight: 700, margin: 0 }}>{section}</p>
        <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 11.5, color: T.ink3, margin: 0 }}>Step {step} of {total} · 第 {step}/{total} 步</p>
      </div>
      <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 500, margin: '0 0 8px', whiteSpace: 'pre-line' }}>{title}</h1>
      <p style={{ fontSize: 14.5, color: T.ink3, lineHeight: 1.6, marginBottom: 26, whiteSpace: 'pre-line' }}>{hint}</p>
    </>
  )
}

function NavBar({ onBack, onNext, backDisabled, nextLabel = 'Continue 继续' }: {
  onBack: () => void; onNext: () => void; backDisabled?: boolean; nextLabel?: string
}) {
  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 36, paddingBottom: 48 }}>
      <button disabled={backDisabled} onClick={onBack} style={{ padding: '13px 26px', borderRadius: 8, fontSize: 14.5, fontWeight: 600, border: `1px solid ${T.line}`, background: '#fff', color: T.ink3, opacity: backDisabled ? 0.4 : 1, cursor: backDisabled ? 'default' : 'pointer' }}>Back 返回</button>
      <button onClick={onNext} style={{ padding: '13px 26px', borderRadius: 8, fontSize: 14.5, fontWeight: 600, border: `1px solid ${T.ink}`, background: T.ink, color: T.cream, cursor: 'pointer' }}>{nextLabel}</button>
    </div>
  )
}

// ─── CONSIDERATIONS CHECKLIST HELPERS ───────────────────────────────────
// Bilingual "things to prepare" checklist — local-only ticks, not saved.

function ChecklistSection({ title, titleZh, children }: { title: string; titleZh: string; children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${T.line}`, borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
      <div style={{ padding: '13px 18px', borderBottom: `1px solid ${T.line}`, background: T.cream, fontWeight: 700, fontSize: 14.5, color: T.ink }}>
        {title} <span style={{ fontWeight: 500 }}>{titleZh}</span>
      </div>
      {children}
    </div>
  )
}

function ChecklistRow({ num, en, zh, checked, onToggle, last }: {
  num: string; en: string; zh: string; checked: boolean; onToggle: () => void; last?: boolean
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '14px 18px', borderBottom: last ? 'none' : `1px solid ${T.line}` }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontSize: 13.5, color: T.ink3, flexShrink: 0 }}>{num}.</span>
        <div>
          <div style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>{en}</div>
          <div style={{ fontSize: 13.5, color: T.ink3, lineHeight: 1.5, marginTop: 2 }}>{zh}</div>
        </div>
      </div>
      <input type="checkbox" checked={checked} onChange={onToggle} style={{ width: 20, height: 20, flexShrink: 0, marginTop: 2, accentColor: T.gold, cursor: 'pointer' }} />
    </div>
  )
}

function ChecklistSingleRow({ en, zh, checked, onToggle }: { en: string; zh: string; checked: boolean; onToggle: () => void }) {
  return (
    <div style={{ border: `1px solid ${T.line}`, borderRadius: 10, marginBottom: 12, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14.5, color: T.ink }}>
        {en} <span style={{ fontWeight: 500 }}>{zh}</span>
      </div>
      <input type="checkbox" checked={checked} onChange={onToggle} style={{ width: 20, height: 20, flexShrink: 0, accentColor: T.gold, cursor: 'pointer' }} />
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
  const [showIntroTerms, setShowIntroTerms] = useState(false)
  // Purely a personal "have I got this ready" aid for the client — not part
  // of the saved form data, so it's local-only state, not persisted.
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const toggleChecklist = (key: string) => setChecklist(prev => ({ ...prev, [key]: !prev[key] }))

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
        setGateError(j.error === 'wrong_password' ? 'That password did not match. Please try again. 密码不正确，请重试。' : 'Something went wrong. Please try again. 出了点问题，请重试。')
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
    return <Shell clientName="" firm={firm} centerContent><div style={{ textAlign: 'center', color: T.ink3, fontSize: 14.5 }}>Loading… 加载中…</div></Shell>
  }
  if (notFound) {
    return <Shell clientName="" firm={firm} centerContent><div style={{ textAlign: 'center', color: T.ink3, fontSize: 14.5 }}>This link isn't valid. Please check with your advisor for the correct link. 此链接无效，请向您的顾问确认正确的链接。</div></Shell>
  }
  if (expired && !submitted) {
    return <Shell clientName={clientName} firm={firm} centerContent><div style={{ textAlign: 'center', color: T.ink3, fontSize: 14.5 }}>This link has expired. Please ask your advisor to send you a new one. 此链接已过期，请向您的顾问索取新的链接。</div></Shell>
  }

  if (!unlocked) {
    return (
      <Shell clientName={clientName} firm={firm} centerContent>
        <div>
          <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.gold, fontWeight: 700, margin: '0 0 10px' }}>Getting Started 开始</p>
          <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, margin: '0 0 10px', fontWeight: 500 }}>Verify it's you<br />验证身份</h1>
          <p style={{ fontSize: 14.5, color: T.ink3, lineHeight: 1.6, marginBottom: 26 }}>
            Enter the password your advisor sent you to continue. This keeps your information private.
            <br />请输入您的顾问提供的密码以继续。这将确保您的资料保密。
          </p>
          <div style={{ maxWidth: 340 }}>
            <label style={labelStyle}>Password 密码</label>
            <input
              style={{ ...inputStyle, marginBottom: 8 }}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') unlock() }}
            />
            {hint && <p style={{ fontSize: 13, color: T.ink3, margin: '0 0 20px', lineHeight: 1.5 }}>Hint 提示: {hint}</p>}
            {gateError && <p style={{ fontSize: 13.5, color: T.rouge, margin: '0 0 14px' }}>{gateError}</p>}
            <button
              disabled={gateBusy || !password}
              onClick={unlock}
              style={{ padding: '13px 28px', borderRadius: 8, border: 'none', background: T.ink, color: T.cream, fontWeight: 600, fontSize: 15, opacity: gateBusy || !password ? 0.6 : 1, cursor: gateBusy ? 'default' : 'pointer' }}
            >
              {gateBusy ? 'Checking… 正在核实…' : 'Continue 继续'}
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  if (submitted && step === 'done') {
    return (
      <Shell clientName={clientName} firm={firm} centerContent>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 60, height: 60, borderRadius: '50%', background: T.emeraldBg, color: T.emerald, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, margin: '0 auto 24px', fontWeight: 700 }}>✓</div>
          <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, margin: '0 0 10px' }}>Submitted<br />已提交</h1>
          <p style={{ fontSize: 15, color: T.ink3, lineHeight: 1.65, maxWidth: 440, margin: '0 auto' }}>
            Thank you — {firm ? `your advisor at ${firm}` : 'your advisor'} will review this and follow up to go through your wishes together before anything is finalised.
            You can reopen this link with the same password to see what you sent.
            <br /><br />
            谢谢您 — {firm ? `${firm}的顾问` : '您的顾问'}将会审阅此内容，并与您联系，在最终确定前一同核对您的意愿。
            您可以使用相同密码重新打开此链接，查看您所提交的内容。
          </p>
        </div>
      </Shell>
    )
  }

  // ── STEP CONTENT ──

  return (
    <Shell clientName={clientName} firm={firm} saving={saving} lastSavedAt={lastSavedAt}>
      {step === 'intro' && (
        <div style={{ padding: '48px 0 0' }}>
          <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.gold, fontWeight: 700, margin: '0 0 10px' }}>{section}</p>
          <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 500, margin: '0 0 8px' }}>A few things to know<br />几点须知</h1>
          <p style={{ fontSize: 14.5, color: T.ink3, lineHeight: 1.6, marginBottom: 14 }}>
            You can leave and come back — your answers are saved as you go.
            <br />您可以随时离开并稍后返回 — 您的回答会自动保存。
          </p>
          <p style={{ fontSize: 14.5, color: T.ink3, lineHeight: 1.6, marginBottom: 22 }}>You will be contacted to arrange for a session if a date has not been fixed yet. A translation in Mandarin is also provided in this form, and should be used only as a reference.</p>

          <div style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: '16px 18px', marginBottom: 20 }}>
            <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.gold, fontWeight: 700, margin: '0 0 10px' }}>Please read before filling up the form</p>
            <div style={{ fontSize: 13.5, color: T.ink3, lineHeight: 1.65 }}>
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

          <div style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: '16px 18px', marginBottom: 20 }}>
            <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.gold, fontWeight: 700, margin: '0 0 10px' }}>中文（仅供参考）</p>
            <p style={{ fontSize: 13.5, color: T.ink3, lineHeight: 1.65, marginBottom: 10 }}>您将会被联系以安排会面时间（如尚未确定日期）。本表格也提供华语翻译，仅供参考之用。</p>
            <p style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, margin: '0 0 8px', fontWeight: 600 }}>填写表格前请先阅读以下内容：</p>
            <div style={{ fontSize: 13.5, color: T.ink3, lineHeight: 1.65 }}>
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

          <div style={{ background: T.amberBg, borderLeft: `3px solid ${T.amber}`, borderRadius: '0 8px 8px 0', padding: '14px 18px', fontSize: 13.5, color: '#6B5730', lineHeight: 1.6, marginBottom: 20 }}>
            This form gathers your instructions ahead of your meeting. It is not your Will and has no legal effect on its own. Your advisor will go through everything with you before anything is finalised.
            <br /><br />本表格用于收集您在会面前的指示，并非您的遗嘱，本身不具法律效力。您的顾问将在最终确定前与您逐一核对所有内容。
          </div>
          <p style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, marginBottom: 4 }}>
            By proceeding, you agree to the{' '}
            <button
              onClick={() => setShowIntroTerms(true)}
              style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: T.ink, textDecoration: 'underline', cursor: 'pointer' }}
            >
              Terms and Conditions 条款与细则
            </button>
            .
          </p>
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} backDisabled />
          {showIntroTerms && <TermsModal firm={firm} onClose={() => setShowIntroTerms(false)} />}
        </div>
      )}

      {step === 'considerations' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={1} total={stepsWithProgress} section={section} title={<>A few things to prepare<br />几项准备工作</>} hint={<>This isn't something to fill in now — just a preview of what's ahead, so you can have the right information on hand.<br />这部分现在无需填写 — 只是让您预先了解接下来的内容，以便准备好相关资料。</>} />

          <div style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: '14px 18px', marginBottom: 24, fontSize: 13.5, color: T.ink, lineHeight: 1.6 }}>
            <strong>Please bring along your identification document (e.g. NRIC / Foreign ID / Passport) on the day of the meeting.</strong>
            <br />请在会面当天携带身份证件（例如NRIC / 外国身份证 / 护照）。
            <p style={{ marginTop: 10, marginBottom: 0, color: T.ink3, fontWeight: 400 }}>
              Have these on hand if possible: NRIC numbers for your beneficiaries, executor and guardian, and rough values for your major assets.
              <br />请尽量准备好：受益人、执行人及监护人的身份证号码，以及您主要资产的大概价值。
            </p>
          </div>

          <ChecklistSection title="Personnel" titleZh="人员">
            <ChecklistRow num="i" en="Who do you want to gift your assets to (Beneficiary)" zh="谁将收到您的资产（受益人）" checked={!!checklist.beneficiary} onToggle={() => toggleChecklist('beneficiary')} />
            <ChecklistRow num="ii" en="Who will take care of your minor children (Guardian)" zh="谁来照顾您的未成年子女（监护人）" checked={!!checklist.guardian} onToggle={() => toggleChecklist('guardian')} />
            <ChecklistRow num="iii" en="Who (sole or joint) will oversee the execution of your Will (Executor)" zh="谁（单独或联合）将执行您的遗嘱（执行人）" checked={!!checklist.executor} onToggle={() => toggleChecklist('executor')} />
            <ChecklistRow num="iv" en="Substitutes for ii. and iii." zh="ii. 和 iii. 的替代人" checked={!!checklist.substitutes} onToggle={() => toggleChecklist('substitutes')} last />
          </ChecklistSection>

          <ChecklistSection title="Assets / Debts" titleZh="资产与债务">
            <ChecklistRow num="i" en="What assets / debts do you have (Identifying details, Estimated Value, Ownership Type)" zh="您拥有哪些资产与债务（识别详细信息，估计市场价值，所有权形式）" checked={!!checklist.assetsDebts} onToggle={() => toggleChecklist('assetsDebts')} />
            <ChecklistRow num="ii" en="How do you want to distribute them" zh="您想如何分配" checked={!!checklist.distribution} onToggle={() => toggleChecklist('distribution')} last />
          </ChecklistSection>

          <ChecklistSingleRow en="Others Instructions" zh="遗嘱中的其他指示" checked={!!checklist.otherInstructions} onToggle={() => toggleChecklist('otherInstructions')} />
          <ChecklistSingleRow en="Funeral Wishes (if any)" zh="葬礼安排（如有）" checked={!!checklist.funeralWishes} onToggle={() => toggleChecklist('funeralWishes')} />
          <ChecklistSingleRow en="Last Words (if any)" zh="任何遗言（如有）" checked={!!checklist.lastWords} onToggle={() => toggleChecklist('lastWords')} />

          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'testator' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={2} total={stepsWithProgress} section={section} title={<>A few details about you, the Testator<br />关于您（遗嘱人）的资料</>} hint={<>&quot;Testator&quot; is simply the legal term for the person making the Will — that&apos;s you. These details go on the Will itself, so they need to match your ID exactly.<br />&quot;遗嘱人&quot;是指立遗嘱的人，也就是您本人。这些资料将写入遗嘱正本，请确保与您的身份证件完全一致。</>} />
          <div style={{ maxWidth: 520 }}>
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Full Name 全名</label>
              <input style={inputStyle} value={data.testatorFullName} onChange={e => update({ testatorFullName: e.target.value })} placeholder="As per your NRIC / passport 请与身份证/护照一致" />
            </div>
            <div style={{ display: 'flex', gap: 14, marginBottom: 18 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>ID No. (e.g. NRIC) 身份证号码</label>
                <input style={inputStyle} value={data.testatorIdNo} onChange={e => update({ testatorIdNo: e.target.value })} />
                {data.testatorIdNo.trim() !== '' && !isLikelyValidNric(data.testatorIdNo) && (
                  <div style={{ fontSize: 12, color: T.rouge, marginTop: 4 }}>This doesn't look like a valid NRIC/FIN — please double-check it. 这看起来不是有效的身份证/FIN号码，请再次检查。</div>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>ID Issuing Country 身份证签发国</label>
                <input style={inputStyle} value={data.testatorIdIssuingCountry} onChange={e => update({ testatorIdIssuingCountry: e.target.value })} placeholder="e.g. Singapore 例如：新加坡" />
              </div>
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Country of Residence 居住国家</label>
              <input style={inputStyle} value={data.testatorCountryOfResidence} onChange={e => update({ testatorCountryOfResidence: e.target.value })} placeholder="e.g. Singapore 例如：新加坡" />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Residential Address 住址</label>
              <textarea style={{ ...inputStyle, minHeight: 70 }} value={data.testatorAddress} onChange={e => update({ testatorAddress: e.target.value })} />
            </div>
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>Gender 性别</label>
              <div style={{ display: 'flex', gap: 9 }}>
                <Pill label="Male 男" selected={data.testatorGender === 'Male'} onClick={() => update({ testatorGender: 'Male' })} />
                <Pill label="Female 女" selected={data.testatorGender === 'Female'} onClick={() => update({ testatorGender: 'Female' })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, marginBottom: 18 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Date of Birth 出生日期</label>
                <input type="date" style={inputStyle} value={data.testatorDob} onChange={e => update({ testatorDob: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Religion 宗教</label>
                <input style={inputStyle} value={data.testatorReligion} onChange={e => update({ testatorReligion: e.target.value })} />
              </div>
            </div>
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>Marital Status 婚姻状况</label>
              <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                <Pill label="Single 单身" selected={data.testatorMaritalStatus === 'Single'} onClick={() => update({ testatorMaritalStatus: 'Single' })} />
                <Pill label="Married 已婚" selected={data.testatorMaritalStatus === 'Married'} onClick={() => update({ testatorMaritalStatus: 'Married' })} />
                <Pill label="Divorced 离婚" selected={data.testatorMaritalStatus === 'Divorced'} onClick={() => update({ testatorMaritalStatus: 'Divorced' })} />
                <Pill label="Widowed 丧偶" selected={data.testatorMaritalStatus === 'Widowed'} onClick={() => update({ testatorMaritalStatus: 'Widowed' })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>No. of Children 几个子女</label>
                <input type="number" min="0" style={inputStyle} value={data.testatorNumChildren} onChange={e => update({ testatorNumChildren: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Mobile Number 手机号码</label>
                <input style={inputStyle} value={data.testatorMobile} onChange={e => update({ testatorMobile: e.target.value })} />
              </div>
            </div>
          </div>
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'beneficiaries' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={3} total={stepsWithProgress} section={section} title={<>Who should receive your assets?<br />谁将获得您的资产？</>} hint={<>List everyone you want to leave something to. You will decide exactly what they receive in a later step.<br />列出所有您想留下遗产的人，具体分配将在稍后步骤中决定。</>} />
          {data.beneficiaries.map((b, i) => (
            <PersonCard key={i} tag={`Beneficiary 0${i + 1} 受益人 0${i + 1}`} person={b}
              onChange={p => update({ beneficiaries: data.beneficiaries.map((x, xi) => xi === i ? p : x) })}
              onRemove={data.beneficiaries.length > 1 ? () => update({ beneficiaries: data.beneficiaries.filter((_, xi) => xi !== i) }) : undefined} />
          ))}
          <AddLink label="Add another beneficiary 添加另一位受益人" onClick={() => update({ beneficiaries: [...data.beneficiaries, blankPerson()] })} />
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'guardian' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={4} total={stepsWithProgress} section={section} title={<>Who should care for your children?<br />谁来照顾您的孩子？</>} hint={<>Only needed if you have children under 21. Skip ahead if this does not apply to you.<br />仅在您有21岁以下子女时才需要填写。若不适用，可跳过此步骤。</>} />
          <div style={{ marginBottom: 22, maxWidth: 480 }}>
            <label style={labelStyle}>Guardianship Clause 监护条款</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <Pill label="No guardianship clause 无监护条款" selected={data.guardianClause === 'none'} onClick={() => update({ guardianClause: 'none' })} />
              <Pill label="To act jointly with other parent 与另一位尚存父母共同担任监护人" selected={data.guardianClause === 'joint'} onClick={() => update({ guardianClause: 'joint' })} />
              <Pill label="To act only if no parents survives 只有在没有父母幸存的情况下才担任为监护人" selected={data.guardianClause === 'if_no_parent'} onClick={() => update({ guardianClause: 'if_no_parent' })} />
            </div>
          </div>
          {data.guardianClause !== 'none' && (
            <PersonCard tag="Guardian 监护人" person={data.guardian} onChange={p => update({ guardian: p })} />
          )}
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'subguardians' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={5} total={stepsWithProgress} section={section} title={<>A substitute guardian?<br />替代监护人？</>} hint={<>If your first choice of guardian is not able to take on the role, who is next? Optional, but worth thinking through.<br />若您的首选监护人无法履行职责，下一位人选是谁？此项为选填，但值得考虑。</>} />
          {data.subGuardians.map((g, i) => (
            <PersonCard key={i} tag={`Substitute ${i + 1} 替代 ${i + 1}`} person={g}
              onChange={p => update({ subGuardians: data.subGuardians.map((x, xi) => xi === i ? p : x) })}
              onRemove={() => update({ subGuardians: data.subGuardians.filter((_, xi) => xi !== i) })} />
          ))}
          <AddLink label="Add a substitute guardian 添加替代监护人" onClick={() => update({ subGuardians: [...data.subGuardians, blankPerson()] })} />
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'executor' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={6} total={stepsWithProgress} section={section} title={<>Who should carry out your wishes?<br />谁来执行您的意愿？</>} hint={<>Your Executor manages your estate and makes sure your Will is followed. You can name up to 4 people to act together, or just one.<br />您的执行人将管理您的遗产并确保遗嘱得以执行。您最多可指定4人共同担任，或仅指定一人。</>} />
          {data.executors.map((ex, i) => (
            <PersonCard key={i} tag={`Executor ${i + 1} 执行人 ${i + 1}`} person={ex}
              onChange={p => update({ executors: data.executors.map((x, xi) => xi === i ? p : x) })}
              onRemove={data.executors.length > 1 ? () => update({ executors: data.executors.filter((_, xi) => xi !== i) }) : undefined} />
          ))}
          {data.executors.length < 4 && (
            <AddLink label="Add a joint executor 添加联合执行人" onClick={() => update({ executors: [...data.executors, blankPerson()] })} />
          )}
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'subexecutors' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={7} total={stepsWithProgress} section={section} title={<>A substitute executor?<br />替代执行人？</>} hint={<>If your first choice cannot act, who should step in? Optional.<br />若您的首选执行人无法履行职责，应由谁接替？此项为选填。</>} />
          {data.subExecutors.map((ex, i) => (
            <PersonCard key={i} tag={`Substitute ${i + 1} 替代 ${i + 1}`} person={ex}
              onChange={p => update({ subExecutors: data.subExecutors.map((x, xi) => xi === i ? p : x) })}
              onRemove={() => update({ subExecutors: data.subExecutors.filter((_, xi) => xi !== i) })} />
          ))}
          <AddLink label="Add a substitute executor 添加替代执行人" onClick={() => update({ subExecutors: [...data.subExecutors, blankPerson()] })} />
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'assets' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={8} total={stepsWithProgress} section={section} title={<>What do you own?<br />您拥有哪些资产？</>} hint={<>Bank accounts, property, insurance, investments — anything of value. Rough figures are fine.<br />银行账户、房产、保险、投资 — 任何有价值的资产皆可。大概金额即可。</>} />
          {data.assets.map((a, i) => (
            <div key={i} style={{ border: `1px solid ${T.line}`, borderRadius: 12, padding: '20px 24px', marginBottom: 14, background: '#fff', position: 'relative' }}>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.gold, fontWeight: 600, marginBottom: 12, display: 'block' }}>Asset {i + 1} 资产 {i + 1}</span>
              {data.assets.length > 1 && <span onClick={() => update({ assets: data.assets.filter((_, xi) => xi !== i) })} style={{ position: 'absolute', top: 20, right: 22, fontSize: 13, color: T.ink3, cursor: 'pointer' }}>Remove 移除</span>}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>What is it? 这是什么？</label>
                <input style={inputStyle} placeholder="e.g. DBS savings account 例如：星展储蓄账户" value={a.name} onChange={e => update({ assets: data.assets.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x) })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 16 }}>
                <div><label style={labelStyle}>Estimated value 估计价值</label>
                  <input style={inputStyle} placeholder="S$" value={a.value} onChange={e => update({ assets: data.assets.map((x, xi) => xi === i ? { ...x, value: e.target.value } : x) })} />
                </div>
                <div><label style={labelStyle}>Ownership 所有权</label>
                  <select style={inputStyle} value={a.ownership} onChange={e => update({ assets: data.assets.map((x, xi) => xi === i ? { ...x, ownership: e.target.value as Asset['ownership'] } : x) })}>
                    <option>Sole 独有</option><option>Joint 共有</option><option>Shared % 按比例共有</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Leave this to (optional — leave blank to split per your general wishes later) 留给谁（选填 — 留空则按您稍后的整体分配意愿处理）</label>
                <input style={inputStyle} placeholder="e.g. Michelle Chia 例如：陈美玲" value={a.allocation} onChange={e => update({ assets: data.assets.map((x, xi) => xi === i ? { ...x, allocation: e.target.value } : x) })} />
              </div>
            </div>
          ))}
          <AddLink label="Add another asset 添加另一项资产" onClick={() => update({ assets: [...data.assets, { name: '', value: '', ownership: 'Sole', allocation: '' }] })} />
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'liabilities' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={9} total={stepsWithProgress} section={section} title={<>Any outstanding debts?<br />有任何未偿还的债务吗？</>} hint={<>Home loans, car loans, credit cards — anything still owing. Skip if none.<br />房屋贷款、车贷、信用卡 — 任何仍未偿还的款项。若没有可跳过。</>} />
          {data.liabilities.map((l, i) => (
            <div key={i} style={{ border: `1px solid ${T.line}`, borderRadius: 12, padding: '20px 24px', marginBottom: 14, background: '#fff', position: 'relative' }}>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.gold, fontWeight: 600, marginBottom: 12, display: 'block' }}>Liability {i + 1} 债务 {i + 1}</span>
              {data.liabilities.length > 1 && <span onClick={() => update({ liabilities: data.liabilities.filter((_, xi) => xi !== i) })} style={{ position: 'absolute', top: 20, right: 22, fontSize: 13, color: T.ink3, cursor: 'pointer' }}>Remove 移除</span>}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>What is it? 这是什么？</label>
                <input style={inputStyle} placeholder="e.g. Home loan — DBS 例如：房屋贷款 — 星展银行" value={l.name} onChange={e => update({ liabilities: data.liabilities.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x) })} />
              </div>
              <div>
                <label style={labelStyle}>Outstanding amount 未偿还金额</label>
                <input style={inputStyle} placeholder="S$" value={l.value} onChange={e => update({ liabilities: data.liabilities.map((x, xi) => xi === i ? { ...x, value: e.target.value } : x) })} />
              </div>
            </div>
          ))}
          <AddLink label="Add another liability 添加另一项债务" onClick={() => update({ liabilities: [...data.liabilities, { name: '', value: '' }] })} />
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'residual' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={10} total={stepsWithProgress} section={section} title={<>Everything else you own<br />其余的所有资产</>} hint={<>Anything not specifically assigned above — and anything you acquire in future — gets split this way. Shares should add up to 100%.<br />未在上方明确分配的资产，以及您日后取得的任何资产，都将按此方式分配。各份额加总应为100%。</>} />
          <div style={{ maxWidth: 480 }}>
            {data.residual.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: `1px solid ${T.line}`, fontSize: 15 }}>
                <input style={{ flex: 1, border: `1px solid ${T.line}`, borderRadius: 6, padding: '8px 10px', fontSize: 15, marginRight: 10 }} placeholder="Beneficiary name 受益人姓名" value={r.name} onChange={e => update({ residual: data.residual.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x) })} />
                <input style={{ width: 60, textAlign: 'right', border: `1px solid ${T.line}`, borderRadius: 6, padding: '6px 8px', fontSize: 14.5, fontFamily: 'DM Mono, monospace' }} value={r.pct} onChange={e => update({ residual: data.residual.map((x, xi) => xi === i ? { ...x, pct: e.target.value } : x) })} />
                <span style={{ marginLeft: 6 }}>%</span>
              </div>
            ))}
            <div style={{ marginTop: 14 }}>
              <AddLink label="Add another share 添加另一份分配" onClick={() => update({ residual: [...data.residual, { name: '', pct: '' }] })} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12, fontWeight: 600, fontSize: 15.5, color: residualTotal === 100 ? T.emerald : T.rouge }}>
              <span>Total 总计</span><span>{residualTotal}%</span>
            </div>
            {residualTotal !== 100 && (
              <p style={{ fontSize: 13.5, color: T.rouge, lineHeight: 1.55, marginTop: 8 }}>Shares should add up to 100% — your advisor can help you fix this if you're not sure yet. 各份额加总应为100% — 若您还不确定，您的顾问可以协助您调整。</p>
            )}
          </div>
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'clauses' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={11} total={stepsWithProgress} section={section} title={<>A few standard choices<br />几项标准条款</>} hint={<>Your advisor can explain any of these further when you meet.<br />您的顾问会在会面时进一步为您解释这些内容。</>} />
          <div style={{ maxWidth: 520 }}>
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>Which of your assets does this cover? 此遗嘱涵盖哪些资产？</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <Pill label="Everything, worldwide 全球范围内的所有资产" selected={data.scope === 'Worldwide'} onClick={() => update({ scope: 'Worldwide' })} />
                <Pill label="Worldwide, except certain assets 全球范围，但排除特定资产" selected={data.scope === 'Excluding'} onClick={() => update({ scope: 'Excluding' })} />
                <Pill label="Singapore assets only 仅限新加坡境内资产" selected={data.scope === 'Singapore'} onClick={() => update({ scope: 'Singapore' })} />
              </div>
            </div>
            <div style={{ marginBottom: 22, maxWidth: 200 }}>
              <label style={labelStyle}>Survivorship period (days) 生存期限（天）</label>
              <input style={inputStyle} value={data.survivorshipDays} onChange={e => update({ survivorshipDays: e.target.value })} />
            </div>
            <p style={{ fontSize: 13.5, color: T.ink3, lineHeight: 1.6, marginTop: -14, marginBottom: 22, maxWidth: 480 }}>If a beneficiary passes away within this many days after you, they're treated as if they passed before you — so their share goes to your backup plan instead of into their own estate. 若受益人在您身故后的此期限内也身故，将被视为先于您身故 — 其份额将按您的后备安排分配，而非归入其自身遗产。</p>
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>If a beneficiary passes away before you, their share should 若受益人先于您身故，其份额应</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <Pill label="Be redistributed among the others 重新分配给其他受益人" selected={data.lapsedGift === 'redistribute'} onClick={() => update({ lapsedGift: 'redistribute' })} />
                <Pill label="Still pass to their own estate 仍归入其自身遗产" selected={data.lapsedGift === 'to_estate'} onClick={() => update({ lapsedGift: 'to_estate' })} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Assets left to a child under 21 should be managed by 留给21岁以下子女的资产应由谁管理</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <Pill label="The Executor 执行人" selected={data.minorManager === 'executor'} onClick={() => update({ minorManager: 'executor' })} />
                <Pill label="The Guardian 监护人" selected={data.minorManager === 'guardian'} onClick={() => update({ minorManager: 'guardian' })} />
              </div>
            </div>
          </div>
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'instructions' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={12} total={stepsWithProgress} section={section} title={<>Anything else?<br />还有其他补充吗？</>} hint={<>All optional.<br />以下均为选填。</>} />
          <div style={{ maxWidth: 560 }}>
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Other instructions for your Will 其他遗嘱指示</label>
              <textarea style={{ ...inputStyle, minHeight: 90 }} placeholder="Anything specific you'd like included 您想加入的其他具体事项" value={data.otherInstructions} onChange={e => update({ otherInstructions: e.target.value })} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Funeral wishes 葬礼安排</label>
              <textarea style={{ ...inputStyle, minHeight: 90 }} placeholder="Optional 选填" value={data.funeralWishes} onChange={e => update({ funeralWishes: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>A few final words 几句心里话</label>
              <textarea style={{ ...inputStyle, minHeight: 90 }} placeholder="Optional — a personal note, if you'd like to leave one 选填 — 若您想留下一段话" value={data.finalWords} onChange={e => update({ finalWords: e.target.value })} />
            </div>
          </div>
          <NavBar onBack={() => go(-1)} onNext={() => go(1)} />
        </div>
      )}

      {step === 'review' && (
        <div style={{ padding: '48px 0 0' }}>
          <Head step={13} total={stepsWithProgress} section={section} title={<>Review before you submit<br />提交前请审阅</>} hint={<>Take a moment to check everything looks right. You can go back and change anything.<br />请花点时间检查所有内容是否正确。您可以随时返回修改。</>} />
          <div style={{ maxWidth: 560 }}>
            <ReviewBlock title="Beneficiaries 受益人" lines={data.beneficiaries.map(b => `${b.relationship || '—'}: ${b.name || '(not named yet) 尚未填写姓名'}`)} />
            <ReviewBlock title="Executor 执行人" lines={data.executors.map(e => e.name || '(not named yet) 尚未填写姓名')} />
            <ReviewBlock title="Residual split 剩余资产分配" lines={data.residual.map(r => `${r.pct || 0}%: ${r.name || '(not named yet) 尚未填写姓名'}`)} />
            <div style={{ background: T.amberBg, borderLeft: `3px solid ${T.amber}`, borderRadius: '0 8px 8px 0', padding: '14px 18px', fontSize: 13.5, color: '#6B5730', lineHeight: 1.6, marginBottom: 20 }}>
              Submitting sends this to your advisor to review. It doesn't finalise your Will — they'll go through everything with you first. 提交后将发送给您的顾问审阅，这并不会最终确定您的遗嘱 — 顾问会先与您逐一核对所有内容。
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8, paddingBottom: 48 }}>
            <button onClick={() => go(-1)} style={{ padding: '13px 26px', borderRadius: 8, fontSize: 14.5, fontWeight: 600, border: `1px solid ${T.line}`, background: '#fff', color: T.ink3, cursor: 'pointer' }}>Back 返回</button>
            <button onClick={submit} style={{ padding: '13px 26px', borderRadius: 8, fontSize: 14.5, fontWeight: 600, border: `1px solid ${T.ink}`, background: T.ink, color: T.cream, cursor: 'pointer' }}>Submit 提交</button>
          </div>
        </div>
      )}
    </Shell>
  )
}

function ReviewBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h5 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17, fontWeight: 600, margin: '0 0 8px', color: T.gold }}>{title}</h5>
      {lines.map((l, i) => (
        <div key={i} style={{ fontSize: 14.5, color: T.ink, padding: '6px 0', borderBottom: `1px dashed ${T.line}` }}>{l}</div>
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
function Shell({ children, clientName, firm, saving, lastSavedAt, centerContent }: {
  children: React.ReactNode; clientName: string; firm?: string | null; saving?: boolean; lastSavedAt?: string | null; centerContent?: boolean
}) {
  const vw = useViewportWidth()
  const contentWidth = vw === 0 ? 520 : vw >= 1024 ? 720 : vw >= 640 ? 640 : 520

  return (
    <div style={{ minHeight: '100vh', background: '#FAF8F5', display: 'flex', flexDirection: 'column', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ background: '#fff', borderBottom: `1px solid ${T.line}` }}>
        <div style={{ maxWidth: contentWidth, margin: '0 auto', padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BrandMark size={28} />
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600 }}>{firm || 'Will Preparation'}</div>
          </div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11.5, color: T.ink3, textAlign: 'right', lineHeight: 1.5 }}>
            <div>WILL PREPARATION 遗嘱准备{clientName ? ` · ${clientName.toUpperCase()}` : ''}</div>
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
        <div style={{ maxWidth: contentWidth, margin: '0 auto', padding: '16px 24px', textAlign: 'center', fontSize: 12, color: T.ink3 }}>
          {firm || 'Your Advisor'} · Your information is kept private and confidential 您的信息将严格保密
        </div>
      </div>
    </div>
  )
}

function TermsModal({ firm, onClose }: { firm?: string | null; onClose: () => void }) {
  const firmName = firm || 'your Advisor\u2019s firm'
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,22,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 100 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, width: 640, maxWidth: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ padding: '20px 28px', borderBottom: `1px solid ${T.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 21, fontWeight: 600 }}>Terms and Conditions</div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 20, color: T.ink3, cursor: 'pointer', lineHeight: 1, padding: 4 }}
            aria-label="Close"
          >×</button>
        </div>
        <div style={{ padding: '20px 28px', overflowY: 'auto', fontSize: 13.5, color: T.ink3, lineHeight: 1.7 }}>
          <p style={{ margin: '0 0 14px' }}>Last updated: 30 August 2026</p>
          <p style={{ margin: '0 0 14px' }}>This Will Writing Preparation form (&quot;this Form&quot;) is provided to you by <strong>{firmName}</strong> (&quot;we&quot;, &quot;us&quot;, &quot;the Firm&quot;), through the adviser who sent you the link to this Form (&quot;your Advisor&quot;). This Form runs on software licensed from a third-party technology provider, which operates the Form on the Firm&apos;s behalf but has no direct relationship with you.</p>
          <p style={{ margin: '0 0 14px' }}><strong>Your Advisor and the Firm are your point of contact for everything relating to your estate planning.</strong> The technology provider does not advise you, does not draft your Will, and is not a party to the professional relationship between you and your Advisor.</p>

          <p style={{ fontWeight: 600, color: T.ink, margin: '20px 0 8px' }}>1. What this Form is — and what it is not</p>
          <p style={{ margin: '0 0 10px' }}>This Form is a <strong>data-gathering tool only</strong>. It allows you to record information about your intended beneficiaries, executors, guardians, assets, liabilities, and wishes, ahead of a Will-planning discussion with your Advisor.</p>
          <p style={{ margin: '0 0 10px' }}><strong>This Form is not a Will.</strong> Nothing you submit through this Form has any legal effect, and no Will is created, executed, or generated by this Form itself.</p>
          <p style={{ margin: '0 0 10px' }}><strong>Submitting this Form does not, by itself, result in a Will being drafted.</strong> Your Advisor, or a Certified Estate Planner or lawyer that your Advisor works with, will use the information you provide here to prepare for and inform a separate Will-drafting discussion with you. Depending on your Advisor&apos;s own qualifications, your Advisor may themselves be a Certified Estate Planner or otherwise licensed to assist with Will drafting — or your information may be passed to a Certified Estate Planner or lawyer for that purpose. Either way, the actual drafting of your Will takes place separately from this Form.</p>
          <p style={{ margin: '0 0 10px' }}>You should raise any questions about who will be preparing your Will, and under what capacity, directly with your Advisor.</p>

          <p style={{ fontWeight: 600, color: T.ink, margin: '20px 0 8px' }}>2. Two different roles — please understand the distinction</p>
          <p style={{ margin: '0 0 10px' }}><strong>{firmName} and your Advisor</strong> are responsible for the advice given to you, the accuracy and appropriateness of the estate-planning process, how your information is used in that process, and their own professional and regulatory obligations to you.</p>
          <p style={{ margin: '0 0 10px' }}><strong>The technology provider</strong> is responsible only for keeping the Form&apos;s software running and securing the data infrastructure it runs on — not for the content, advice, or professional service delivered to you, or the outcome of any Will eventually drafted.</p>
          <p style={{ margin: '0 0 10px' }}>For anything relating to your estate planning, your data, or your Will — <strong>contact your Advisor</strong>, not the technology provider.</p>

          <p style={{ fontWeight: 600, color: T.ink, margin: '20px 0 8px' }}>3. By using this Form, you accept these terms</p>
          <p style={{ margin: '0 0 10px' }}>Submitting information through this Form means you accept these terms in full. If you do not agree, do not use this Form — speak to your Advisor about alternative arrangements instead.</p>

          <p style={{ fontWeight: 600, color: T.ink, margin: '20px 0 8px' }}>4. Accuracy of information</p>
          <p style={{ margin: '0 0 10px' }}>You are solely responsible for the accuracy and completeness of the information you submit. Errors, omissions, or delays caused by inaccurate information may affect the drafting of your Will.</p>

          <p style={{ fontWeight: 600, color: T.ink, margin: '20px 0 8px' }}>5. How your information is used and who controls it</p>
          <p style={{ margin: '0 0 10px' }}>For the purposes of Singapore&apos;s Personal Data Protection Act 2012, <strong>{firmName} is the organisation responsible for the personal data you submit through this Form</strong>. The technology provider processes and stores this data only as an infrastructure provider acting on the Firm&apos;s instructions, and does not use your data for its own independent purposes.</p>
          <p style={{ margin: '0 0 10px' }}>Any request to access, correct, or withdraw consent for the processing of your personal data should be directed to your Advisor or the Firm.</p>

          <p style={{ fontWeight: 600, color: T.ink, margin: '20px 0 8px' }}>6. Confidentiality and data security</p>
          <p style={{ margin: '0 0 10px' }}>Your submission is transmitted and stored using industry-standard encryption and access controls. Access to your information is restricted to your Advisor and personnel authorised by the Firm. Keep any link, password, or access credential provided to you confidential.</p>

          <p style={{ fontWeight: 600, color: T.ink, margin: '20px 0 8px' }}>7. No warranty</p>
          <p style={{ margin: '0 0 10px' }}>This Form is provided on an &quot;as is&quot; and &quot;as available&quot; basis. It is not warranted to be uninterrupted, error-free, or fully exhaustive of every consideration relevant to your estate — it is a starting reference only.</p>

          <p style={{ fontWeight: 600, color: T.ink, margin: '20px 0 8px' }}>8. Limitation of liability</p>
          <p style={{ margin: '0 0 10px' }}>The technology provider&apos;s role is limited to operating the Form&apos;s software and is not liable for the advice given by your Advisor or the Firm, any inaccuracy in the information you provide, or any issue with the eventual drafting, validity, or enforceability of your Will. These matters are the sole responsibility of {firmName} and your Advisor.</p>

          <p style={{ fontWeight: 600, color: T.ink, margin: '20px 0 8px' }}>9. Your responsibilities</p>
          <p style={{ margin: '0 0 10px' }}>You agree not to provide false or misleading information, use the Form unlawfully, access another person&apos;s submission without authorisation, or attempt to copy or reverse-engineer the Form.</p>

          <p style={{ fontWeight: 600, color: T.ink, margin: '20px 0 8px' }}>10. Governing law</p>
          <p style={{ margin: '0 0 10px' }}>These terms are governed by the laws of Singapore, and any disputes are subject to the exclusive jurisdiction of the Singapore courts.</p>

          <p style={{ fontWeight: 600, color: T.ink, margin: '20px 0 8px' }}>11. Contact</p>
          <p style={{ margin: 0 }}>For questions about your estate planning, your Will, or how your information is being used — contact your Advisor, the person who sent you the link to this Form.</p>
        </div>
      </div>
    </div>
  )
}