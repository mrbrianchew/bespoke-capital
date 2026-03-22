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
  const [editMember, setEditMember] = useState<any>(null)
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

  async function deleteMember(id: string) {
    if (!confirm('Remove this family member?')) return
    await supabase.from('family_members').delete().eq('id', id)
    await load()
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

  const sortedFamily = [...family].sort((a, b) => {
    if (a.relationship === 'Spouse') return -1
    if (b.relationship === 'Spouse') return 1
    return 0
  })

  return (
    <div className="flex flex-col min-h-full">
      <div style={{ background: 'var(--charcoal)', padding: '0 48px' }}>
        <div className="flex items-center gap-4 py-8" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="w-12 h-12 rounded-full flex items-center justify-center font-serif text-lg flex-shrink-0" style={{ background: 'rgba(168,131,74,0.25)', border: '1px solid rgba(168,131,74,0.35)', color: 'rgba(255,255,255,0.7)' }}>{initials(client.name)}</div>
          <div>
            <div className="font-serif text-3xl font-light" style={{ color: '#F0EDE8' }}>{client.name}</div>
            <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {client.gender && <span>{client.gender}</span>}
              {(client.age || client.dob) && <span>Age <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{client.dob ? ageFromDob(client.dob) : client.age}</strong></span>}
              {client.start_year && <span>Investing since {client.start_year}</span>}
            </div>
          </div>
          <button onClick={() => setShowEditClient(true)} className="ml-auto text-xs px-4 py-1.5" style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>Edit Client</button>
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

            {sortedFamily.length === 0 ? (
              <div className="text-sm py-4" style={{ color: 'var(--ink3)', borderTop: '1px solid var(--line)' }}>No family members added yet.</div>
            ) : sortedFamily.map(m => {
              const isSpouse = m.relationship === 'Spouse'
              const isSon = m.relationship === 'Son'
              const isDaughter = m.relationship === 'Daughter'
              const memberAge = m.dob ? ageFromDob(m.dob) : (m.age || '?')

              const SonIcon = () => (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="5" r="3"/><path d="M9 12h6l1 7H8l1-7z"/><path d="M10.5 12l-1 3.5M13.5 12l1 3.5"/>
                </svg>
              )
              const DaughterIcon = () => (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="5" r="3"/><path d="M7 12h10l2 8H5l2-8z"/><path d="M12 12v4"/>
                </svg>
              )

              if (isSpouse) {
                return (
                  <div key={m.id} className="flex items-center gap-3 mb-2 px-3 py-3" style={{ background: 'var(--gold-l)', borderTop: '1px solid rgba(168,131,74,0.2)', borderRight: '1px solid rgba(168,131,74,0.2)', borderBottom: '1px solid rgba(168,131,74,0.2)', borderLeft: '3px solid var(--gold)' }}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center font-serif text-sm flex-shrink-0" style={{ background: 'rgba(168,131,74,0.18)', border: '1px solid rgba(168,131,74,0.3)', color: 'var(--gold-tag)' }}>{initials(m.name)}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{m.name}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(168,131,74,0.15)', color: 'var(--gold-tag)', border: '1px solid rgba(168,131,74,0.25)' }}>Spouse</span>
                        {m.gender && <span className="text-xs" style={{ color: 'var(--ink3)' }}>{m.gender}</span>}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>Age {memberAge}{m.citizenship ? ` · ${m.citizenship}` : ''}</div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => setEditMember(m)} className="text-xs px-2 py-1" style={{ color: 'var(--ink3)', border: '1px solid rgba(168,131,74,0.3)', borderRadius: 4 }}>Edit</button>
                      <button onClick={() => deleteMember(m.id)} className="text-xs px-2 py-1" style={{ color: 'var(--rouge)', border: '1px solid rgba(168,131,74,0.3)', borderRadius: 4 }}>×</button>
                    </div>
                  </div>
                )
              }

              const relColor = isSon ? '#4A7C9E' : isDaughter ? '#7A6AAA' : '#7AA890'
              const relBg    = isSon ? '#E8EDF5' : isDaughter ? '#EEE8F5' : '#E8F2ED'
              const relText  = isSon ? '#3A5A80' : isDaughter ? '#5E4A90' : '#2A5E46'
              const avatarBg = isSon ? '#5A8CAE' : isDaughter ? '#8A7AB0' : '#7AA890'

              return (
                <div key={m.id} className="flex items-center gap-3 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center font-serif text-sm flex-shrink-0 text-white" style={{ background: avatarBg }}>{initials(m.name)}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{m.name}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: relBg, color: relText }}>
                        {isSon && <SonIcon />}{isDaughter && <DaughterIcon />}{m.relationship}
                      </span>
                      {m.gender && <span className="text-xs" style={{ color: 'var(--ink3)' }}>{m.gender}</span>}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>Age {memberAge}{m.citizenship ? ` · ${m.citizenship}` : ''}</div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => setEditMember(m)} className="text-xs px-2 py-1" style={{ color: 'var(--ink3)', border: '1px solid var(--line)' }}>Edit</button>
                    <button onClick={() => deleteMember(m.id)} className="text-xs px-2 py-1" style={{ color: 'var(--rouge)', border: '1px solid var(--line)' }}>×</button>
                  </div>
                </div>
              )
            })}
            <button onClick={() => setShowAddMember(true)} className="mt-3 text-sm px-3 py-1.5" style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}>+ Add Member</button>
          </div>

          <div className="space-y-6">
            <div>
              <div className="flex items-end justify-between mb-4">
                <div>
                  <div className="text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Investment Plan</div>
                  <div className="font-serif text-xl" style={{ color: 'var(--ink)' }}>Goals Summary</div>
                </div>
                <button onClick={() => router.push('/dashboard/goals')} className="text-xs px-3 py-1.5" style={{ color: 'var(--ink3)', border: '1px solid var(--line2)' }}>View all →</button>
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
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{g.name}</span>
                        <span className="text-xs px-1.5 py-0.5 font-medium rounded" style={{ background: col + '18', color: col }}>{g.type === 'retirement' ? 'RETIREMENT' : 'GOAL'}</span>
                      </div>
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

      {showEditClient && <EditClientModal client={client} onClose={() => setShowEditClient(false)} onSaved={async () => { setShowEditClient(false); await load() }} />}
      {showAddMember && <AddMemberModal clientId={client.id} onClose={() => setShowAddMember(false)} onSaved={async () => { setShowAddMember(false); await load() }} />}
      {editMember && <EditMemberModal member={editMember} onClose={() => setEditMember(null)} onSaved={async () => { setEditMember(null); await load() }} />}
    </div>
  )
}

