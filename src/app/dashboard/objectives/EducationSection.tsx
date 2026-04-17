'use client'

import { useState } from 'react'

// ─── TYPES ───────────────────────────────────────────────────────────────────

export interface EducationChild {
  childId: string
  name: string
  age: number
  gender?: string
  // University settings
  uniType: string
  uniEntryAge: number
  courseDuration: number
  annualTuition: number
  annualLiving: number
  // Funding
  existingSavings: number
  lumpSumPct: number
  // Couple split
  coverPctClient: number
  coverPctSpouse: number
}

export interface EducationData {
  returnRate: number
  tuitionInflation: number
  livingInflation: number
  children: EducationChild[]
  advisorNotes: string
}

export interface EducationProps {
  data: EducationData
  onChange: (updated: EducationData) => void
  isCouple: boolean
  clientName?: string
  spouseName?: string
  clientAge?: number
  clientLiquid?: number
  spouseLiquid?: number
  familyMembers?: { id: string; name: string; relationship: string; gender?: string; age?: number; date_of_birth?: string }[]
  uniCostDefaults?: Record<string, { label: string; annual_tuition: number; annual_living: number; default_duration: number }>
}

// ─── DEFAULT UNI COSTS (fallback) ────────────────────────────────────────────

const DEFAULT_UNI_COSTS: Record<string, { label: string; annual_tuition: number; annual_living: number; default_duration: number }> = {
  sg_local:      { label: 'Singapore Local University',      annual_tuition: 9000,  annual_living: 12000, default_duration: 4 },
  sg_private:    { label: 'Singapore Private University',    annual_tuition: 18000, annual_living: 12000, default_duration: 3 },
  au_university: { label: 'Australia University',            annual_tuition: 35000, annual_living: 20000, default_duration: 3 },
  uk_university: { label: 'UK University',                   annual_tuition: 40000, annual_living: 18000, default_duration: 3 },
  us_university: { label: 'US University',                   annual_tuition: 55000, annual_living: 25000, default_duration: 4 },
  ca_university: { label: 'Canada University',               annual_tuition: 30000, annual_living: 18000, default_duration: 4 },
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fmtSGD(n: number) {
  if (!n || isNaN(n)) return 'SGD 0'
  return `SGD ${Math.round(n).toLocaleString('en-SG')}`
}
function fmt(n: number) {
  if (!n || isNaN(n)) return '$0'
  return '$' + Math.round(n).toLocaleString('en-SG')
}
function getAge(dob?: string): number {
  if (!dob) return 10
  const birth = new Date(dob)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--
  return Math.max(0, age)
}

// ─── CALC ENGINE ─────────────────────────────────────────────────────────────

function calcChildFund(child: EducationChild, tuitionInfl: number, livingInfl: number): number {
  const yearsToUni = Math.max(0, child.uniEntryAge - child.age)
  const fvTuition = child.annualTuition * Math.pow(1 + tuitionInfl / 100, yearsToUni) * child.courseDuration
  const fvLiving  = child.annualLiving  * Math.pow(1 + livingInfl  / 100, yearsToUni) * child.courseDuration
  return fvTuition + fvLiving
}

function calcFundingGap(totalFund: number, existingSavings: number, returnRate: number, yearsToUni: number): number {
  const existingFV = existingSavings * Math.pow(1 + returnRate / 100, yearsToUni)
  return Math.max(0, totalFund - existingFV)
}

function calcMonthlySavings(gap: number, returnRate: number, yearsToUni: number): number {
  if (gap <= 0 || yearsToUni <= 0) return 0
  const n = yearsToUni * 12
  const r = returnRate / 100 / 12
  if (r === 0) return gap / n
  return gap * r / (Math.pow(1 + r, n) - 1)
}

function calcLumpSum(gap: number, lumpPct: number, returnRate: number, yearsToUni: number): number {
  if (lumpPct <= 0 || yearsToUni <= 0) return 0
  const portion = gap * lumpPct / 100
  return portion / Math.pow(1 + returnRate / 100, yearsToUni)
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

function SubLabel({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, marginTop: 28 }}>
      <span style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600, color: color ?? 'var(--ink3)' }}>{children}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  )
}

