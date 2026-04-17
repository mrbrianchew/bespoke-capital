'use client'

import { useState } from 'react'

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type WillStatus    = 'has_will' | 'no_will' | 'outdated'
export type LPAStatus     = 'registered' | 'not_registered' | 'in_progress'
export type CPFNomStatus  = 'nominated' | 'not_nominated' | 'partial'
export type TrustStatus   = 'has_trust' | 'considering' | 'not_applicable'

export interface BequestItem {
  id: string
  label: string
  beneficiary: string
  assetType: string
  estimatedValue: number
  notes: string
}

export interface EstatePerson {
  willStatus: WillStatus
  willLastUpdated: string   // "MM/YYYY" or ""
  lpaStatus: LPAStatus
  cpfNomStatus: CPFNomStatus
  cpfNomBeneficiary: string
  trustStatus: TrustStatus
  trustNotes: string
}

export interface EstateData {
  client: EstatePerson
  spouse: EstatePerson
  bequests: BequestItem[]
  totalAssets: number        // pulled from FF
  totalLiabilities: number   // pulled from FF
  distributionNotes: string
  advisorNotes: string
}

export interface EstateProps {
  data: EstateData
  onChange: (updated: EstateData) => void
  isCouple: boolean
  clientName?: string
  spouseName?: string
  // Assets from fact finding
  clientLiquid?: number
  spouseLiquid?: number
  clientCPF?: number
  spouseCPF?: number
  propertyEquity?: number   // total net equity across all properties
  totalLiabilities?: number
  familyMembers?: { id: string; name: string; relationship: string }[]
}

// ─── DEFAULT STATE ────────────────────────────────────────────────────────────

const DEFAULT_PERSON: EstatePerson = {
  willStatus: 'no_will',
  willLastUpdated: '',
  lpaStatus: 'not_registered',
  cpfNomStatus: 'not_nominated',
  cpfNomBeneficiary: '',
  trustStatus: 'not_applicable',
  trustNotes: '',
}

export const DEFAULT_ESTATE_DATA: EstateData = {
  client: DEFAULT_PERSON,
  spouse: DEFAULT_PERSON,
  bequests: [],
  totalAssets: 0,
  totalLiabilities: 0,
  distributionNotes: '',
  advisorNotes: '',
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fmtSGD(n: number) {
  if (!n || isNaN(n)) return 'SGD 0'
  return `SGD ${Math.round(n).toLocaleString('en-SG')}`
}
function newId() { return 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5) }

const WILL_OPTS: { value: WillStatus; label: string; color: string; icon: string }[] = [
  { value: 'has_will',  label: 'Will in Place',  color: 'var(--emerald)', icon: '✓' },
  { value: 'outdated',  label: 'Outdated Will',  color: '#E8A838',        icon: '⚠' },
  { value: 'no_will',   label: 'No Will',        color: 'var(--rouge)',   icon: '✕' },
]
const LPA_OPTS: { value: LPAStatus; label: string; color: string }[] = [
  { value: 'registered',     label: 'Registered',   color: 'var(--emerald)' },
  { value: 'in_progress',    label: 'In Progress',  color: '#E8A838' },
  { value: 'not_registered', label: 'Not Done',     color: 'var(--rouge)' },
]
const CPF_NOM_OPTS: { value: CPFNomStatus; label: string; color: string }[] = [
  { value: 'nominated',     label: 'Nominated',     color: 'var(--emerald)' },
  { value: 'partial',       label: 'Partial',       color: '#E8A838' },
  { value: 'not_nominated', label: 'Not Done',      color: 'var(--rouge)' },
]
const TRUST_OPTS: { value: TrustStatus; label: string }[] = [
  { value: 'has_trust',       label: 'Trust Established' },
  { value: 'considering',     label: 'Considering' },
  { value: 'not_applicable',  label: 'Not Applicable' },
]

const ASSET_TYPES = ['Property', 'CPF', 'Cash / Investments', 'Insurance Payout', 'Business Interest', 'SRS', 'Other']

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