function EditClientModal({ client, onClose, onSaved }: any) {
  const [name, setName] = useState(client.name || '')
  const [gender, setGender] = useState(client.gender || '')
  const [dob, setDob] = useState(client.dob || '')
  const [startYear, setStartYear] = useState(client.start_year || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()
  const derivedAge = dob ? ageFromDob(dob) : null

  async function save() {
    if (!name.trim()) { setError('Name is required'); return }
    setLoading(true)
    const { error: err } = await supabase.from('clients').update({
      name: name.trim(), gender: gender || null, dob: dob || null,
      age: dob ? ageFromDob(dob) : (client.age || null),
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
            <input value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }} placeholder="e.g. John Tan" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Gender</label>
              <select value={gender} onChange={e => setGender(e.target.value)} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}>
                <option value="">—</option><option>Male</option><option>Female</option>
              </select>
            </div>
            <div>
              <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Date of Birth</label>
              <input type="date" value={dob} onChange={e => setDob(e.target.value)} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }} />
              {derivedAge !== null && <div className="text-xs mt-1.5" style={{ color: 'var(--ink3)' }}><span style={{ color: 'var(--gold-tag)', fontWeight: 500 }}>Age {derivedAge}</span> · auto-calculated</div>}
            </div>
          </div>
          <div>
            <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Investing Since (Year)</label>
            <input type="number" value={startYear} onChange={e => setStartYear(e.target.value)} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }} placeholder="e.g. 2018" />
          </div>
          {error && <div className="text-sm px-3 py-2" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)' }}>{error}</div>}
        </div>
        <div className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--line)' }}>
          <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}>Cancel</button>
          <button onClick={save} disabled={loading} className="px-4 py-2 text-sm font-medium text-white" style={{ background: 'var(--ink)' }}>{loading ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  )
}

const RELATIONSHIPS = ['Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Grandfather', 'Grandmother', 'Others']
const CITIZENSHIPS = ['Singapore Citizen', 'Singapore PR', 'Malaysia', 'China', 'India', 'Indonesia', 'Philippines', 'Myanmar', 'Other']