function RateSlider({ label, value, onChange, min = 0, max = 15, step = 0.25, color = 'var(--gold)' }: {
  label: string; value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number; color?: string
}) {
  return (
    <div>
      <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: color, height: 2, cursor: 'pointer' }} />
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 500, color: 'var(--ink)', background: 'var(--cream)', borderRadius: 6, padding: '4px 10px', minWidth: 52, textAlign: 'center', border: '1px solid var(--line)' }}>
          {value.toFixed(2)}%
        </div>
      </div>
    </div>
  )
}

// ─── CHILD CARD ───────────────────────────────────────────────────────────────

function ChildCard({
  child, onUpdate, tuitionInfl, livingInfl, returnRate,
  isCouple, clientName, spouseName, uniCosts,
}: {
  child: EducationChild
  onUpdate: (c: Partial<EducationChild>) => void
  tuitionInfl: number; livingInfl: number; returnRate: number
  isCouple: boolean; clientName: string; spouseName: string
  uniCosts: typeof DEFAULT_UNI_COSTS
}) {
  const inp: React.CSSProperties = {
    background: 'white', border: '1px solid var(--line)', borderRadius: 8,
    padding: '9px 12px', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)',
    outline: 'none', width: '100%', boxSizing: 'border-box' as const,
  }

  const yearsToUni = Math.max(0, child.uniEntryAge - child.age)
  const totalFund = calcChildFund(child, tuitionInfl, livingInfl)
  const gap = calcFundingGap(totalFund, child.existingSavings, returnRate, yearsToUni)
  const existingFV = child.existingSavings * Math.pow(1 + returnRate / 100, yearsToUni)
  const lumpSumToday = calcLumpSum(gap, child.lumpSumPct, returnRate, yearsToUni)
  const monthlyForRemainder = calcMonthlySavings(gap * (1 - child.lumpSumPct / 100), returnRate, yearsToUni)
  const isFunded = gap <= 0

  const fvTuition = child.annualTuition * Math.pow(1 + tuitionInfl / 100, yearsToUni) * child.courseDuration
  const fvLiving  = child.annualLiving  * Math.pow(1 + livingInfl  / 100, yearsToUni) * child.courseDuration

  const genderColor = child.gender === 'Female' ? '#7A6AAA' : 'var(--gold)'

  return (
    <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden', marginBottom: 20 }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--cream)' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ width: 4, height: 24, background: genderColor, borderRadius: 2 }} />
          <div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 500, color: 'var(--ink)' }}>{child.name}</div>
            <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>
              Age {child.age} · {yearsToUni > 0 ? `${yearsToUni} yrs to university` : 'University age'}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 2 }}>Total Fund Needed</div>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color: isFunded ? 'var(--emerald)' : genderColor }}>{fmtSGD(totalFund)}</div>
        </div>
      </div>

      {/* FV breakdown strip */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', background: '#F5F0E8', borderBottom: '1px solid var(--line)' }}>
        {[
          { label: `Tuition FV (${tuitionInfl}%)`, value: fvTuition, note: `${child.courseDuration}yr × ${fmt(child.annualTuition * Math.pow(1 + tuitionInfl / 100, yearsToUni))}/yr` },
          { label: `Living FV (${livingInfl}%)`,   value: fvLiving,  note: `${child.courseDuration}yr × ${fmt(child.annualLiving  * Math.pow(1 + livingInfl  / 100, yearsToUni))}/yr` },
          { label: 'Existing Savings FV',           value: existingFV, note: `${fmtSGD(child.existingSavings)} × ${yearsToUni}y` },
          { label: 'Funding Gap',                   value: gap,       note: isFunded ? '✓ Fully funded' : 'Additional needed', hi: !isFunded },
        ].map((kpi, i) => (
          <div key={i} style={{ padding: '12px 14px', borderRight: i < 3 ? '1px solid var(--line)' : 'none', background: kpi.hi ? '#FEF3F2' : 'transparent' }}>
            <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 3 }}>{kpi.label}</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, fontWeight: 600, color: kpi.hi ? 'var(--rouge)' : i === 2 ? 'var(--emerald)' : 'var(--ink)', marginBottom: 2 }}>
              {fmtSGD(kpi.value)}
            </div>
            <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>{kpi.note}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* University type */}
        <div>
          <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>University Type</div>
          <select
            value={child.uniType}
            onChange={e => {
              const info = uniCosts[e.target.value]
              if (info) onUpdate({ uniType: e.target.value, annualTuition: info.annual_tuition, annualLiving: info.annual_living, courseDuration: info.default_duration })
              else onUpdate({ uniType: e.target.value })
            }}
            style={{ ...inp, cursor: 'pointer' }}
          >
            {Object.entries(uniCosts).map(([k, v]) => (
              <option key={k} value={k}>{v.label} — {fmt(v.annual_tuition + v.annual_living)}/yr</option>
            ))}
          </select>
        </div>

        {/* Entry age + Duration */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>University Entry Age</div>
            <input type="number" min={15} max={25} value={child.uniEntryAge} onChange={e => onUpdate({ uniEntryAge: parseInt(e.target.value) || 18 })} style={inp} />
            <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginTop: 4 }}>
              Default: {child.gender === 'Male' ? '21 (NS offset)' : '19'}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Course Duration (years)</div>
            <input type="number" min={1} max={6} value={child.courseDuration} onChange={e => onUpdate({ courseDuration: parseInt(e.target.value) || 4 })} style={inp} />
          </div>
        </div>

        {/* Annual tuition + living */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            { label: `Annual Tuition (today's $)`, key: 'annualTuition' as const, note: `Inflated at ${tuitionInfl}% p.a.`, val: child.annualTuition },
            { label: `Annual Living (today's $)`,  key: 'annualLiving'  as const, note: `Inflated at ${livingInfl}% p.a.`,  val: child.annualLiving  },
          ].map(field => (
            <div key={field.key}>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>{field.label}</div>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>SGD</span>
                <input type="number" min={0} value={field.val || ''} onChange={e => onUpdate({ [field.key]: parseFloat(e.target.value) || 0 })}
                  style={{ ...inp, paddingLeft: 48 }} />
              </div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginTop: 4 }}>{field.note}</div>
            </div>
          ))}
        </div>

        {/* Existing savings */}
        <div>
          <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Savings Already Set Aside</div>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>SGD</span>
            <input type="number" min={0} value={child.existingSavings || ''} onChange={e => onUpdate({ existingSavings: parseFloat(e.target.value) || 0 })}
              style={{ ...inp, paddingLeft: 48 }} placeholder="0" />
          </div>
          {child.existingSavings > 0 && (
            <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--emerald)', marginTop: 4 }}>
              ✓ Grows to {fmtSGD(existingFV)} at university start
            </div>
          )}
        </div>

        {/* Funding mix */}
        {gap > 0 && (
          <div style={{ background: 'var(--cream)', borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Funding Mix</div>
              <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>
                <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{child.lumpSumPct}% lump sum</span>
                {' · '}
                <span>{100 - child.lumpSumPct}% monthly</span>
              </div>
            </div>
            <input type="range" min={0} max={100} step={5} value={child.lumpSumPct}
              onChange={e => onUpdate({ lumpSumPct: parseInt(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--gold)', marginBottom: 12 }} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ background: 'var(--gold-l)', border: '1px solid #e8d9be', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gold-tag)', marginBottom: 6 }}>Lump Sum Today</div>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, color: 'var(--gold-tag)' }}>{fmtSGD(lumpSumToday)}</div>
                <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginTop: 3 }}>
                  Grows to {fmtSGD(gap * child.lumpSumPct / 100)} at uni
                </div>
              </div>
              <div style={{ background: 'var(--emerald-l)', border: '1px solid #d0e8da', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--emerald)', marginBottom: 6 }}>Monthly Savings</div>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, color: 'var(--emerald)' }}>{fmtSGD(monthlyForRemainder)}/mo</div>
                <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginTop: 3 }}>
                  For {yearsToUni} years at {returnRate}% p.a.
                </div>
              </div>
            </div>
          </div>
        )}

        {isFunded && (
          <div style={{ background: 'var(--emerald-l)', border: '1px solid #d0e8da', borderRadius: 8, padding: '12px 16px' }}>
            <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--emerald)', fontWeight: 500 }}>
              ✓ Fully funded — existing savings of {fmtSGD(child.existingSavings)} will grow to {fmtSGD(existingFV)}, exceeding the required {fmtSGD(totalFund)}.
            </span>
          </div>
        )}

      </div>
    </div>
  )
}

