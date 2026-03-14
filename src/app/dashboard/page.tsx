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
    const c = clients[0]; setClient(c)
    const [{ data: fam }, { data: gls }, { data: chk }, { data: inv }] = await Promise.all([
      supabase.from('family_members').select('*').eq('client_id', c.id),
      supabase.from('goals').select('*').eq('client_id', c.id).order('sort_order'),
      supabase.from('planning_checklist').select('*').eq('client_id', c.id),
      supabase.from('investments').select('*').eq('client_id', c.id),
    ])
    setFamily(fam || []); setGoals(gls || []); setChecklist(chk || []); setInvestments(inv || []); setLoading(false)
  }

  if (loading) return <div className="flex items-center justify-center h-full"><div style={{ color: 'var(--ink3)' }}>Loading…</div></div>
  if (!client) return <div className="flex flex-col items-center justify-center h-full gap-4"><div className="font-serif text-2xl">Welcome to Bespoke Capital</div><p className="text-sm" style={{ color: 'var(--ink3)' }}>Start by adding your first client using the selector in the sidebar.</p></div>

  const initials = (name: string) => name?.trim().split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  const retGoal = goals.find(g => g.type === 'retirement')
  const globalROR = 5, globalInf = 3
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
  const doneCount = checklist.filter(c => c.status === 'done').length
  const GOAL_COLORS = ['#A8834A', '#4A7C9E', '#7A6AAA', '#6A9A8A', '#8A5E5E', '#5E8A6A']

  return (
    <div className="flex flex-col min-h-full">
      <div style={{ background: 'var(--charcoal)', padding: '0 48px' }}>
        <div className="flex items-center gap-4 py-8" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="w-12 h-12 rounded-full flex items-center justify-center font-serif text-lg flex-shrink-0" style={{ background: 'rgba(168,131,74,0.25)', color: 'rgba(255,255,255,0.7)' }}>{initials(client.name)}</div>
          <div><div className="font-serif text-3xl font-light" style={{ color: '#F0EDE8' }}>{client.name}</div></div>
        </div>
        <div className="flex py-5 gap-0">
          {[
            { label: 'Monthly Savings Needed', val: fmtMo(totalMonthly), color: '#C4A464' },
            { label: 'Years to Retirement', val: retGoal ? String((retGoal.ret_age || 65) - (client.age || 35)) : '—', color: '#F0EDE8' },
            { label: 'Monthly Gap', val: gap > 0 ? `−${fmtMo(gap)}` : 'On track', color: gap > 0 ? '#E08080' : '#80C4A0' },
            { label: 'Planning Status', val: `${doneCount} / ${checklist.length}`, color: '#F0EDE8' },
          ].map((s, i) => (
            <div key={i} className="flex-1" style={{ paddingRight: 28, borderRight: i < 3 ? '1px solid rgba(255,255,255,0.06)' : 'none', marginRight: i < 3 ? 28 : 0 }}>
              <div className="text-xs tracking-widest uppercase mb-1.5" style={{ color: 'rgba(255,255,255,0.28)' }}>{s.label}</div>
              <div className="font-serif text-xl font-light" style={{ color: s.color }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: '36px 48px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          <div>
            <div className="text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Family Members</div>
            <div className="font-serif text-xl mb-4">Household Profile</div>
            {family.length === 0 ? <div className="text-sm py-4" style={{ color: 'var(--ink3)', borderTop: '1px solid var(--line)' }}>No family members added yet.</div> : family.map(m => (
              <div key={m.id} className="flex items-center gap-3 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center font-serif text-sm text-white" style={{ background: '#C4A882' }}>{initials(m.name)}</div>
                <div><div className="text-sm font-medium">{m.name}</div><div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>Age {m.age || '?'} - {m.relationship}</div></div>
              </div>
            ))}
          </div>
          <div>
            <div className="text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Planning</div>
            <div className="font-serif text-xl mb-4">Goals Summary</div>
            {goals.map((g, i) => {
              const mo = goalMonthly(g), col = GOAL_COLORS[i % GOAL_COLORS.length]
              return (
                <div key={g.id} className="flex items-center py-3 gap-3" style={{ borderBottom: '1px solid var(--line)' }}>
                  <div className="w-0.5 h-8 rounded" style={{ background: col }} />
                  <div className="flex-1"><div className="text-sm font-medium">{g.name}</div><div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>{g.type}</div></div>
                  <div className="font-serif text-lg" style={{ color: col }}>{fmtMo(mo)}</div>
                </div>
              )
            })}
            {checklist.slice(0, 5).map(item => (
              <div key={item.id} className="flex items-center gap-3 py-2" style={{ borderBottom: '1px solid var(--line)' }}>
                <div className="w-4 h-4 rounded flex items-center justify-center text-xs" style={{ background: item.status === 'done' ? 'var(--emerald-l)' : 'transparent', color: item.status === 'done' ? 'var(--emerald)' : 'var(--line2)', border: '1px solid currentColor' }}>{item.status === 'done' ? '✓' : ''}</div>
                <div className="text-xs">{item.category}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