function MemberForm({ data, onChange }: any) {
  const derivedAge = data.dob ? ageFromDob(data.dob) : null
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Full Name</label>
        <input value={data.name} onChange={e => onChange({ ...data, name: e.target.value })} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }} placeholder="e.g. Sarah Tan" />
      </div>
      <div>
        <label className="block text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Relationship</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          {RELATIONSHIPS.map(r => (
            <button key={r} onClick={() => onChange({ ...data, relationship: r })} className="py-1.5 text-xs font-medium" style={{ borderRadius: 4, background: data.relationship === r ? 'var(--ink)' : 'var(--cream)', color: data.relationship === r ? 'white' : 'var(--ink2)', border: `1px solid ${data.relationship === r ? 'var(--ink)' : 'var(--line)'}` }}>{r}</button>
          ))}
        </div>
        {data.relationship === 'Others' && (
          <input value={data.customRelationship || ''} onChange={e => onChange({ ...data, customRelationship: e.target.value })} className="w-full px-3 py-2.5 text-sm outline-none mt-2" style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }} placeholder="e.g. Guardian, In-law…" />
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Gender</label>
          <select value={data.gender} onChange={e => onChange({ ...data, gender: e.target.value })} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}>
            <option value="">—</option><option>Male</option><option>Female</option>
          </select>
        </div>
        <div>
          <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Citizenship</label>
          <select value={data.citizenship} onChange={e => onChange({ ...data, citizenship: e.target.value })} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }}>
            <option value="">—</option>
            {CITIZENSHIPS.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Date of Birth</label>
        <input type="date" value={data.dob} onChange={e => onChange({ ...data, dob: e.target.value })} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', background: 'var(--cream)', color: 'var(--ink)' }} />
        {derivedAge !== null && <div className="text-xs mt-1.5" style={{ color: 'var(--ink3)' }}><span style={{ color: 'var(--gold-tag)', fontWeight: 500 }}>Age {derivedAge}</span> · auto-calculated</div>}
      </div>
    </div>
  )
}

function AddMemberModal({ clientId, onClose, onSaved }: any) {
  const [data, setData] = useState({ name: '', relationship: 'Spouse', customRelationship: '', dob: '', gender: '', citizenship: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  async function save() {
    if (!data.name.trim()) { setError('Name is required'); return }
    if (data.relationship === 'Others' && !data.customRelationship?.trim()) { setError('Please specify the relationship'); return }
    setLoading(true)
    const finalRel = data.relationship === 'Others' ? data.customRelationship.trim() : data.relationship
    const { error: err } = await supabase.from('family_members').insert({
      client_id: clientId, name: data.name.trim(), relationship: finalRel,
      dob: data.dob || null, age: data.dob ? ageFromDob(data.dob) : null,
      gender: data.gender || null, citizenship: data.citizenship || null,
    })
    if (err) { setError(err.message); setLoading(false); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,24,22,0.6)' }}>
      <div className="w-full max-w-md overflow-y-auto" style={{ background: 'white', borderRadius: 8, maxHeight: '90vh' }}>
        <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="font-serif text-xl">Add Family Member</div>
          <button onClick={onClose} style={{ color: 'var(--ink3)', fontSize: 20 }}>×</button>
        </div>
        <div className="px-6 py-5"><MemberForm data={data} onChange={setData} /></div>
        {error && <div className="mx-6 mb-4 text-sm px-3 py-2" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)' }}>{error}</div>}
        <div className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--line)' }}>
          <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}>Cancel</button>
          <button onClick={save} disabled={loading} className="px-4 py-2 text-sm font-medium text-white" style={{ background: 'var(--ink)' }}>{loading ? 'Adding…' : 'Add Member'}</button>
        </div>
      </div>
    </div>
  )
}

function EditMemberModal({ member, onClose, onSaved }: any) {
  const isKnown = RELATIONSHIPS.includes(member.relationship)
  const [data, setData] = useState({
    name: member.name || '',
    relationship: isKnown ? member.relationship : 'Others',
    customRelationship: isKnown ? '' : member.relationship,
    dob: member.dob || '',
    gender: member.gender || '',
    citizenship: member.citizenship || '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  async function save() {
    if (!data.name.trim()) { setError('Name is required'); return }
    if (data.relationship === 'Others' && !data.customRelationship?.trim()) { setError('Please specify the relationship'); return }
    setLoading(true)
    const finalRel = data.relationship === 'Others' ? data.customRelationship.trim() : data.relationship
    const { error: err } = await supabase.from('family_members').update({
      name: data.name.trim(), relationship: finalRel,
      dob: data.dob || null, age: data.dob ? ageFromDob(data.dob) : null,
      gender: data.gender || null, citizenship: data.citizenship || null,
    }).eq('id', member.id)
    if (err) { setError(err.message); setLoading(false); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,24,22,0.6)' }}>
      <div className="w-full max-w-md overflow-y-auto" style={{ background: 'white', borderRadius: 8, maxHeight: '90vh' }}>
        <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="font-serif text-xl">Edit Member</div>
          <button onClick={onClose} style={{ color: 'var(--ink3)', fontSize: 20 }}>×</button>
        </div>
        <div className="px-6 py-5"><MemberForm data={data} onChange={setData} /></div>
        {error && <div className="mx-6 mb-4 text-sm px-3 py-2" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)' }}>{error}</div>}
        <div className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--line)' }}>
          <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}>Cancel</button>
          <button onClick={save} disabled={loading} className="px-4 py-2 text-sm font-medium text-white" style={{ background: 'var(--ink)' }}>{loading ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  )
}