// ─── DEFAULTS ─────────────────────────────────────────────────────────────────

export const DEFAULT_EDUCATION_DATA: EducationData = {
  returnRate: 5,
  tuitionInflation: 5,
  livingInflation: 3,
  children: [],
  advisorNotes: '',
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

export default function EducationSection({
  data, onChange, isCouple,
  clientName = 'Client', spouseName = 'Spouse',
  clientAge = 35,
  clientLiquid = 0, spouseLiquid = 0,
  familyMembers = [],
  uniCostDefaults,
}: EducationProps) {
  const uniCosts = uniCostDefaults ?? DEFAULT_UNI_COSTS

  function upd(c: Partial<EducationData>) { onChange({ ...data, ...c }) }

  // Sync children from familyMembers on first render
  const kids = familyMembers.filter(f => ['Son', 'Daughter', 'Child'].includes(f.relationship))

  // Merge: keep existing EducationChild settings, fill in missing children
  function getChildData(kid: typeof kids[0]): EducationChild {
    const existing = data.children.find(c => c.childId === kid.id)
    const age = kid.age ?? getAge(kid.date_of_birth)
    const defaultEntry = kid.gender === 'Male' ? 21 : 19
    const uniInfo = uniCosts['sg_local']
    if (existing) return { ...existing, name: kid.name || kid.relationship, age }
    return {
      childId: kid.id,
      name: kid.name || kid.relationship,
      age,
      gender: kid.gender,
      uniType: 'sg_local',
      uniEntryAge: defaultEntry,
      courseDuration: uniInfo.default_duration,
      annualTuition: uniInfo.annual_tuition,
      annualLiving: uniInfo.annual_living,
      existingSavings: 0,
      lumpSumPct: 50,
      coverPctClient: isCouple ? 50 : 100,
      coverPctSpouse: 50,
    }
  }

  const childList = kids.map(getChildData)

  function updateChild(childId: string, changes: Partial<EducationChild>) {
    // Merge into data.children
    const existing = data.children.find(c => c.childId === childId)
    const base = childList.find(c => c.childId === childId)!
    const updated = { ...(existing ?? base), ...changes }
    const newArr = data.children.some(c => c.childId === childId)
      ? data.children.map(c => c.childId === childId ? updated : c)
      : [...data.children, updated]
    upd({ children: newArr })
  }

  // Totals
  const totalFundAll = childList.reduce((s, c) => s + calcChildFund(c, data.tuitionInflation, data.livingInflation), 0)
  const totalGapAll  = childList.reduce((s, c) => {
    const fund = calcChildFund(c, data.tuitionInflation, data.livingInflation)
    return s + calcFundingGap(fund, c.existingSavings, data.returnRate, Math.max(0, c.uniEntryAge - c.age))
  }, 0)
  const totalMonthly = childList.reduce((c, child) => {
    const fund = calcChildFund(child, data.tuitionInflation, data.livingInflation)
    const gap  = calcFundingGap(fund, child.existingSavings, data.returnRate, Math.max(0, child.uniEntryAge - child.age))
    return c + calcMonthlySavings(gap * (1 - child.lumpSumPct / 100), data.returnRate, Math.max(0, child.uniEntryAge - child.age))
  }, 0)

  return (
    <div>
      {/* Intro */}
      <div style={{ marginBottom: 32 }}>
        <p style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 8, fontWeight: 500 }}>Section 4 · Education Planning</p>
        <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 400, color: 'var(--ink)', marginBottom: 8 }}>Planning for Education</h2>
        <p style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)', lineHeight: 1.6 }}>
          Project the future cost of each child's education, account for existing savings, and determine the additional capital or monthly savings required.
        </p>
      </div>

      {/* ── ASSUMPTIONS ── */}
      <SubLabel color="var(--gold)">Global Assumptions</SubLabel>
      <div style={{ background: 'var(--gold-l)', border: '1px solid #e8d9be', borderRadius: 12, padding: '20px 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 28 }}>
          <RateSlider label="Investment Return Rate" value={data.returnRate} onChange={v => upd({ returnRate: v })} min={0} max={12} step={0.25} color="var(--gold)" />
          <RateSlider label="Tuition Inflation" value={data.tuitionInflation} onChange={v => upd({ tuitionInflation: v })} min={0} max={10} step={0.25} color="var(--rouge)" />
          <RateSlider label="Living Cost Inflation" value={data.livingInflation} onChange={v => upd({ livingInflation: v })} min={0} max={8} step={0.25} color="var(--emerald)" />
        </div>
        <p style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--gold-tag)', marginTop: 12 }}>
          Tuition typically inflates faster than general CPI. Singapore university fees have risen ~5% p.a. over the last decade.
        </p>
      </div>

      {/* ── CHILDREN ── */}
      {kids.length === 0 ? (
        <>
          <SubLabel>No Children Found</SubLabel>
          <div style={{ background: 'white', border: '2px dashed var(--line)', borderRadius: 14, padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>👨‍👩‍👧‍👦</div>
            <p style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)', marginBottom: 4 }}>No children detected in the client profile</p>
            <p style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>Add children (Son / Daughter) in the Client Profile to enable education planning</p>
          </div>
        </>
      ) : (
        <>
          <SubLabel color="var(--gold)">Education Projections</SubLabel>
          {childList.map(child => (
            <ChildCard
              key={child.childId}
              child={child}
              onUpdate={changes => updateChild(child.childId, changes)}
              tuitionInfl={data.tuitionInflation}
              livingInfl={data.livingInflation}
              returnRate={data.returnRate}
              isCouple={isCouple}
              clientName={clientName}
              spouseName={spouseName}
              uniCosts={uniCosts}
            />
          ))}

          {/* ── SUMMARY ── */}
          <SubLabel color="var(--ink)">Education Capital Summary</SubLabel>
          <div style={{ background: 'var(--ink)', borderRadius: 16, padding: '32px 36px', color: 'white', marginBottom: 24 }}>
            <p style={{ fontFamily: 'Inter', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 28 }}>
              {kids.length} {kids.length === 1 ? 'Child' : 'Children'} · {data.returnRate}% return · {data.tuitionInflation}% tuition inflation
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0, marginBottom: 32 }}>
              {[
                { label: 'Total Fund Required',  value: fmtSGD(totalFundAll),         sub: 'FV across all children' },
                { label: 'Total Funding Gap',    value: fmtSGD(totalGapAll),          sub: 'After existing savings', hi: totalGapAll > 0 },
                { label: 'Monthly Savings Needed', value: `${fmtSGD(totalMonthly)}/mo`, sub: 'Combined monthly investment' },
              ].map((kpi, i) => (
                <div key={i} style={{ paddingRight: i < 2 ? 32 : 0, borderRight: i < 2 ? '1px solid rgba(255,255,255,0.12)' : 'none', paddingLeft: i > 0 ? 32 : 0 }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: 10 }}>{kpi.label}</div>
                  <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 34, fontWeight: 600, color: kpi.hi ? '#f0a0a0' : i === 0 ? 'var(--gold)' : 'white', marginBottom: 6, lineHeight: 1 }}>{kpi.value}</div>
                  <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{kpi.sub}</div>
                </div>
              ))}
            </div>

            {/* Per-child breakdown */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 24 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 16 }}>Per Child Breakdown</div>
              {childList.map(child => {
                const fund = calcChildFund(child, data.tuitionInflation, data.livingInflation)
                const gap  = calcFundingGap(fund, child.existingSavings, data.returnRate, Math.max(0, child.uniEntryAge - child.age))
                const mo   = calcMonthlySavings(gap * (1 - child.lumpSumPct / 100), data.returnRate, Math.max(0, child.uniEntryAge - child.age))
                const ls   = calcLumpSum(gap, child.lumpSumPct, data.returnRate, Math.max(0, child.uniEntryAge - child.age))
                return (
                  <div key={child.childId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: 8 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{ fontSize: 16 }}>👤</span>
                      <div>
                        <div style={{ fontFamily: 'Inter', fontSize: 14, color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>{child.name}</div>
                        <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>Age {child.age} · {Math.max(0, child.uniEntryAge - child.age)}y to uni · {fmtSGD(fund)} total</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                      {child.lumpSumPct > 0  && ls > 0  && (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Lump Sum</div>
                          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: 'var(--gold)', fontWeight: 600 }}>{fmtSGD(ls)}</div>
                        </div>
                      )}
                      {child.lumpSumPct < 100 && mo > 0  && (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Monthly</div>
                          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: 'white', fontWeight: 600 }}>{fmtSGD(mo)}/mo</div>
                        </div>
                      )}
                      {gap <= 0 && <span style={{ fontFamily: 'Inter', fontSize: 13, color: '#6fcf97', fontWeight: 600 }}>✓ Fully Funded</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* ── ADVISOR NOTES ── */}
      <SubLabel>Advisor Notes</SubLabel>
      <textarea rows={3} value={data.advisorNotes} onChange={e => upd({ advisorNotes: e.target.value })}
        placeholder="Document school preferences, overseas study intentions, scholarship considerations…"
        style={{ width: '100%', background: 'white', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)', resize: 'vertical', lineHeight: 1.6, outline: 'none', boxSizing: 'border-box' }}
      />
    </div>
  )
}
