'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { fmt, fmtMo, neededMonthly, retirementCorpus, ageFromDob } from '@/lib/calc'

export default function OverviewPage() {
  const [client, setClient] = useState<any>(null)
  const [family, setFamily] = useState<any[]>([])
  const [goals, setGoals] = useState<any[]>([])
  const [checklist, setChecklist] = useState<any[]>([])
  const [investments, setInvestments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [advisor, setAdvisor] = useState<any>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }
    const { data: adv } = await supabase.from('advisors').select('*').eq('id', user.id).single()
    if (adv) setAdvisor(adv)
    const { data: clients } = await supabase.from('clients').select('*').order('created_at', { ascending: false }).limit(1)
    if (!clients || clients.length === 0) { setLoading(false); return }
    const c = clients[0]
    setClient(c)
    const [{ data: fam }, { data: gls }, { data: chk }, { data: inv }] = await Promise.all([
      supabase.from('family_members').select('*').eq('client_id', c.id),
      supabase.from('goals').select('*').eq('client_id', c.id).order('sort_order'),
      supabase.from('planning_checklist').select('*').eq('client_id', c.id),
      supabase.from('investments').select('*').eq('client_id', c.id),
    ])
    setFamily(fam || [])
    setGoals(gls || [])
    setChecklist(chk || [])
    setInvestments(inv || [])
    setLoading(false)
  }

  async function toggleChecklist(item: any) {
    const newStatus = item.status === 'done' ? 'pending' : 'done'
    await supabase.from('planning_checklist').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', item.id)
    setChecklist(prev => prev.map(c => c.id === item.id ? { ...c, status: newStatus } : c))
  }

  if (loading) return (<div className="flex items-center justify-center h-full"><div className="text-sm" style={{ color: 'var(--ink3)' }}>Loading…</div></div>)
  if (!client) return (<div className="flex flex-col items-center justify-center h-full gap-4"><div className="font-serif text-2xl" style={{ color: 'var(--ink)' }}>Welcome to Bespoke Capital</div><p className="text-sm" style={{ color: 'var(--ink3)' }}>Start by adding your first client using the selector in the sidebar.</p></div>)

  const initials = (name: string) => name?.trim().split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  const retGoal = goals.find(g => g.type === 'retirement')
  const globalROR = 5
  const globalInf = 3

  function goalMonthly(g: any): number {
    if (g.type === 'retirement') {
      const corpus = retirementCorpus(g.monthly_income || 0, client.age || 35, g.ret_age || 65, g.life_exp || 85, g.inflation_rate || globalInf, g.post_rate || 3, g.legacy_amt || 0, g.cont_inv || false)
      return neededMonthly(corpus, g.rate_of_return || globalROR, (g.ret_age || 65) - (client.age || 35))
    }
    return neededMonthly(g.target_amount || 0, globalROR, (g.target_age || 65) - (client.age || 35))
  }

  const totalMonthly = goals.reduce((s, g) => s + goalMonthly(g), 0)
  const totalRSP = investments.reduce((s, i) => s + (i.monthly_contribution || 0), 0)
  const gap = totalMonthly - totalRSP
  const totalCorpus = goals.reduce((s, g) => {
    if (g.type === 'retirement') return s + retirementCorpus(g.monthly_income || 0, client.age || 35, g.ret_age || 65, g.life_exp || 85, g.inflation_rate || globalInf, g.post_rate || 3, g.legacy_amt || 0, g.cont_inv || false)
    return s + (g.target_amount || 0)
  }, 0)
  const doneCount = checklist.filter(c => c.status === 'done').length
  const GOAL_COLORS = ['#A8834A', '#4A7C9E', '#7A6AAA', '#6A9A8A', '#8A5E5E', '#5E8A6A']

  return (
    <div className="flex flex-col min-h-full">
      <div style={{ background: 'var(--charcoal)', padding: '0 48px' }}>
        <div className="flex items-center gap-4 py-8" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="w-12 h-12 rounded-full flex items-center justify-center font-serif text-lg flex-shrink-0" style={{ background: 'rgba(168,131,74,0.25)', border: '1px solid rgba(168,131,74,0.35)', color: 'rgba(255,255,255,0.7)' }}>{initials(client.name)}</div>
          <div>
            <div className="font-serif text-3xl font-light" style={{ color: '#F0EDE8' }}>{client.name}</div>
            <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {client.gender && <span>{client.gender}</span>}
              {client.age && <span>Age <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{client.age}</strong></span>}
              {client.start_year && <span>Investing since {client.start_year}</span>}
            </div>
          </div>
          <button className="ml-auto text-xs px-4 py-1.5" style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>Edit Client</button>
        </div>
        <div className="flex py-5 gap-0">
          {[
            { label: 'Monthly Savings Needed', val: fmtMo(totalMonthly), sub: goals.length + ' goal' + (goals.length !== 1 ? 's' : '') + ' combined', color: '#C4A464' },
            { label: 'Total Goals Corpus', val: fmt(totalCorpus), sub: 'across all goals', color: '#F0EDE8' },
            { label: 'Years to Retirement', val: retGoal ? String((retGoal.ret_age || 65) - (client.age || 35)) : '—', sub: 'Retire at age ' + (retGoal?.ret_age || 65), color: '#F0EDE8' },
            { label: 'Monthly Gap', val: gap > 0 ? '−' + fmtMo(gap) : 'On track', sub: gap > 0 ? 'action required' : '', color: gap > 0 ? '#E08080' : '#80C4A0' },
            { label: 'Planning Status', val: doneCount + ' / ' + checklist.length, sub: (checklist.length - doneCount) + ' pending', color: '#F0EDE8' },
          ].map((s, i) => (
            <div key={i} className="flex-1" style={{ paddingRight: 28, borderRight: i < 4 ? '1px solid rgba(255,255,255,0.06)' : 'none', marginRight: i < 4 ? 28 : 0 }}>
              <div className="text-xs tracking-widest uppercase mb-1.5" style={{ color: 'rgba(255,255,255,0.28)' }}>{s.label}</div>
              <div className="font-serif text-xl font-light" style={{ color: s.color }}>{s.val}</div>
              {s.sub && <div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>{s.sub}</div>}
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: '36px 48px', flex: 1 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          <div>
            <div className="text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Family Members</div>
            <div className="font-serif text-xl mb-4" style={{ color: 'var(--ink)' }}>Household Profile</div>
            {family.length === 0 ? (
              <div className="text-sm py-4" style={{ color: 'var(--ink3)', borderTop: '1px solid var(--line)' }}>No family members added yet.</div>
            ) : family.map(m => (
              <div key={m.id} className="flex items-center gap-3 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center font-serif text-sm flex-shrink-0 text-white" style={{ background: m.relationship === 'Spouse' ? '#C4A882' : '#7AA890' }}>{initials(m.name)}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2"><span className="text-sm font-medium">{m.name}</span><span className="text-xs px-1.5 py-0.5 rounded" style={{ background: m.relationship === 'Spouse' ? '#E8EDF5' : '#E8F2ED', color: m.relationship === 'Spouse' ? '#4A6090' : '#2A5E46' }}>{m.relationship}</span></div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>Age {m.age || (m.dob ? ageFromDob(m.dob) : '?')}</div>
                </div>
              </div>
            ))}
            <button className="mt-3 text-sm px-3 py-1.5" style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}>+ Add Member</button>
          </div>
          <div className="space-y-6">
            <div>
              <div className="flex items-end justify-between mb-4">
                <div><div className="text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Investment Plan</div><div className="font-serif text-xl" style={{ color: 'var(--ink)' }}>Goals Summary</div></div>
                <button className="text-xs px-3 py-1.5" style={{ color: 'var(--ink3)', border: '1px solid var(--line2)' }}>View all →</button>
              </div>
              {goals.length === 0 ? (
                <div className="text-sm py-4" style={{ color: 'var(--ink3)', borderTop: '1px solid var(--line)' }}>No goals yet. Add goals in the Investment Goals tab.</div>
              ) : goals.map((g, i) => {
                const mo = goalMonthly(g)
                const col = GOAL_COLORS[i % GOAL_COLORS.length]
                const meta = g.type === 'retirement' ? fmt(retirementCorpus(g.monthly_income || 0, client.age || 35, g.ret_age || 65, g.life_exp || 85, g.inflation_rate || globalInf, g.post_rate || 3, g.legacy_amt || 0, g.cont_inv || false)) + ' by age ' + (g.ret_age || 65) : fmt(g.target_amount || 0) + ' by age ' + (g.target_age || 65)
                return (
                  <div key={g.id} className="flex items-center py-3.5 gap-3" style={{ borderBottom: '1px solid var(--line)' }}>
                    <div className="w-0.5 h-9 rounded flex-shrink-0" style={{ background: col }}></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2"><span className="text-sm font-medium">{g.name}</span><span className="text-xs px-1.5 py-0.5 font-medium rounded" style={{ background: col + '18', color: col }}>{g.type === 'retirement' ? 'RETIREMENT' : 'GOAL'}</span></div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>{meta}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--ink3)' }}>Monthly</div>
                      <div className="font-serif text-lg" style={{ color: col }}>{fmtMo(mo)}<span className="text-xs font-sans" style={{ color: 'var(--ink3)' }}>/mo</span></div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div>
              <div className="text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Planning Checklist</div>
              <div className="font-serif text-xl mb-3" style={{ color: 'var(--ink)' }}>What&apos;s Been Done</div>
              {checklist.map(item => (
                <div key={item.id} onClick={() => toggleChecklist(item)} className="flex items-center gap-3 py-2.5 cursor-pointer" style={{ borderBottom: '1px solid var(--line)' }}>
                  <div className="w-4 h-4 rounded flex items-center justify-center text-xs flex-shrink-0" style={{ background: item.status === 'done' ? 'var(--emerald-l)' : 'transparent', color: item.status === 'done' ? 'var(--emerald)' : 'var(--line2)', border: '1px solid ' + (item.status === 'done' ? 'rgba(42,94,70,0.2)' : 'var(--line2)') }}>{item.status === 'done' ? '✓' : ''}</div>
                  <div className="text-xs flex-1">{item.category}</div>
                  <div className="text-xs px-2 py-0.5 rounded font-mono" style={{ background: item.status === 'done' ? 'var(--emerald-l)' : 'transparent', color: item.status === 'done' ? 'var(--emerald)' : 'var(--ink3)' }}>{item.status === 'done' ? 'Complete' : 'Pending'}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}