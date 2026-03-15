'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { fmt, fmtMo, neededMonthly, retirementCorpus, projectFwd } from '@/lib/calc'
import { Chart, registerables } from 'chart.js'
Chart.register(...registerables)

const COLORS = ['#A8834A','#4A7C9E','#7A6AAA','#6A9A8A','#8A5E5E','#5E8A6A']

export default function GoalsPage() {
  const [client, setClient] = useState<any>(null)
  const [goals, setGoals] = useState<any[]>([])
  const [investments, setInvestments] = useState<any[]>([])
  const [settings, setSettings] = useState({ global_return: 5, global_inflation: 3 })
  const [loading, setLoading] = useState(true)
  const [showGoalModal, setShowGoalModal] = useState(false)
  const [editGoal, setEditGoal] = useState<any>(null)
  const [showInvModal, setShowInvModal] = useState(false)
  const [editInv, setEditInv] = useState<any>(null)
  const chartRef = useRef<any>(null)
  const chartInstance = useRef<any>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { load() }, [])
  useEffect(() => { if (!loading && client) drawChart() }, [loading, goals, investments, settings])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }
    const { data: clients } = await supabase.from('clients').select('*').order('created_at', { ascending: false }).limit(1)
    if (!clients?.length) { setLoading(false); return }
    const c = clients[0]; setClient(c)
    const [{ data: gls }, { data: inv }, { data: sett }] = await Promise.all([
      supabase.from('goals').select('*').eq('client_id', c.id).order('sort_order'),
      supabase.from('investments').select('*').eq('client_id', c.id),
      supabase.from('plan_settings').select('*').eq('client_id', c.id).single(),
    ])
    setGoals(gls || [])
    setInvestments(inv || [])
    if (sett) setSettings(sett)
    setLoading(false)
  }

  function goalMonthly(g: any): number {
    const age = client?.age || 35
    const ror = settings.global_return
    const inf = settings.global_inflation
    if (g.type === 'retirement') {
      const corpus = retirementCorpus(g.monthly_income || 0, age, g.ret_age || 65, g.life_exp || 85, inf, g.post_rate || 3, g.legacy_amt || 0, g.cont_inv || false)
      return neededMonthly(corpus, g.rate_of_return || ror, (g.ret_age || 65) - age)
    }
    return neededMonthly(g.target_amount || 0, ror, (g.target_age || 65) - age)
  }

  function drawChart() {
    if (!chartRef.current || !client) return
    if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null }
    const age = client.age || 35
    const retGoal = goals.find(g => g.type === 'retirement')
    const lifeExp = retGoal?.life_exp || 85
    const retAge = retGoal?.ret_age || 65
    const maxAge = Math.max(lifeExp, retAge + 5, age + 30)
    const ages = Array.from({ length: maxAge - age + 1 }, (_, i) => age + i)
    const ror = settings.global_return / 100
    const gi = settings.global_inflation / 100
    const required = ages.map(a => goals.reduce((s, g) => {
      const tAge = g.type === 'retirement' ? (g.ret_age || 65) : (g.target_age || 65)
      const mo = goalMonthly(g)
      if (g.type === 'retirement') {
        if (a <= tAge) { const n = Math.max(0, a - (client.age || 35)); return s + (ror === 0 ? mo * 12 * n : mo * 12 * (Math.pow(1 + ror, n) - 1) / ror) }
        else {
          const drawdownYrs = Math.max(1, lifeExp - tAge)
          const yearsInto = a - tAge
          const remaining = Math.max(0, drawdownYrs - yearsInto)
          if (remaining <= 0) return s
          const fvMo = (g.monthly_income || 0) * Math.pow(1 + gi, tAge - (client.age || 35))
          const fvAnn = fvMo * 12
          const legacyFV = g.legacy_on ? (g.legacy_amt || 0) : 0
          const dr = g.cont_inv ? (g.post_rate || 3) / 100 : gi
          const legacyPV = remaining > 0 && legacyFV > 0 ? legacyFV / Math.pow(1 + Math.max(dr, 0.001), remaining) : 0
          let incomeCorpus = gi < 0.0001 ? fvAnn * remaining : Math.max(0, fvAnn * (Math.pow(1 + gi, remaining) - 1) / gi * (1 + gi))
          return s + incomeCorpus + legacyPV
        }
      } else {
        if (a <= tAge) { const n = Math.max(0, a - (client.age || 35)); return s + (ror === 0 ? mo * 12 * n : mo * 12 * (Math.pow(1 + ror, n) - 1) / ror) }
        return s
      }
    }, 0))
    const portfolio = ages.map(a => {
      let total = 0
      investments.forEach(inv => {
        if (!inv.start_date) return
        const startYr = parseInt(inv.start_date.substring(0, 4))
        const invStartAge = age - (new Date().getFullYear() - startYr)
        if (a < invStartAge) return
        if (!retGoal || a <= retAge) {
          const n = Math.max(0, a - age)
          const mo = inv.mode === 'Lump Sum' ? 0 : (inv.monthly_contribution || 0)
          if (inv.current_value > 0) { total += projectFwd(inv.current_value, mo, settings.global_return, n) }
          else { const lump = inv.lump_sum || 0; const elapsed = Math.max(0, a - invStartAge); total += ror === 0 ? lump + mo * 12 * elapsed : lump * Math.pow(1 + ror, elapsed) + mo * 12 * (Math.pow(1 + ror, elapsed) - 1) / ror }
        } else {
          const mo = inv.mode === 'Lump Sum' ? 0 : (inv.monthly_contribution || 0)
          let valAtRet = inv.current_value > 0 ? projectFwd(inv.current_value, mo, settings.global_return, retAge - age) : 0
          const fvMoAtRet = retGoal ? (retGoal.monthly_income || 0) * Math.pow(1 + gi, retAge - age) : 0
          let remaining = valAtRet
          for (let y = 0; y < a - retAge; y++) { remaining = remaining * (1 + (retGoal?.cont_inv ? (retGoal.post_rate || 3) / 100 : 0)) - fvMoAtRet * 12 * Math.pow(1 + gi, y); if (remaining <= 0) { remaining = 0; break } }
          total += remaining
        }
      })
      return total > 0 ? total : null
    })
    const ctx = chartRef.current.getContext('2d')
    chartInstance.current = new Chart(ctx, {
      type: 'line',
      data: { labels: ages.map(a => 'Age ' + a), datasets: [
        { label: 'Required Portfolio', data: required, borderColor: '#A8834A', backgroundColor: 'rgba(168,131,74,0.06)', borderWidth: 2, tension: 0.35, pointRadius: 0, pointHoverRadius: 4, fill: true },
        ...(investments.length > 0 ? [{ label: 'Current Portfolio', data: portfolio, borderColor: '#4A7C9E', backgroundColor: 'rgba(74,124,158,0.04)', borderWidth: 2, tension: 0.35, pointRadius: 0, pointHoverRadius: 4, fill: true, spanGaps: true }] : [])
      ]},
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#9A9690', font: { size: 11 }, boxWidth: 16 } },
          tooltip: { backgroundColor: 'rgba(26,24,22,0.95)', titleColor: 'rgba(196,164,100,0.9)', bodyColor: 'rgba(240,237,232,0.7)', padding: 12, callbacks: { label: (ctx: any) => '  ' + ctx.dataset.label + ':  ' + fmt(ctx.parsed.y) } }
        },
        scales: { x: { ticks: { color: '#9A9690', font: { size: 9 }, maxTicksLimit: 10 }, grid: { display: false } }, y: { ticks: { callback: (v: any) => fmt(v), color: '#9A9690', font: { size: 9 } }, grid: { color: 'rgba(26,24,22,0.05)' } } }
      }
    })
  }

  async function deleteGoal(id: string) { if (!confirm('Delete this goal?')) return; await supabase.from('goals').delete().eq('id', id); setGoals(prev => prev.filter(g => g.id !== id)) }
  async function deleteInv(id: string) { if (!confirm('Delete this investment?')) return; await supabase.from('investments').delete().eq('id', id); setInvestments(prev => prev.filter(i => i.id !== id)) }

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-sm" style={{ color: 'var(--ink3)' }}>Loading…</div></div>
  if (!client) return <div className="flex items-center justify-center h-full"><div className="text-sm" style={{ color: 'var(--ink3)' }}>No client selected.</div></div>

  const totalMonthly = goals.reduce((s, g) => s + goalMonthly(g), 0)
  const totalRSP = investments.reduce((s, i) => s + (i.monthly_contribution || 0), 0)
  const gap = totalMonthly - totalRSP
  const retGoal = goals.find(g => g.type === 'retirement')
  const corpus = retGoal ? retirementCorpus(retGoal.monthly_income || 0, client.age || 35, retGoal.ret_age || 65, retGoal.life_exp || 85, settings.global_inflation, retGoal.post_rate || 3, retGoal.legacy_amt || 0, retGoal.cont_inv || false) : 0

  return (
    <div className="flex flex-col min-h-full">
      <div style={{ background: 'var(--charcoal)', padding: '0 48px' }}>
        <div className="flex items-center gap-4 py-8" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <div className="font-serif text-3xl font-light" style={{ color: '#F0EDE8' }}>Investment Goals</div>
            <div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{client.name} · {goals.length} goal{goals.length !== 1 ? 's' : ''} · Retirement at {retGoal?.ret_age || 65} · Life expectancy {retGoal?.life_exp || 85}</div>
          </div>
          <button onClick={() => { setEditGoal(null); setShowGoalModal(true) }} className="ml-auto text-xs px-4 py-1.5" style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>+ Add Goal</button>
        </div>
        <div className="flex py-5 gap-0">
          {[{ label: 'Capital Fund Required', val: corpus > 0 ? fmt(corpus) : '—', color: '#C4A464' }, { label: 'Monthly Savings Needed', val: fmtMo(totalMonthly), color: '#F0EDE8' }, { label: 'Currently Saving', val: fmtMo(totalRSP), color: '#F0EDE8' }, { label: 'Monthly Gap', val: gap > 0 ? '−' + fmtMo(gap) : 'On track', color: gap > 0 ? '#E08080' : '#80C4A0' }, { label: 'Portfolio IRR', val: investments.length > 0 ? settings.global_return + '%' : '—', color: '#80C4A0' }].map((s, i) => (
            <div key={i} className="flex-1" style={{ paddingRight: 28, borderRight: i < 4 ? '1px solid rgba(255,255,255,0.06)' : 'none', marginRight: i < 4 ? 28 : 0 }}>
              <div className="text-xs tracking-widest uppercase mb-1.5" style={{ color: 'rgba(255,255,255,0.28)' }}>{s.label}</div>
              <div className="font-serif text-xl font-light" style={{ color: s.color }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: 'white', borderBottom: '1px solid var(--line)' }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="font-serif text-base">Capital Journey — Age {client.age} to {retGoal?.life_exp || 85}</div>
        </div>
        <div className="flex gap-8 px-6 py-3" style={{ background: 'var(--cream)', borderBottom: '1px solid var(--line)' }}>
          {[{ label: 'Expected Return', key: 'global_return', min: 1, max: 12 }, { label: 'Inflation', key: 'global_inflation', min: 1, max: 8 }].map(s => (
            <div key={s.key} className="flex items-center gap-3">
              <span className="text-xs tracking-widest uppercase" style={{ color: 'var(--ink3)' }}>{s.label}</span>
              <input type="range" min={s.min} max={s.max} step={0.5} value={(settings as any)[s.key]}
                onChange={async e => { const v = parseFloat(e.target.value); const ns = { ...settings, [s.key]: v }; setSettings(ns); await supabase.from('plan_settings').upsert({ client_id: client.id, ...ns }) }}
                style={{ width: 100, accentColor: 'var(--ink)' }} />
              <span className="text-xs font-mono font-medium" style={{ color: 'var(--ink)' }}>{(settings as any)[s.key]}%</span>
            </div>
          ))}
        </div>
        <div style={{ padding: '20px 24px 12px', background: 'var(--cream)', height: 280 }}><canvas ref={chartRef} /></div>
      </div>
      <div style={{ padding: '32px 48px', flex: 1 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          <div>
            <div className="flex justify-between items-center mb-4">
              <div><div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--ink3)' }}>Planning</div><div className="font-serif text-xl" style={{ color: 'var(--ink)' }}>Investment Goals</div></div>
              <button onClick={() => { setEditGoal(null); setShowGoalModal(true) }} className="text-xs px-3 py-1.5" style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}>+ Add</button>
            </div>
            {goals.length === 0 ? <div className="text-sm py-4" style={{ color: 'var(--ink3)', borderTop: '1px solid var(--line)' }}>No goals yet.</div>
              : goals.map((g, i) => {
                const mo = goalMonthly(g); const col = COLORS[i % COLORS.length]
                const meta = g.type === 'retirement' ? 'Target ' + fmt(corpus) + ' by age ' + (g.ret_age || 65) : 'Target ' + fmt(g.target_amount || 0) + ' by age ' + (g.target_age || 65)
                return (<div key={g.id} className="flex items-center py-3.5 gap-3" style={{ borderBottom: '1px solid var(--line)' }}>
                  <div className="w-0.5 h-9 rounded flex-shrink-0" style={{ background: col }} />
                  <div className="flex-1 min-w-0"><div className="flex items-center gap-2"><span className="text-sm font-medium">{g.name}</span><span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: col + '18', color: col }}>{g.type === 'retirement' ? 'RETIREMENT' : 'GOAL'}</span></div><div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>{meta}</div></div>
                  <div className="text-right mr-3"><div className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--ink3)' }}>Monthly</div><div className="font-serif text-lg" style={{ color: col }}>{fmtMo(mo)}<span className="text-xs font-sans" style={{ color: 'var(--ink3)' }}>/mo</span></div></div>
                  <div className="flex gap-1"><button onClick={() => { setEditGoal(g); setShowGoalModal(true) }} className="text-xs px-2 py-1" style={{ color: 'var(--ink3)', border: '1px solid var(--line)' }}>Edit</button><button onClick={() => deleteGoal(g.id)} className="text-xs px-2 py-1" style={{ color: 'var(--rouge)', border: '1px solid var(--line)' }}>×</button></div>
                </div>)
              })}
            {gap > 0 && (<div style={{ background: 'var(--charcoal)', padding: '24px 28px', marginTop: 20 }}>
              <div className="text-xs tracking-widest uppercase mb-2" style={{ color: 'rgba(168,131,74,0.6)' }}>Gap Analysis</div>
              <div className="font-serif text-xl font-light mb-1" style={{ color: '#F0EDE8' }}>You need <span style={{ color: '#C4A464' }}>{fmtMo(totalMonthly)}/mo</span> to be on track.</div>
              <div className="text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>You are investing {fmtMo(totalRSP)}/mo today. Gap: <span style={{ color: '#E08080' }}>−{fmtMo(gap)}/mo</span></div>
            </div>)}
          </div>
          <div>
            <div className="flex justify-between items-center mb-4">
              <div><div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--ink3)' }}>Portfolio</div><div className="font-serif text-xl" style={{ color: 'var(--ink)' }}>Current Investments</div></div>
              <button onClick={() => { setEditInv(null); setShowInvModal(true) }} className="text-xs px-3 py-1.5" style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}>+ Add</button>
            </div>
            {investments.length === 0 ? <div className="text-sm py-4" style={{ color: 'var(--ink3)', borderTop: '1px solid var(--line)' }}>No investments yet.</div>
              : <>{investments.map((inv, i) => {
                const col = COLORS[(goals.length + i) % COLORS.length]
                const meta = (inv.mode === 'Lump Sum' ? fmt(inv.lump_sum || 0) + ' lump' : fmtMo(inv.monthly_contribution || 0) + '/mo') + ' · Since ' + (inv.start_date || '?')
                const perf = inv.irr != null ? (inv.irr >= settings.global_return ? 'out' : 'under') : 'new'
                return (<div key={inv.id} className="flex items-center py-3.5 gap-3" style={{ borderBottom: '1px solid var(--line)' }}>
                  <div className="w-0.5 h-8 rounded flex-shrink-0" style={{ background: col }} />
                  <div className="flex-1 min-w-0"><div className="flex items-center gap-2"><span className="text-sm font-medium">{inv.name}</span><span className="text-xs px-1 py-0.5 rounded" style={{ background: 'var(--cream2)', color: 'var(--ink3)' }}>{inv.product_type}</span></div><div className="text-xs mt-0.5 font-mono" style={{ color: 'var(--ink3)' }}>{meta}</div></div>
                  <div className="text-right mr-2"><div className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--ink3)' }}>Value</div><div className="font-serif text-base">{fmt(inv.current_value || 0)}</div></div>
                  <div className="flex gap-1"><button onClick={() => { setEditInv(inv); setShowInvModal(true) }} className="text-xs px-2 py-1" style={{ color: 'var(--ink3)', border: '1px solid var(--line)' }}>Edit</button><button onClick={() => deleteInv(inv.id)} className="text-xs px-2 py-1" style={{ color: 'var(--rouge)', border: '1px solid var(--line)' }}>×</button></div>
                </div>)
              })}
              <div className="flex justify-between pt-3" style={{ borderTop: '1px solid var(--line2)' }}><div className="text-xs uppercase tracking-widest" style={{ color: 'var(--ink3)' }}>Total Portfolio</div><div className="font-serif text-lg">{fmt(investments.reduce((s, i) => s + (i.current_value || 0), 0))}</div></div>
              </> }
          </div>
        </div>
      </div>
      {showGoalModal && <GoalModal client={client} goal={editGoal} settings={settings} onClose={() => setShowGoalModal(false)} onSaved={async () => { setShowGoalModal(false); await load() }} />}
      {showInvModal && <InvModal client={client} inv={editInv} onClose={() => setShowInvModal(false)} onSaved={async () => { setShowInvModal(false); await load() }} />}
    </div>
  )
}

