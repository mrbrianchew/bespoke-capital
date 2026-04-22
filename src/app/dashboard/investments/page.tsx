'use client'
import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Chart, registerables } from 'chart.js'
Chart.register(...registerables)

// ─── TYPES ───────────────────────────────────────────────────────────────────

type PlanMode = 'couple' | 'individual'
type ActivePerson = 'client' | 'spouse' | 'combined'

interface CapitalGoal {
  id: string
  source: 'retirement' | 'wealth' | 'education' | 'custom'
  label: string
  targetCorpus: number
  monthlyRequired: number
  targetAge: number
  icon: string
  owner: 'client' | 'spouse' | 'joint'
}

interface PortfolioItem {
  id: string
  name: string
  type: string
  mode: 'Regular' | 'Lump Sum' | 'Mixed'
  monthlyContribution: number
  currentValue: number
  expectedReturn: number
  startYear: number
  owner: 'client' | 'spouse' | 'joint'
}

interface CMSettings {
  expectedReturn: number
  inflation: number
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  if (!n || isNaN(n)) return 'S$0'
  if (n >= 1_000_000) return 'S$' + (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return 'S$' + Math.round(n).toLocaleString('en-SG')
  return 'S$' + Math.round(n)
}

function fmtMo(n: number) {
  return 'S$' + Math.round(n).toLocaleString('en-SG') + '/mo'
}

function newId() {
  return 'cm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5)
}

function calcMonthlyRequired(corpus: number, yearsLeft: number, annualReturn: number): number {
  if (corpus <= 0 || yearsLeft <= 0) return 0
  const r = annualReturn / 100
  const rm = r / 12
  const nm = yearsLeft * 12
  return rm > 0 ? corpus * rm / (Math.pow(1 + rm, nm) - 1) : corpus / nm
}

// ─── PORTFOLIO MODAL ─────────────────────────────────────────────────────────

function PortfolioModal({ item, onSave, onClose, isCouple, clientName, spouseName }: {
  item?: PortfolioItem; onSave: (p: PortfolioItem) => void; onClose: () => void
  isCouple: boolean; clientName: string; spouseName: string
}) {
  const [name, setName] = useState(item?.name ?? '')
  const [type, setType] = useState(item?.type ?? 'Unit Trust')
  const [mode, setMode] = useState<'Regular' | 'Lump Sum' | 'Mixed'>(item?.mode ?? 'Regular')
  const [monthly, setMonthly] = useState(String(item?.monthlyContribution ?? ''))
  const [curVal, setCurVal] = useState(String(item?.currentValue ?? ''))
  const [ret, setRet] = useState(item?.expectedReturn ?? 6)
  const [startYear, setStartYear] = useState(item?.startYear ?? new Date().getFullYear())
  const [owner, setOwner] = useState<'client' | 'spouse' | 'joint'>(item?.owner ?? 'client')

  const inp: React.CSSProperties = { width: '100%', background: 'white', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }

  function save() {
    if (!name.trim()) return
    onSave({ id: item?.id ?? newId(), name: name.trim(), type, mode, monthlyContribution: parseFloat(monthly) || 0, currentValue: parseFloat(curVal) || 0, expectedReturn: ret, startYear, owner })
  }

  const ownerOpts = [
    { value: 'client' as const, label: clientName },
    ...(isCouple ? [{ value: 'spouse' as const, label: spouseName }, { value: 'joint' as const, label: 'Joint' }] : []),
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,22,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--cream)', borderRadius: 16, width: 520, boxShadow: '0 24px 64px rgba(0,0,0,0.22)', overflow: 'hidden' }}>
        <div style={{ padding: '24px 28px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 400, color: 'var(--ink)' }}>{item ? 'Edit Investment' : 'Add Investment'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 20 }}>✕</button>
        </div>
        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Investment Name</div>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Endowment Plan, Global Equity Fund" />
          </div>
          {isCouple && (
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Belongs To</div>
              <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                {ownerOpts.map(o => (
                  <button key={o.value} onClick={() => setOwner(o.value)} style={{ flex: 1, padding: '10px 4px', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 500, background: owner === o.value ? 'var(--ink)' : 'white', color: owner === o.value ? 'white' : 'var(--ink3)', transition: 'all 0.15s' }}>{o.label}</button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Type</div>
              <select value={type} onChange={e => setType(e.target.value)} style={inp}>
                {['Unit Trust', 'ILP', 'Endowment', '101 Policy', 'Annuity', 'Shares / ETF', 'Bond', 'CPF', 'Cash / FD', 'Other'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Mode</div>
              <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                {(['Regular', 'Lump Sum', 'Mixed'] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: '10px 4px', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 500, background: mode === m ? 'var(--ink)' : 'white', color: mode === m ? 'white' : 'var(--ink3)', transition: 'all 0.15s' }}>{m}</button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Current Value (S$)</div>
              <input type="number" style={inp} value={curVal} onChange={e => setCurVal(e.target.value)} placeholder="0" />
            </div>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Monthly Contribution (S$)</div>
              <input type="number" style={inp} value={monthly} onChange={e => setMonthly(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Expected Return %</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="range" min={0} max={15} step={0.5} value={ret} onChange={e => setRet(parseFloat(e.target.value))} style={{ flex: 1, accentColor: 'var(--gold)' }} />
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, minWidth: 44, textAlign: 'center', background: 'white', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px' }}>{ret}%</span>
              </div>
            </div>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Start Year</div>
              <input type="number" style={inp} value={startYear} onChange={e => setStartYear(parseInt(e.target.value) || new Date().getFullYear())} />
            </div>
          </div>
        </div>
        <div style={{ padding: '16px 28px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', fontFamily: 'Inter', fontSize: 12, border: '1px solid var(--line)', borderRadius: 8, background: 'white', color: 'var(--ink2)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} style={{ padding: '10px 24px', fontFamily: 'Inter', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: 'var(--ink)', color: 'white', cursor: 'pointer' }}>{item ? 'Update' : 'Add Investment'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── CUSTOM GOAL MODAL ────────────────────────────────────────────────────────

function CustomGoalModal({ onSave, onClose, clientAge, isCouple, clientName, spouseName }: {
  onSave: (g: CapitalGoal) => void; onClose: () => void; clientAge: number
  isCouple: boolean; clientName: string; spouseName: string
}) {
  const [label, setLabel] = useState('')
  const [corpus, setCorpus] = useState('')
  const [monthly, setMonthly] = useState('')
  const [targetAge, setTargetAge] = useState(clientAge + 10)
  const [owner, setOwner] = useState<'client' | 'spouse' | 'joint'>('client')

  const inp: React.CSSProperties = { width: '100%', background: 'white', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', fontFamily: 'Inter', fontSize: 13, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }

  const ownerOpts = [
    { value: 'client' as const, label: clientName },
    ...(isCouple ? [{ value: 'spouse' as const, label: spouseName }, { value: 'joint' as const, label: 'Joint' }] : []),
  ]

  function save() {
    if (!label.trim()) return
    onSave({ id: newId(), source: 'custom', label: label.trim(), icon: '✦', targetCorpus: parseFloat(corpus) || 0, monthlyRequired: parseFloat(monthly) || 0, targetAge, owner })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,22,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--cream)', borderRadius: 16, width: 440, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}>
        <div style={{ padding: '24px 28px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 400 }}>Add Capital Goal</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 20 }}>✕</button>
        </div>
        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Goal Label</div>
            <input style={inp} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Second property, Business fund" />
          </div>
          {isCouple && (
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>For</div>
              <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                {ownerOpts.map(o => (
                  <button key={o.value} onClick={() => setOwner(o.value)} style={{ flex: 1, padding: '10px 4px', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 500, background: owner === o.value ? 'var(--ink)' : 'white', color: owner === o.value ? 'white' : 'var(--ink3)', transition: 'all 0.15s' }}>{o.label}</button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Target Corpus (S$)</div>
              <input type="number" style={inp} value={corpus} onChange={e => setCorpus(e.target.value)} placeholder="0" />
            </div>
            <div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Monthly Required (S$)</div>
              <input type="number" style={inp} value={monthly} onChange={e => setMonthly(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div>
            <div style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 6 }}>Target Age</div>
            <input type="number" style={inp} value={targetAge} onChange={e => setTargetAge(parseInt(e.target.value) || clientAge + 10)} />
          </div>
        </div>
        <div style={{ padding: '16px 28px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', fontFamily: 'Inter', fontSize: 12, border: '1px solid var(--line)', borderRadius: 8, background: 'white', color: 'var(--ink2)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} style={{ padding: '10px 24px', fontFamily: 'Inter', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: 'var(--ink)', color: 'white', cursor: 'pointer' }}>Add Goal</button>
        </div>
      </div>
    </div>
  )
}

// ─── BADGES ──────────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: CapitalGoal['source'] }) {
  const map = { retirement: { label: 'Retirement', color: '#6B5B8B', bg: '#F0EBF8' }, wealth: { label: 'Wealth', color: '#4A7C9E', bg: '#EBF2F8' }, education: { label: 'Education', color: '#5E8A6A', bg: '#EBF5EE' }, custom: { label: 'Custom', color: '#A8834A', bg: '#F5EFE5' } }
  const { label, color, bg } = map[source]
  return <span style={{ fontFamily: 'Inter', fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color, background: bg, padding: '2px 8px', borderRadius: 4 }}>{label}</span>
}

function OwnerBadge({ owner, clientName, spouseName }: { owner: 'client' | 'spouse' | 'joint'; clientName: string; spouseName: string }) {
  const map = { client: { color: '#4A7C9E', bg: '#EBF2F8' }, spouse: { color: '#6B5B8B', bg: '#F0EBF8' }, joint: { color: '#A8834A', bg: '#F5EFE5' } }
  const { color, bg } = map[owner]
  const label = owner === 'client' ? clientName : owner === 'spouse' ? spouseName : 'Joint'
  return <span style={{ fontFamily: 'Inter', fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color, background: bg, padding: '2px 8px', borderRadius: 4 }}>{label}</span>
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function CapitalMandatePage() {
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [client, setClient] = useState<any>(null)
  const clientRef = useRef<any>(null)
  const [clientAge, setClientAge] = useState(40)
  const [spouseAge, setSpouseAge] = useState(38)
  const [clientName, setClientName] = useState('Client')
  const [spouseName, setSpouseName] = useState('Spouse')

  const [planMode, setPlanMode] = useState<PlanMode>('individual')
  const [activePerson, setActivePerson] = useState<ActivePerson>('client')

  const [goals, setGoals] = useState<CapitalGoal[]>([])
  const [customGoalModal, setCustomGoalModal] = useState(false)
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([])
  const [portfolioModal, setPortfolioModal] = useState<{ open: boolean; item?: PortfolioItem }>({ open: false })
  const [settings, setSettings] = useState<CMSettings>({ expectedReturn: 6, inflation: 3 })

  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartInstance = useRef<any>(null)

  // ── LOAD ──────────────────────────────────────────────────────────────────
  useEffect(() => { load() }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }
    const { data: clients } = await supabase.from('clients').select('*').order('created_at', { ascending: false })
    if (!clients?.length) { setLoading(false); return }
    const c = clients.find((x: any) => x.id === localStorage.getItem('selectedClientId')) || clients[0]
    setClient(c)
    clientRef.current = c

    const { data: rows } = await supabase.from('fact_finding').select('section, data').eq('client_id', c.id)
    const by: Record<string, any> = {}
    if (rows) rows.forEach((r: any) => { by[r.section] = r.data })

    const fin = by['financials'] || by['factfinding'] || {}
    const age = fin?.client?.age || c.age || 40
    const sage = fin?.spouse?.age || 38
    const cName = fin?.client?.firstName ? `${fin.client.firstName} ${fin.client.lastName || ''}`.trim() : c.name || 'Client'
    const sName = fin?.spouse?.firstName ? `${fin.spouse.firstName} ${fin.spouse.lastName || ''}`.trim() : 'Spouse'
    setClientAge(age); setSpouseAge(sage); setClientName(cName); setSpouseName(sName)

    const protData = by['protection_needs']?.protection
    const mode: PlanMode = protData?.planType === 'couple' ? 'couple' : 'individual'
    setPlanMode(mode)
    setActivePerson(mode === 'couple' ? 'combined' : 'client')

    const cmData = by['capital_mandate'] || {}
    const savedSettings: CMSettings = cmData?.settings ?? { expectedReturn: 6, inflation: 3 }
    setSettings(savedSettings)

    const builtGoals: CapitalGoal[] = []

    // Retirement — client
    const ret = by['retirement']?.ret || by['retirement'] || {}
    const retClient = ret?.client || ret
    if (retClient?.retirementCorpus && retClient.retirementCorpus > 0) {
      const retAge = retClient?.retirementAge || 65
      builtGoals.push({ id: 'ret_client', source: 'retirement', label: `${cName}'s Retirement Fund`, icon: '🏖', targetCorpus: retClient.retirementCorpus, monthlyRequired: calcMonthlyRequired(retClient.retirementCorpus, Math.max(1, retAge - age), savedSettings.expectedReturn), targetAge: retAge, owner: 'client' })
    }
    // Retirement — spouse
    const retSpouse = ret?.spouse
    if (mode === 'couple' && retSpouse?.retirementCorpus && retSpouse.retirementCorpus > 0) {
      const retAge = retSpouse?.retirementAge || 65
      builtGoals.push({ id: 'ret_spouse', source: 'retirement', label: `${sName}'s Retirement Fund`, icon: '🏖', targetCorpus: retSpouse.retirementCorpus, monthlyRequired: calcMonthlyRequired(retSpouse.retirementCorpus, Math.max(1, retAge - sage), savedSettings.expectedReturn), targetAge: retAge, owner: 'spouse' })
    }

    // Wealth accumulation goals
    const acc = by['accumulation']?.acc || by['accumulation'] || {}
    const accGoals: any[] = acc?.goals || []
    accGoals.forEach((g: any) => {
      if (!g.targetAmount) return
      const yearsLeft = Math.max(1, g.yearsToGoal || 10)
      const corpus = g.amountType === 'pv' ? g.targetAmount * Math.pow(1 + savedSettings.inflation / 100, yearsLeft) : g.targetAmount
      const owner: 'client' | 'spouse' | 'joint' = g.owner === 'spouse' ? 'spouse' : g.owner === 'joint' ? 'joint' : 'client'
      builtGoals.push({ id: 'acc_' + g.id, source: 'wealth', label: g.label || 'Wealth Goal', icon: '🏠', targetCorpus: corpus, monthlyRequired: g.monthlyRequired ?? calcMonthlyRequired(corpus, yearsLeft, savedSettings.expectedReturn), targetAge: age + yearsLeft, owner })
    })

    // Education goals
    const edu = by['education']?.edu || by['education'] || {}
    const eduChildren: any[] = edu?.children || []
    eduChildren.forEach((child: any) => {
      const corpus = child.totalFundNeeded || child.targetAmount || 0
      if (!corpus) return
      const targetAge = child.parentAgeAtEntry || (age + (child.yearsToUni || 18))
      builtGoals.push({ id: 'edu_' + (child.id || child.name), source: 'education', label: `${child.name || 'Child'}'s Education`, icon: '🎓', targetCorpus: corpus, monthlyRequired: calcMonthlyRequired(corpus, Math.max(1, targetAge - age), savedSettings.expectedReturn), targetAge, owner: 'joint' })
    })

    // Custom goals
    const customGoals: CapitalGoal[] = cmData?.customGoals || []
    customGoals.forEach(g => builtGoals.push({ ...g, source: 'custom' }))
    setGoals(builtGoals)

    const savedPortfolio: PortfolioItem[] = (cmData?.portfolio || []).map((p: any) => ({ ...p, owner: p.owner ?? 'client' }))
    setPortfolio(savedPortfolio)
    setLoading(false)
  }

  // ── SAVE ──────────────────────────────────────────────────────────────────
  async function save(updPortfolio: PortfolioItem[], updSettings: CMSettings, updCustomGoals: CapitalGoal[]) {
    const c = clientRef.current
    if (!c) return
    const dataToSave = { portfolio: updPortfolio, settings: updSettings, customGoals: updCustomGoals }
    const { data: rows } = await supabase.from('fact_finding').select('id').eq('client_id', c.id).eq('section', 'capital_mandate').order('created_at', { ascending: false }).limit(1)
    if (rows && rows.length > 0) {
      await supabase.from('fact_finding').update({ data: dataToSave, updated_at: new Date().toISOString() }).eq('id', rows[0].id)
    } else {
      await supabase.from('fact_finding').insert({ client_id: c.id, section: 'capital_mandate', data: dataToSave })
    }
  }

  async function savePortfolioItem(item: PortfolioItem) {
    const updated = portfolio.find(p => p.id === item.id) ? portfolio.map(p => p.id === item.id ? item : p) : [...portfolio, item]
    setPortfolio(updated)
    await save(updated, settings, goals.filter(g => g.source === 'custom'))
    setPortfolioModal({ open: false })
  }

  async function deletePortfolioItem(id: string) {
    if (!confirm('Remove this investment?')) return
    const updated = portfolio.filter(p => p.id !== id)
    setPortfolio(updated)
    await save(updated, settings, goals.filter(g => g.source === 'custom'))
  }

  async function addCustomGoal(g: CapitalGoal) {
    const updGoals = [...goals, g]
    setGoals(updGoals)
    await save(portfolio, settings, updGoals.filter(x => x.source === 'custom'))
    setCustomGoalModal(false)
  }

  async function removeGoal(id: string) {
    const updGoals = goals.filter(g => g.id !== id)
    setGoals(updGoals)
    await save(portfolio, settings, updGoals.filter(g => g.source === 'custom'))
  }

  const settingsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function updateSettings(s: CMSettings) {
    setSettings(s)
    if (settingsSaveTimer.current) clearTimeout(settingsSaveTimer.current)
    settingsSaveTimer.current = setTimeout(() => {
      save(portfolio, s, goals.filter(g => g.source === 'custom'))
    }, 800)
  }

  // ── FILTERING ─────────────────────────────────────────────────────────────
  function matchesPerson(owner: 'client' | 'spouse' | 'joint'): boolean {
    if (planMode === 'individual') return true
    if (activePerson === 'combined') return true
    if (activePerson === 'client') return owner === 'client' || owner === 'joint'
    if (activePerson === 'spouse') return owner === 'spouse' || owner === 'joint'
    return true
  }

  const filteredGoals = useMemo(() => goals.filter(g => matchesPerson(g.owner)), [goals, planMode, activePerson])
  const filteredPortfolio = useMemo(() => portfolio.filter(p => matchesPerson(p.owner)), [portfolio, planMode, activePerson])

  const totalMonthlyNeeded = useMemo(() => filteredGoals.reduce((s, g) => s + g.monthlyRequired, 0), [filteredGoals])
  const totalCorpus = useMemo(() => filteredGoals.reduce((s, g) => s + g.targetCorpus, 0), [filteredGoals])
  const totalMonthlyInvesting = useMemo(() => filteredPortfolio.reduce((s, p) => s + p.monthlyContribution, 0), [filteredPortfolio])
  const totalCurrentValue = useMemo(() => filteredPortfolio.reduce((s, p) => s + p.currentValue, 0), [filteredPortfolio])
  const monthlyGap = totalMonthlyNeeded - totalMonthlyInvesting

  const personLabel = planMode === 'individual' ? clientName
    : activePerson === 'combined' ? `${clientName} & ${spouseName}`
    : activePerson === 'client' ? clientName : spouseName

  // ── CHART ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (loading || !chartRef.current) return
    if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null }

    const maxAge = Math.max(85, clientAge + 30, ...filteredGoals.map(g => g.targetAge + 5))
    const ages = Array.from({ length: maxAge - clientAge + 1 }, (_, i) => clientAge + i)

    const targetLine = ages.map(a => filteredGoals.reduce((sum, g) => {
      const yearsLeft = g.targetAge - a
      if (yearsLeft < 0) return sum
      return sum + g.targetCorpus / Math.pow(1 + settings.expectedReturn / 100, Math.max(yearsLeft, 0.001))
    }, 0))

    const projectedLine = ages.map(a => {
      const yearsFromNow = a - clientAge
      return filteredPortfolio.reduce((sum, p) => {
        const fv = p.currentValue * Math.pow(1 + p.expectedReturn / 100, yearsFromNow)
        let rsv = 0
        if (p.monthlyContribution > 0 && yearsFromNow > 0) {
          const rm = p.expectedReturn / 100 / 12
          const nm = yearsFromNow * 12
          rsv = rm > 0 ? p.monthlyContribution * (Math.pow(1 + rm, nm) - 1) / rm : p.monthlyContribution * nm
        }
        return sum + fv + rsv
      }, 0)
    })

    const ctx = chartRef.current.getContext('2d')!
    chartInstance.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ages.map(a => 'Age ' + a),
        datasets: [
          { label: 'Target Corpus Required', data: targetLine, borderColor: '#A8834A', backgroundColor: 'rgba(168,131,74,0.07)', borderWidth: 2, tension: 0.4, pointRadius: 0, pointHoverRadius: 4, fill: true },
          { label: 'Projected Portfolio', data: projectedLine, borderColor: '#4A9E8A', backgroundColor: 'rgba(74,158,138,0.05)', borderWidth: 2, tension: 0.4, pointRadius: 0, pointHoverRadius: 4, fill: false },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#9A9690', font: { size: 11 }, boxWidth: 20 } },
          tooltip: { backgroundColor: 'rgba(26,24,22,0.95)', titleColor: 'rgba(196,164,100,0.9)', bodyColor: 'rgba(240,237,232,0.7)', padding: 12, callbacks: { label: (ctx: any) => ' ' + ctx.dataset.label + ': ' + fmt(ctx.parsed.y) } },
        },
        scales: {
          x: { ticks: { color: '#9A9690', font: { size: 9 }, maxTicksLimit: 12 }, grid: { display: false } },
          y: { ticks: { callback: (v: any) => fmt(v), color: '#9A9690', font: { size: 9 } }, grid: { color: 'rgba(26,24,22,0.04)' } },
        },
      },
    })
    return () => { if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null } }
  }, [loading, filteredGoals, filteredPortfolio, settings, clientAge])

  // ── RENDER ────────────────────────────────────────────────────────────────
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><div style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)' }}>Loading…</div></div>
  if (!client) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><div style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)' }}>No client selected.</div></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>

      {/* ── HERO BAND ── */}
      <div style={{ background: 'var(--charcoal)', padding: '0 48px' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '28px 0 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 30, fontWeight: 300, color: '#F0EDE8', lineHeight: 1.1 }}>Capital Mandate</div>
            <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{personLabel} · {filteredGoals.length} goal{filteredGoals.length !== 1 ? 's' : ''}</div>
          </div>

          {/* Person toggle — only in couple mode */}
          {planMode === 'couple' && (
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: 3 }}>
              {([
                { val: 'combined' as ActivePerson, label: 'Combined' },
                { val: 'client' as ActivePerson, label: clientName },
                { val: 'spouse' as ActivePerson, label: spouseName },
              ]).map(opt => (
                <button key={opt.val} onClick={() => setActivePerson(opt.val)}
                  style={{ padding: '7px 18px', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', transition: 'all 0.15s', background: activePerson === opt.val ? 'rgba(255,255,255,0.15)' : 'transparent', color: activePerson === opt.val ? '#F0EDE8' : 'rgba(255,255,255,0.4)' }}>
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* KPI strip */}
        <div style={{ display: 'flex', padding: '20px 0' }}>
          {[
            { label: 'Total Capital Required', val: fmt(totalCorpus), color: '#C4A464' },
            { label: 'Monthly Savings Needed', val: fmtMo(totalMonthlyNeeded), color: '#F0EDE8' },
            { label: 'Currently Investing', val: fmtMo(totalMonthlyInvesting), color: '#F0EDE8' },
            { label: 'Monthly Gap', val: monthlyGap > 0 ? '−' + fmtMo(monthlyGap) : 'On Track', color: monthlyGap > 0 ? '#E08080' : '#80C4A0' },
            { label: 'Portfolio Value', val: fmt(totalCurrentValue), color: '#80B4C4' },
          ].map((s, i) => (
            <div key={i} style={{ flex: 1, paddingRight: i < 4 ? 28 : 0, borderRight: i < 4 ? '1px solid rgba(255,255,255,0.06)' : 'none', marginRight: i < 4 ? 28 : 0 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300, color: s.color }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── SETTINGS BAR ── */}
      <div style={{ background: 'var(--cream2)', borderBottom: '1px solid var(--line)', padding: '10px 48px', display: 'flex', alignItems: 'center', gap: 36 }}>
        <span style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', flexShrink: 0 }}>Assumptions</span>
        {([{ label: 'Expected Return', key: 'expectedReturn' as const, min: 1, max: 15, step: 0.5 }, { label: 'Inflation', key: 'inflation' as const, min: 1, max: 8, step: 0.5 }]).map(s => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)', whiteSpace: 'nowrap' }}>{s.label}</span>
            <input type="range" min={s.min} max={s.max} step={s.step} value={settings[s.key]} onChange={e => updateSettings({ ...settings, [s.key]: parseFloat(e.target.value) })} style={{ width: 100, accentColor: 'var(--gold)' }} />
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 500, color: 'var(--ink)', background: 'white', border: '1px solid var(--line)', borderRadius: 6, padding: '3px 8px', minWidth: 40, textAlign: 'center' }}>{settings[s.key]}%</span>
          </div>
        ))}
      </div>

      {/* ── BODY ── */}
      <div style={{ padding: '32px 48px', flex: 1, display: 'flex', flexDirection: 'column', gap: 32 }}>

        {/* CHART */}
        <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>Capital Journey · {personLabel}</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 400, color: 'var(--ink)' }}>Projected Portfolio vs. Required Corpus</div>
          </div>
          <div style={{ padding: '16px 24px 20px', background: 'var(--cream)', height: 280 }}>
            <canvas ref={chartRef} />
          </div>
        </div>

        {/* TWO COLUMNS */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>

          {/* LEFT — Goals */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>From Strategic Objectives</div>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, color: 'var(--ink)' }}>Capital Goals</div>
              </div>
              <button onClick={() => setCustomGoalModal(true)} style={{ fontFamily: 'Inter', fontSize: 11, padding: '7px 14px', border: '1px solid var(--line)', borderRadius: 6, background: 'white', color: 'var(--ink2)', cursor: 'pointer' }}>+ Add Goal</button>
            </div>

            {filteredGoals.length === 0 ? (
              <div style={{ background: 'white', border: '2px dashed var(--line)', borderRadius: 12, padding: '40px 24px', textAlign: 'center' }}>
                <div style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)', marginBottom: 4 }}>No goals found</div>
                <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>Set goals in Strategic Objectives or add manually above</div>
              </div>
            ) : filteredGoals.map(g => (
              <div key={g.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{g.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{g.label}</span>
                    <SourceBadge source={g.source} />
                    {planMode === 'couple' && activePerson === 'combined' && <OwnerBadge owner={g.owner} clientName={clientName} spouseName={spouseName} />}
                  </div>
                  <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>Target age {g.targetAge} · {fmt(g.targetCorpus)}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>{fmtMo(g.monthlyRequired)}</div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--ink3)' }}>needed/mo</div>
                </div>
                {g.source === 'custom' && (
                  <button onClick={() => removeGoal(g.id)} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', color: 'var(--rouge)', fontFamily: 'Inter', fontSize: 11, padding: '4px 8px', flexShrink: 0 }}>×</button>
                )}
              </div>
            ))}

            {filteredGoals.length > 0 && (
              <div style={{ marginTop: 16, background: 'var(--charcoal)', borderRadius: 12, padding: '20px 24px' }}>
                <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(168,131,74,0.6)', marginBottom: 12 }}>Aggregate — {personLabel}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  {[{ label: 'Total Corpus', val: fmt(totalCorpus), color: '#C4A464' }, { label: 'Monthly Required', val: fmtMo(totalMonthlyNeeded), color: '#F0EDE8' }].map((s, i) => (
                    <div key={i} style={{ paddingRight: i === 0 ? 20 : 0, paddingLeft: i === 1 ? 20 : 0, borderRight: i === 0 ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
                      <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: 6 }}>{s.label}</div>
                      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300, color: s.color }}>{s.val}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT — Portfolio */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4 }}>Funding Vehicles</div>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, color: 'var(--ink)' }}>Investment Portfolio</div>
              </div>
              <button onClick={() => setPortfolioModal({ open: true })} style={{ fontFamily: 'Inter', fontSize: 11, padding: '7px 14px', border: '1px solid var(--line)', borderRadius: 6, background: 'white', color: 'var(--ink2)', cursor: 'pointer' }}>+ Add</button>
            </div>

            {filteredPortfolio.length === 0 ? (
              <div style={{ background: 'white', border: '2px dashed var(--line)', borderRadius: 12, padding: '40px 24px', textAlign: 'center' }}>
                <div style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--ink3)', marginBottom: 4 }}>No investments recorded</div>
                <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--ink3)' }}>Add existing RSPs and lump sum investments</div>
              </div>
            ) : (
              <div>
                {filteredPortfolio.map((p, i) => (
                  <div key={p.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 3, height: 36, borderRadius: 2, background: ['#A8834A', '#4A9E8A', '#4A7CB4', '#8A6AAA'][i % 4], flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{p.name}</span>
                        <span style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink3)', background: 'var(--cream2)', padding: '2px 6px', borderRadius: 4 }}>{p.type}</span>
                        {planMode === 'couple' && activePerson === 'combined' && <OwnerBadge owner={p.owner} clientName={clientName} spouseName={spouseName} />}
                      </div>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--ink3)' }}>
                        {p.monthlyContribution > 0 ? fmtMo(p.monthlyContribution) : '—'} · {fmt(p.currentValue)} · {p.expectedReturn}% p.a.
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={() => setPortfolioModal({ open: true, item: p })} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', color: 'var(--ink3)', fontFamily: 'Inter', fontSize: 11, padding: '4px 10px' }}>Edit</button>
                      <button onClick={() => deletePortfolioItem(p.id)} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', color: 'var(--rouge)', fontFamily: 'Inter', fontSize: 11, padding: '4px 8px' }}>×</button>
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, marginTop: 4 }}>
                  <span style={{ fontFamily: 'Inter', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Total Portfolio Value</span>
                  <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>{fmt(totalCurrentValue)}</span>
                </div>
              </div>
            )}

            {/* Gap panel */}
            <div style={{ marginTop: 16, background: monthlyGap > 0 ? 'var(--charcoal)' : 'rgba(128,196,160,0.12)', border: monthlyGap > 0 ? 'none' : '1px solid rgba(128,196,160,0.3)', borderRadius: 12, padding: '20px 24px' }}>
              <div style={{ fontFamily: 'Inter', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: monthlyGap > 0 ? 'rgba(168,131,74,0.6)' : 'rgba(80,160,120,0.7)', marginBottom: 10 }}>Gap Analysis · {personLabel}</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 300, color: monthlyGap > 0 ? '#F0EDE8' : '#50A078', marginBottom: monthlyGap > 0 ? 6 : 0 }}>
                {monthlyGap > 0
                  ? <>Need <span style={{ color: '#C4A464' }}>{fmtMo(totalMonthlyNeeded)}</span> · Investing <span style={{ color: '#E08080' }}>{fmtMo(totalMonthlyInvesting)}</span></>
                  : <>On track — investing {fmtMo(totalMonthlyInvesting)}</>}
              </div>
              {monthlyGap > 0 && <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Monthly shortfall: <span style={{ color: '#E08080', fontWeight: 600 }}>−{fmtMo(monthlyGap)}</span></div>}
            </div>
          </div>
        </div>
      </div>

      {portfolioModal.open && <PortfolioModal item={portfolioModal.item} onSave={savePortfolioItem} onClose={() => setPortfolioModal({ open: false })} isCouple={planMode === 'couple'} clientName={clientName} spouseName={spouseName} />}
      {customGoalModal && <CustomGoalModal onSave={addCustomGoal} onClose={() => setCustomGoalModal(false)} clientAge={clientAge} isCouple={planMode === 'couple'} clientName={clientName} spouseName={spouseName} />}
    </div>
  )
}