function SubLabel({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, marginTop: 28 }}>
      <span style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600, color: color ?? 'var(--ink3)' }}>{children}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  )
}

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color, background: color + '18', padding: '3px 8px', borderRadius: 4 }}>
      {label}
    </span>
  )
}

function PillSelect<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string; color?: string }[]; value: T; onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', background: 'white', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
      {options.map(opt => (
        <button key={opt.value} onClick={() => onChange(opt.value)}
          style={{ flex: 1, padding: '9px 6px', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', transition: 'all 0.15s',
            background: value === opt.value ? 'var(--ink)' : 'white',
            color: value === opt.value ? (opt.color ?? 'white') : 'var(--ink3)',
          }}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ─── PERSON ESTATE CARD ───────────────────────────────────────────────────────

function PersonEstateCard({ person, onChange, name, color, cpfBalance }: {
  person: EstatePerson; onChange: (c: Partial<EstatePerson>) => void
  name: string; color: string; cpfBalance: number
}) {
  const inp: React.CSSProperties = {
    background: 'white', border: '1px solid var(--line)', borderRadius: 8,
    padding: '9px 12px', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)',
    outline: 'none', width: '100%', boxSizing: 'border-box' as const,
  }

  const willOpt   = WILL_OPTS.find(o => o.value === person.willStatus)!
  const lpaOpt    = LPA_OPTS.find(o => o.value === person.lpaStatus)!
  const cpfOpt    = CPF_NOM_OPTS.find(o => o.value === person.cpfNomStatus)!

  // Urgency score: 0–3 issues flagged
  const issues = [
    person.willStatus !== 'has_will',
    person.lpaStatus === 'not_registered',
    person.cpfNomStatus === 'not_nominated' && cpfBalance > 0,
  ].filter(Boolean).length

  return (
    <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 4, height: 20, background: color, borderRadius: 2 }} />
          <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 500, color: 'var(--ink)' }}>{name}</span>
        </div>
        {issues === 0
          ? <StatusBadge label="All in order" color="var(--emerald)" />
          : <StatusBadge label={`${issues} action${issues > 1 ? 's' : ''} needed`} color="var(--rouge)" />
        }
      </div>

      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Will */}
        <div>
          <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Last Will &amp; Testament</div>
          <PillSelect<WillStatus> options={WILL_OPTS} value={person.willStatus} onChange={v => onChange({ willStatus: v })} />
          {person.willStatus === 'has_will' && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 5 }}>Last Updated (MM/YYYY)</div>
              <input type="text" placeholder="e.g. 03/2022" value={person.willLastUpdated}
                onChange={e => onChange({ willLastUpdated: e.target.value })} style={inp} />
            </div>
          )}
          {person.willStatus === 'no_will' && (
            <div style={{ marginTop: 8, padding: '10px 12px', background: '#FEF3F2', borderRadius: 6, borderLeft: '3px solid var(--rouge)' }}>
              <p style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--rouge)', margin: 0, lineHeight: 1.5 }}>
                Without a will, assets will be distributed under the Intestate Succession Act — which may not reflect the client's wishes. Refer to a qualified lawyer to draft a will.
              </p>
            </div>
          )}
          {person.willStatus === 'outdated' && (
            <div style={{ marginTop: 8, padding: '10px 12px', background: '#FDF8F0', borderRadius: 6, borderLeft: '3px solid #E8A838' }}>
              <p style={{ fontFamily: 'Inter', fontSize: 11, color: '#A0732A', margin: 0, lineHeight: 1.5 }}>
                Major life changes (marriage, children, divorce, property purchase) may make an existing will outdated. Recommend reviewing with a lawyer.
              </p>
            </div>
          )}
        </div>

        {/* LPA */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Lasting Power of Attorney (LPA)</div>
          </div>
          <PillSelect<LPAStatus> options={LPA_OPTS} value={person.lpaStatus} onChange={v => onChange({ lpaStatus: v })} />
          {person.lpaStatus === 'not_registered' && (
            <div style={{ marginTop: 8, padding: '10px 12px', background: '#FEF3F2', borderRadius: 6, borderLeft: '3px solid var(--rouge)' }}>
              <p style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--rouge)', margin: 0, lineHeight: 1.5 }}>
                Without an LPA, family members cannot legally manage affairs if mental capacity is lost. Registration via the Office of the Public Guardian costs SGD 75–100. Recommend prioritising.
              </p>
            </div>
          )}
        </div>

        {/* CPF Nomination */}
        <div>
          <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>
            CPF Nomination
            {cpfBalance > 0 && <span style={{ marginLeft: 8, fontFamily: 'DM Mono, monospace', fontSize: 10, color: 'var(--ink3)' }}>({fmtSGD(cpfBalance)} in CPF)</span>}
          </div>
          <PillSelect<CPFNomStatus> options={CPF_NOM_OPTS} value={person.cpfNomStatus} onChange={v => onChange({ cpfNomStatus: v })} />
          {(person.cpfNomStatus === 'nominated' || person.cpfNomStatus === 'partial') && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 5 }}>Nominated Beneficiary(ies)</div>
              <input type="text" placeholder="e.g. Spouse 50%, Son 25%, Daughter 25%" value={person.cpfNomBeneficiary}
                onChange={e => onChange({ cpfNomBeneficiary: e.target.value })} style={inp} />
            </div>
          )}
          {person.cpfNomStatus === 'not_nominated' && cpfBalance > 0 && (
            <div style={{ marginTop: 8, padding: '10px 12px', background: '#FEF3F2', borderRadius: 6, borderLeft: '3px solid var(--rouge)' }}>
              <p style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--rouge)', margin: 0, lineHeight: 1.5 }}>
                CPF monies do NOT flow through a will — a separate CPF nomination is required. Without one, funds are distributed by the Public Trustee, which can be slow and costly. Can be done online via my.cpf.gov.sg.
              </p>
            </div>
          )}
        </div>

        {/* Trust */}
        <div>
          <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Trust Arrangement</div>
          <PillSelect<TrustStatus> options={TRUST_OPTS} value={person.trustStatus} onChange={v => onChange({ trustStatus: v })} />
          {(person.trustStatus === 'has_trust' || person.trustStatus === 'considering') && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 5 }}>Notes on Trust</div>
              <textarea rows={2} value={person.trustNotes} onChange={e => onChange({ trustNotes: e.target.value })}
                placeholder="Type of trust, trustee, purpose, assets in trust…"
                style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