function GoalModal({ client, goal, settings, onClose, onSaved }: any) {
  const [type, setType] = useState(goal?.type || 'retirement')
  const [name, setName] = useState(goal?.name || '')
  const [targetAmt, setTargetAmt] = useState(goal?.target_amount || '')
  const [targetAge, setTargetAge] = useState(goal?.target_age || '')
  const [retAge, setRetAge] = useState(goal?.ret_age || 65)
  const [lifeExp, setLifeExp] = useState(goal?.life_exp || 85)
  const [monthlyInc, setMonthlyInc] = useState(goal?.monthly_income || '')
  const [ror, setRor] = useState(goal?.rate_of_return || settings.global_return)
  const [inf, setInf] = useState(goal?.inflation_rate || settings.global_inflation)
  const [legacyOn, setLegacyOn] = useState(goal?.legacy_on || false)
  const [legacyAmt, setLegacyAmt] = useState(goal?.legacy_amt || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  async function save() {
    if (!name.trim()) { setError('Name required'); return }
    setLoading(true)
    const data: any = { client_id: client.id, type, name: name.trim() }
    if (type === 'retirement') Object.assign(data, { ret_age: retAge, life_exp: lifeExp, monthly_income: parseFloat(String(monthlyInc)) || 0, rate_of_return: ror, inflation_rate: inf, legacy_on: legacyOn, legacy_amt: legacyOn ? parseFloat(String(legacyAmt)) || 0 : 0 })
    else Object.assign(data, { target_amount: parseFloat(String(targetAmt)) || 0, target_age: parseInt(String(targetAge)) || 65 })
    if (goal?.id) await supabase.from('goals').update(data).eq('id', goal.id)
    else await supabase.from('goals').insert(data)
    onSaved()
  }

  const preview = type === 'retirement' && monthlyInc ? retirementCorpus(parseFloat(String(monthlyInc)), client.age || 35, retAge, lifeExp, inf, 3, legacyOn ? parseFloat(String(legacyAmt)) || 0 : 0, false) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,24,22,0.6)' }}>
      <div className="w-full max-w-lg overflow-y-auto" style={{ background: 'white', borderRadius: 8, maxHeight: '90vh' }}>
        <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)' }}><div className="font-serif text-xl">{goal ? 'Edit Goal' : 'Add Goal'}</div><button onClick={onClose} style={{ color: 'var(--ink3)', fontSize: 20 }}>×</button></div>
        <div className="px-6 py-5 space-y-4">
          {!goal && (<div className="flex gap-2">{['retirement', 'standard'].map(t => (<button key={t} onClick={() => setType(t)} className="flex-1 py-2 text-sm font-medium" style={{ background: type === t ? 'var(--ink)' : 'var(--cream)', color: type === t ? 'white' : 'var(--ink2)', border: '1px solid var(--line)' }}>{t === 'retirement' ? 'Retirement' : 'Standard Goal'}</button>))}</div>)}
          <div><label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Goal Name</label><input value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }} placeholder={type === 'retirement' ? 'Retirement Fund' : "Children's Education"} /></div>
          {type === 'retirement' ? (<>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>{[['Retirement Age', retAge, setRetAge], ['Life Expectancy', lifeExp, setLifeExp], ['Monthly Income (Today $)', monthlyInc, setMonthlyInc]].map(([l, v, s]: any) => (<div key={l}><label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>{l}</label><input type="number" value={v} onChange={e => s(e.target.value)} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)' }} /></div>))}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{[['Expected Return %', ror, setRor], ['Inflation %', inf, setInf]].map(([l, v, s]: any) => (<div key={l}><label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>{l}</label><input type="number" step="0.5" value={v} onChange={e => s(parseFloat(e.target.value))} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)' }} /></div>))}</div>
            <div className="flex items-center gap-3"><input type="checkbox" checked={legacyOn} onChange={e => setLegacyOn(e.target.checked)} id="legacy-chk" /><label htmlFor="legacy-chk" className="text-sm" style={{ color: 'var(--ink2)' }}>Leave a legacy amount</label></div>
            {legacyOn && <div><label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Legacy Amount ($)</label><input type="number" value={legacyAmt} onChange={e => setLegacyAmt(e.target.value)} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)' }} placeholder="e.g. 500000" /></div>}
            {preview && preview > 0 && (<div className="px-4 py-3" style={{ background: 'var(--gold-l)', borderLeft: '2px solid var(--gold)' }}><div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--gold-tag)' }}>Capital Fund Required</div><div className="font-serif text-2xl" style={{ color: 'var(--gold-tag)' }}>{fmt(preview)}</div><div className="text-xs mt-1" style={{ color: 'var(--ink3)' }}>Monthly savings needed: {fmtMo(neededMonthly(preview, ror, retAge - (client.age || 35)))}/mo</div></div>)}
          </>) : (<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{[['Target Amount ($)', targetAmt, setTargetAmt], ['Target Age', targetAge, setTargetAge]].map(([l, v, s]: any) => (<div key={l}><label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>{l}</label><input type="number" value={v} onChange={e => s(e.target.value)} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)' }} /></div>))}</div>)}
          {error && <div className="text-sm px-3 py-2" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)' }}>{error}</div>}
        </div>
        <div className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--line)' }}><button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}>Cancel</button><button onClick={save} disabled={loading} className="px-4 py-2 text-sm font-medium text-white" style={{ background: 'var(--ink)' }}>{loading ? 'Saving…' : goal ? 'Update Goal' : 'Save Goal'}</button></div>
      </div>
    </div>
  )
}

