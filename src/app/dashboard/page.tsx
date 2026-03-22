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
  const [showEditClient, setShowEditClient] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
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
          <button
            onClick={() => setShowEditClient(true)}
            className="ml-auto text-xs px-4 py-1.5"
            style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}
          >Edit Client</button>
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
            <button
              onClick={() => setShowAddMember(true)}
              className="mt-3 text-sm px-3 py-1.5"
              style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}
            >+ Add Member</button>
          </div>

          <div className="space-y-6">
            <div>
              <div className="flex items-end justify-between mb-4">
                <div>
                  <div className="text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Investment Plan</div>
                  <div className="font-serif text-xl" style={{ color: 'var(--ink)' }}>Goals Summary</div>
                </div>
                <button
                  onClick={() => router.push('/dashboard/goals')}
                  className="text-xs px-3 py-1.5"
                  style={{ color: 'var(--ink3)', border: '1px solid var(--line2)' }}
                >View all →</button>
              </div>
              {goals.length === 0 ? (
                <div className="text-sm py-4" style={{ color: 'var(--ink3)', borderTop: '1px solid var(--line)' }}>No goals yet. Add goals in the Investment Goals tab.</div>
              ) : goals.map((g, i) => {
                const mo = goalMonthly(g)
                const col = GOAL_COLORS[i % GOAL_COLORS.length]
                const meta = g.type === 'retirement'
                  ? fmt(retirementCorpus(g.monthly_income || 0, client.age || 35, g.ret_age || 65, g.life_exp || 85, g.inflation_rate || globalInf, g.post_rate || 3, g.legacy_amt || 0, g.cont_inv || false)) + ' by age ' + (g.ret_age || 65)
                  : fmt(g.target_amount || 0) + ' by age ' + (g.target_age || 65)
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

      {showEditClient && (
        <EditClientModal
          client={client}
          onClose={() => setShowEditClient(false)}
          onSaved={async () => { setShowEditClient(false); await load() }}
        />
      )}
      {showAddMember && (
        <AddMemberModal
          clientId={client.id}
          onClose={() => setShowAddMember(false)}
          onSaved={async () => { setShowAddMember(false); await load() }}
        />
      )}
    </div>
  )
}

function EditClientModal({ client, onClose, onSaved }: any) {
  const [name, setName] = useState(client.name || '')
  const [gender, setGender] = useState(client.gender || '')
  const [age, setAge] = useState(client.age || '')
  const [startYear, setStartYear] = useState(client.start_year || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  async function save() {
    if (!name.trim()) { setError('Name is required'); return }
    setLoading(true)
    const { error: err } = await supabase.from('clients').update({
      name: name.trim(),
      gender: gender || null,
      age: parseInt(String(age)) || null,
      start_year: parseInt(String(startYear)) || null,
    }).eq('id', client.id)
    if (err) { setError(err.message); setLoading(false); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,24,22,0.6)' }}>
      <div className="w-full max-w-md" style={{ background: 'white', borderRadius: 8 }}>
        <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="font-serif text-xl">Edit Client</div>
          <button onClick={onClose} style={{ color: 'var(--ink3)', fontSize: 20 }}>×</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Full Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2.5 text-sm outline-none"
              style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}
              placeholder="e.g. John Tan"
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Gender</label>
              <select
                value={gender}
                onChange={e => setGender(e.target.value)}
                className="w-full px-3 py-2.5 text-sm outline-none"
                style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}
              >
                <option value="">—</option>
                <option>Male</option>
                <option>Female</option>
              </select>
            </div>
            <div>
              <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Age</label>
              <input
                type="number"
                value={age}
                onChange={e => setAge(e.target.value)}
                className="w-full px-3 py-2.5 text-sm outline-none"
                style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}
                placeholder="e.g. 42"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Investing Since (Year)</label>
            <input
              type="number"
              value={startYear}
              onChange={e => setStartYear(e.target.value)}
              className="w-full px-3 py-2.5 text-sm outline-none"
              style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}
              placeholder="e.g. 2018"
            />
          </div>
          {error && <div className="text-sm px-3 py-2" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)' }}>{error}</div>}
        </div>
        <div className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--line)' }}>
          <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}>Cancel</button>
          <button onClick={save} disabled={loading} className="px-4 py-2 text-sm font-medium text-white" style={{ background: 'var(--ink)' }}>
            {loading ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AddMemberModal({ clientId, onClose, onSaved }: any) {
  const [name, setName] = useState('')
  const [relationship, setRelationship] = useState('Spouse')
  const [age, setAge] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  async function save() {
    if (!name.trim()) { setError('Name is required'); return }
    setLoading(true)
    const { error: err } = await supabase.from('family_members').insert({
      client_id: clientId,
      name: name.trim(),
      relationship,
      age: parseInt(String(age)) || null,
    })
    if (err) { setError(err.message); setLoading(false); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,24,22,0.6)' }}>
      <div className="w-full max-w-md" style={{ background: 'white', borderRadius: 8 }}>
        <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="font-serif text-xl">Add Family Member</div>
          <button onClick={onClose} style={{ color: 'var(--ink3)', fontSize: 20 }}>×</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Full Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2.5 text-sm outline-none"
              style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}
              placeholder="e.g. Sarah Tan"
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Relationship</label>
              <select
                value={relationship}
                onChange={e => setRelationship(e.target.value)}
                className="w-full px-3 py-2.5 text-sm outline-none"
                style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}
              >
                {['Spouse', 'Child', 'Parent', 'Sibling', 'Other'].map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Age</label>
              <input
                type="number"
                value={age}
                onChange={e => setAge(e.target.value)}
                className="w-full px-3 py-2.5 text-sm outline-none"
                style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}
                placeholder="e.g. 38"
              />
            </div>
          </div>
          {error && <div className="text-sm px-3 py-2" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)' }}>{error}</div>}
        </div>
        <div className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--line)' }}>
          <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}>Cancel</button>
          <button onClick={save} disabled={loading} className="px-4 py-2 text-sm font-medium text-white" style={{ background: 'var(--ink)' }}>
            {loading ? 'Adding…' : 'Add Member'}
          </button>
        </div>
      </div>
    </div>
  )
}