// ─── ESTATE SIZE CALCULATOR ───────────────────────────────────────────────────

function EstateSizePanel({ clientLiquid, spouseLiquid, clientCPF, spouseCPF, propertyEquity, totalLiabilities, isCouple, clientName, spouseName }: {
  clientLiquid: number; spouseLiquid: number
  clientCPF: number; spouseCPF: number
  propertyEquity: number; totalLiabilities: number
  isCouple: boolean; clientName: string; spouseName: string
}) {
  const clientTotal  = clientLiquid + clientCPF
  const spouseTotal  = isCouple ? spouseLiquid + spouseCPF : 0
  const combinedAssets = clientTotal + spouseTotal + propertyEquity
  const netEstate = Math.max(0, combinedAssets - totalLiabilities)

  const rows = [
    { label: `${clientName} — Liquid & Investments`, client: clientLiquid,  spouse: 0,                hi: false },
    { label: `${clientName} — CPF`,                  client: clientCPF,     spouse: 0,                hi: false },
    ...(isCouple ? [
      { label: `${spouseName} — Liquid & Investments`, client: 0, spouse: spouseLiquid, hi: false },
      { label: `${spouseName} — CPF`,                  client: 0, spouse: spouseCPF,    hi: false },
    ] : []),
    { label: 'Property (Net Equity)',               client: propertyEquity, spouse: 0,                hi: false },
  ]

  return (
    <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', background: 'var(--cream)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink)' }}>Estimated Estate Size</span>
        <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>Pulled from Financial Profile</span>
      </div>

      <div style={{ padding: '16px 20px' }}>
        {rows.map((row, i) => {
          const val = row.client + row.spouse
          if (val === 0) return null
          return (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)' }}>{row.label}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--ink)' }}>{fmtSGD(val)}</span>
            </div>
          )
        })}

        {/* Totals */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Total Gross Assets</span>
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>{fmtSGD(combinedAssets)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--rouge)' }}>Less: Total Liabilities</span>
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--rouge)' }}>({fmtSGD(totalLiabilities)})</span>
        </div>

        {/* Net estate highlight */}
        <div style={{ margin: '12px 0 0', padding: '14px 18px', background: 'var(--ink)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'Inter', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)' }}>Estimated Net Estate</span>
          <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 24, fontWeight: 600, color: '#F5F0E8' }}>{fmtSGD(netEstate)}</span>
        </div>

        <p style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)', marginTop: 10, lineHeight: 1.5 }}>
          Note: Singapore does not impose estate duty (abolished 2008). However, assets held overseas may be subject to foreign estate taxes. CPF monies pass separately via nomination and do not form part of the estate.
        </p>
      </div>
    </div>
  )
}