function InvModal({ client, inv, onClose, onSaved }: any) {
  const [name, setName] = useState(inv?.name || '')
  const [type, setType] = useState(inv?.product_type || 'Unit Trust')
  const [mode, setMode] = useState(inv?.mode || 'Regular')
  const [startDate, setStartDate] = useState(inv?.start_date || '')
  const [monthly, setMonthly] = useState(inv?.monthly_contribution || '')
  const [lump, setLump] = useState(inv?.lump_sum || '')
  const [curVal, setCurVal] = useState(inv?.current_value || '')
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  async function save() {
    if (!name.trim()) return
    setLoading(true)
    const data = { client_id: client.id, name: name.trim(), product_type: type, mode, start_date: startDate || null, monthly_contribution: parseFloat(String(monthly)) || 0, lump_sum: parseFloat(String(lump)) || 0, current_value: parseFloat(String(curVal)) || 0 }
    if (inv?.id) await supabase.from('investments').update(data).eq('id', inv.id)
    else await supabase.from('investments').insert(data)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,24,22,0.6)' }}>
      <div className="w-full max-w-md" style={{ background: 'white', borderRadius: 8 }}>
        <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)' }}><div className="font-serif text-xl">{inv ? 'Edit Investment' : 'Add Investment'}</div><button onClick={onClose} style={{ color: 'var(--ink3)', fontSize: 20 }}>×</button></div>
        <div className="px-6 py-5 space-y-4">
          <div><label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Investment Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. FPI Global Wealth" className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)' }} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Type</label><select value={type} onChange={e => setType(e.target.value)} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)' }}>{['Unit Trust','ILP','101 Policy','Endowment','Annuity','Shares / ETF','Bond','CPF','Other'].map(t => <option key={t}>{t}</option>)}</select></div>
            <div><label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Mode</label><select value={mode} onChange={e => setMode(e.target.value)} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)' }}>{['Regular','Lump Sum','Mixed'].map(m => <option key={m}>{m}</option>)}</select></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Start Date</label><input type="month" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)' }} /></div>
            <div><label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Monthly ($)</label><input type="number" value={monthly} onChange={e => setMonthly(e.target.value)} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)' }} placeholder="0" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Lump Sum ($)</label><input type="number" value={lump} onChange={e => setLump(e.target.value)} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)' }} placeholder="0" /></div>
            <div><label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Current Value ($)</label><input type="number" value={curVal} onChange={e => setCurVal(e.target.value)} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)' }} placeholder="0" /></div>
          </div>
        </div>
        <div className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--line)' }}><button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}>Cancel</button><button onClick={save} disabled={loading} className="px-4 py-2 text-sm font-medium text-white" style={{ background: 'var(--ink)' }}>{loading ? 'Saving…' : inv ? 'Update' : 'Save'}</button></div>
      </div>
    </div>
  )
}