// ─── BEQUEST TABLE ────────────────────────────────────────────────────────────

function BequestSection({ bequests, onChange, isCouple, clientName, spouseName, familyMembers }: {
  bequests: BequestItem[]; onChange: (b: BequestItem[]) => void
  isCouple: boolean; clientName: string; spouseName: string
  familyMembers: { id: string; name: string; relationship: string }[]
}) {
  const inp: React.CSSProperties = {
    background: 'white', border: '1px solid var(--line)', borderRadius: 8,
    padding: '8px 10px', fontFamily: 'Inter', fontSize: 12, color: 'var(--ink)',
    outline: 'none', width: '100%', boxSizing: 'border-box' as const,
  }

  function add() {
    onChange([...bequests, { id: newId(), label: '', beneficiary: '', assetType: 'Property', estimatedValue: 0, notes: '' }])
  }
  function upd(id: string, c: Partial<BequestItem>) { onChange(bequests.map(b => b.id === id ? { ...b, ...c } : b)) }
  function rem(id: string) { onChange(bequests.filter(b => b.id !== id)) }

  const totalBequests = bequests.reduce((s, b) => s + b.estimatedValue, 0)

  const suggestedBeneficiaries = [
    clientName,
    ...(isCouple ? [spouseName] : []),
    ...familyMembers.filter(f => !['Spouse'].includes(f.relationship)).map(f => f.name || f.relationship),
    'Charity / Organisation',
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <p style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink3)', margin: 0 }}>
          Document specific assets or bequests the client intends to leave to named beneficiaries.
        </p>
        <button onClick={add} style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--gold)', background: 'transparent', border: '1px solid var(--gold)', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: 12 }}>
          + Add Bequest
        </button>
      </div>

      {bequests.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px', background: 'white', border: '2px dashed var(--line)', borderRadius: 10, color: 'var(--ink3)', fontFamily: 'Inter', fontSize: 12 }}>
          No bequests documented yet
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {bequests.map(b => (
              <div key={b.id} style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 12, padding: '16px 18px', borderLeft: '3px solid var(--gold)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <select value={b.assetType} onChange={e => upd(b.id, { assetType: e.target.value })}
                    style={{ border: 'none', background: 'transparent', fontFamily: 'Inter', fontSize: 11, fontWeight: 600, color: 'var(--gold)', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em', outline: 'none' }}>
                    {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button onClick={() => rem(b.id)} style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink3)', marginBottom: 4 }}>Description</div>
                    <input type="text" value={b.label} onChange={e => upd(b.id, { label: e.target.value })}
                      placeholder="e.g. Family home at Toa Payoh" style={inp} />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink3)', marginBottom: 4 }}>Estimated Value</div>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>$</span>
                      <input type="number" min={0} value={b.estimatedValue || ''}
                        onChange={e => upd(b.id, { estimatedValue: parseFloat(e.target.value) || 0 })}
                        style={{ ...inp, paddingLeft: 22 }} />
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink3)', marginBottom: 4 }}>Beneficiary</div>
                    <input list={`ben-${b.id}`} value={b.beneficiary} onChange={e => upd(b.id, { beneficiary: e.target.value })}
                      placeholder="Name or relationship" style={inp} />
                    <datalist id={`ben-${b.id}`}>
                      {suggestedBeneficiaries.map(s => <option key={s} value={s} />)}
                    </datalist>
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Inter', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink3)', marginBottom: 4 }}>Notes</div>
                    <input type="text" value={b.notes} onChange={e => upd(b.id, { notes: e.target.value })}
                      placeholder="Conditions, percentage, context…" style={inp} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Bequest total */}
          <div style={{ marginTop: 14, padding: '12px 18px', background: 'var(--ink)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'Inter', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)' }}>Total Documented Bequests</span>
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, color: '#F5F0E8', fontWeight: 600 }}>{fmtSGD(totalBequests)}</span>
          </div>
        </>
      )}
    </div>
  )
}

// ─── CHECKLIST OVERVIEW ───────────────────────────────────────────────────────

function EstateChecklist({ clientPerson, spousePerson, isCouple, clientName, spouseName }: {
  clientPerson: EstatePerson; spousePerson: EstatePerson
  isCouple: boolean; clientName: string; spouseName: string
}) {
  type CheckItem = { label: string; client: boolean; spouse: boolean; priority: 'high' | 'medium' }

  const checks: CheckItem[] = [
    { label: 'Will in place & up to date',      client: clientPerson.willStatus  === 'has_will',  spouse: spousePerson.willStatus  === 'has_will',  priority: 'high' },
    { label: 'LPA registered',                  client: clientPerson.lpaStatus   === 'registered', spouse: spousePerson.lpaStatus   === 'registered', priority: 'high' },
    { label: 'CPF nomination made',             client: clientPerson.cpfNomStatus !== 'not_nominated', spouse: spousePerson.cpfNomStatus !== 'not_nominated', priority: 'high' },
    { label: 'Trust considered / established',  client: clientPerson.trustStatus !== 'not_applicable', spouse: spousePerson.trustStatus !== 'not_applicable', priority: 'medium' },
  ]

  const clientScore  = checks.filter(c => c.client).length
  const spouseScore  = isCouple ? checks.filter(c => c.spouse).length : null

  function ScoreBadge({ score, total }: { score: number; total: number }) {
    const color = score === total ? 'var(--emerald)' : score >= total / 2 ? '#E8A838' : 'var(--rouge)'
    return (
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700, color, background: color + '18', padding: '3px 10px', borderRadius: 6 }}>
        {score}/{total}
      </span>
    )
  }

  return (
    <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', background: 'var(--cream)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink)' }}>Estate Readiness Checklist</span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>{clientName}</span>
          <ScoreBadge score={clientScore} total={checks.length} />
          {isCouple && spouseScore !== null && (
            <>
              <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>{spouseName}</span>
              <ScoreBadge score={spouseScore} total={checks.length} />
            </>
          )}
        </div>
      </div>

      <div>
        {checks.map((check, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 80px 80px' : '1fr 80px', padding: '12px 20px', borderBottom: i < checks.length - 1 ? '1px solid var(--line)' : 'none', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {check.priority === 'high'
                ? <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--rouge)', flexShrink: 0 }} />
                : <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#E8A838', flexShrink: 0 }} />
              }
              <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--ink)' }}>{check.label}</span>
              {check.priority === 'high' && <span style={{ fontFamily: 'Inter', fontSize: 9, color: 'var(--rouge)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Priority</span>}
            </div>
            <div style={{ textAlign: 'center' }}>
              {check.client
                ? <span style={{ color: 'var(--emerald)', fontSize: 16 }}>✓</span>
                : <span style={{ color: 'var(--rouge)', fontSize: 14 }}>✕</span>
              }
            </div>
            {isCouple && (
              <div style={{ textAlign: 'center' }}>
                {check.spouse
                  ? <span style={{ color: 'var(--emerald)', fontSize: 16 }}>✓</span>
                  : <span style={{ color: 'var(--rouge)', fontSize: 14 }}>✕</span>
                }
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

export default function EstateSection({
  data, onChange, isCouple,
  clientName = 'Client', spouseName = 'Spouse',
  clientLiquid = 0, spouseLiquid = 0,
  clientCPF = 0, spouseCPF = 0,
  propertyEquity = 0, totalLiabilities = 0,
  familyMembers = [],
}: EstateProps) {

  function upd(c: Partial<EstateData>) { onChange({ ...data, ...c }) }
  function updClient(c: Partial<EstatePerson>) { upd({ client: { ...data.client, ...c } }) }
  function updSpouse(c: Partial<EstatePerson>) { upd({ spouse: { ...data.spouse, ...c } }) }

  return (
    <div>
      {/* Intro */}
      <div style={{ marginBottom: 32 }}>
        <p style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 8, fontWeight: 500 }}>Section 5 · Estate Planning</p>
        <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 400, color: 'var(--ink)', marginBottom: 8 }}>Preserving &amp; Passing On Wealth</h2>
        <p style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)', lineHeight: 1.6 }}>
          Ensure your client's estate is structured to pass on wealth efficiently, with the right legal documents in place to reflect their wishes.
        </p>
      </div>

      {/* ── ESTATE SIZE ── */}
      <SubLabel color="var(--gold)">Estate Overview</SubLabel>
      <EstateSizePanel
        clientLiquid={clientLiquid} spouseLiquid={spouseLiquid}
        clientCPF={clientCPF} spouseCPF={spouseCPF}
        propertyEquity={propertyEquity} totalLiabilities={totalLiabilities}
        isCouple={isCouple} clientName={clientName} spouseName={spouseName}
      />

      {/* ── CHECKLIST ── */}
      <SubLabel color="var(--ink)">Estate Readiness</SubLabel>
      <EstateChecklist
        clientPerson={data.client} spousePerson={data.spouse}
        isCouple={isCouple} clientName={clientName} spouseName={spouseName}
      />

      {/* ── PERSON CARDS ── */}
      <SubLabel color="var(--gold)">Legal Documents &amp; Nominations</SubLabel>
      <div style={{ display: 'grid', gridTemplateColumns: isCouple ? '1fr 1fr' : '1fr', gap: 16 }}>
        <PersonEstateCard
          person={data.client} onChange={updClient}
          name={clientName} color="var(--gold)"
          cpfBalance={clientCPF}
        />
        {isCouple && (
          <PersonEstateCard
            person={data.spouse} onChange={updSpouse}
            name={spouseName} color="#6B5B8B"
            cpfBalance={spouseCPF}
          />
        )}
      </div>

      {/* ── BEQUESTS ── */}
      <SubLabel color="var(--gold)">Legacy &amp; Bequests</SubLabel>
      <BequestSection
        bequests={data.bequests} onChange={bequests => upd({ bequests })}
        isCouple={isCouple} clientName={clientName} spouseName={spouseName}
        familyMembers={familyMembers}
      />

      {/* ── DISTRIBUTION NOTES ── */}
      <SubLabel>Distribution Intent</SubLabel>
      <textarea rows={4} value={data.distributionNotes} onChange={e => upd({ distributionNotes: e.target.value })}
        placeholder="Describe the client's overall wishes for asset distribution — who gets what, any conditions, charitable intentions, family considerations…"
        style={{ width: '100%', background: 'white', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)', resize: 'vertical', lineHeight: 1.6, outline: 'none', boxSizing: 'border-box' }}
      />

      {/* ── ADVISOR NOTES ── */}
      <SubLabel>Advisor Notes</SubLabel>
      <textarea rows={3} value={data.advisorNotes} onChange={e => upd({ advisorNotes: e.target.value })}
        placeholder="Document referrals made (lawyer, notary), follow-up actions, or client concerns…"
        style={{ width: '100%', background: 'white', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)', resize: 'vertical', lineHeight: 1.6, outline: 'none', boxSizing: 'border-box' }}
      />
    </div>
  )
}
