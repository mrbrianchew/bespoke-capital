'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const OBJECTIVE_CATEGORIES = [
  { key: 'retirement', label: 'Retirement Planning', icon: '◈', color: '#A8834A', light: '#F5EFE3' },
  { key: 'protection', label: 'Wealth Protection', icon: '◉', color: '#2A5E46', light: '#E8F2ED' },
  { key: 'education', label: 'Education Planning', icon: '◇', color: '#4A7C9E', light: '#E8F0F5' },
  { key: 'estate', label: 'Estate & Legacy', icon: '◆', color: '#7A6AAA', light: '#F0EDF8' },
  { key: 'investment', label: 'Investment Growth', icon: '◑', color: '#6A9A8A', light: '#EAF3F0' },
  { key: 'insurance', label: 'Insurance Review', icon: '◐', color: '#8A5E5E', light: '#F5EAEA' },
]

const PRIORITY_LABELS: Record<string, string> = {
  high: 'High Priority',
  medium: 'Medium Priority',
  low: 'Low',
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  not_started: { label: 'Not Started', color: '#9A9690', bg: 'var(--cream2)' },
  in_progress: { label: 'In Progress', color: '#A8834A', bg: '#F5EFE3' },
  completed: { label: 'Completed', color: '#2A5E46', bg: '#E8F2ED' },
  deferred: { label: 'Deferred', color: '#8A5E5E', bg: '#F5EAEA' },
}

type Objective = {
  id: string
  client_id: string
  category: string
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  status: 'not_started' | 'in_progress' | 'completed' | 'deferred'
  target_date: string
  notes: string
  sort_order: number
}

export default function ObjectivesPage() {
  const [client, setClient] = useState<any>(null)
  const [objectives, setObjectives] = useState<Objective[]>([])
  const [goals, setGoals] = useState<any[]>([])
  const [checklist, setChecklist] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editObj, setEditObj] = useState<Objective | null>(null)
  const [activeFilter, setActiveFilter] = useState<string>('all')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }

    const { data: clients } = await supabase
      .from('clients').select('*').order('created_at', { ascending: false }).limit(1)
    if (!clients?.length) { setLoading(false); return }

    const c = clients[0]; setClient(c)

    const [{ data: objs }, { data: gls }, { data: chk }] = await Promise.all([
      supabase.from('fact_finding').select('*').eq('client_id', c.id).eq('section', 'objectives').single(),
      supabase.from('goals').select('*').eq('client_id', c.id).order('sort_order'),
      supabase.from('planning_checklist').select('*').eq('client_id', c.id),
    ])

    // objectives stored as JSON in fact_finding table under section = 'objectives'
    const stored: Objective[] = objs?.data?.items || []
    setObjectives(stored)
    setGoals(gls || [])
    setChecklist(chk || [])
    setLoading(false)
  }

  async function saveObjectives(updated: Objective[]) {
    if (!client) return
    await supabase.from('fact_finding').upsert({
      client_id: client.id,
      section: 'objectives',
      data: { items: updated },
    })
    setObjectives(updated)
  }

  async function deleteObjective(id: string) {
    if (!confirm('Remove this objective?')) return
    const updated = objectives.filter(o => o.id !== id)
    await saveObjectives(updated)
  }

  async function handleSave(obj: Objective) {
    let updated: Objective[]
    if (editObj) {
      updated = objectives.map(o => o.id === obj.id ? obj : o)
    } else {
      updated = [...objectives, obj]
    }
    await saveObjectives(updated)
    setShowModal(false)
    setEditObj(null)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-sm" style={{ color: 'var(--ink3)' }}>Loading…</div>
    </div>
  )
  if (!client) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-sm" style={{ color: 'var(--ink3)' }}>No client selected.</div>
    </div>
  )

  const filtered = activeFilter === 'all' ? objectives : objectives.filter(o => o.category === activeFilter)
  const highCount = objectives.filter(o => o.priority === 'high').length
  const completedCount = objectives.filter(o => o.status === 'completed').length
  const inProgressCount = objectives.filter(o => o.status === 'in_progress').length

  // derive auto-objectives from goals & checklist
  const derivedSuggestions = getDerivedSuggestions(goals, checklist, objectives)

  return (
    <div className="flex flex-col min-h-full">
      {/* Header band */}
      <div style={{ background: 'var(--charcoal)', padding: '0 48px' }}>
        <div className="flex items-end gap-4 py-8" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex-1">
            <div className="font-serif text-3xl font-light" style={{ color: '#F0EDE8' }}>Strategic Objectives</div>
            <div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {client.name} · {objectives.length} objective{objectives.length !== 1 ? 's' : ''} · {completedCount} completed
            </div>
          </div>
          <button
            onClick={() => { setEditObj(null); setShowModal(true) }}
            className="text-xs px-4 py-1.5"
            style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            + Add Objective
          </button>
        </div>

        {/* Stats row */}
        <div className="flex py-5 gap-0">
          {[
            { label: 'Total Objectives', val: objectives.length || '—', color: '#F0EDE8' },
            { label: 'High Priority', val: highCount || '—', color: highCount > 0 ? '#E08080' : '#F0EDE8' },
            { label: 'In Progress', val: inProgressCount || '—', color: '#C4A464' },
            { label: 'Completed', val: completedCount || '—', color: '#80C4A0' },
            { label: 'Planning Goals', val: goals.length || '—', color: '#F0EDE8' },
          ].map((s, i) => (
            <div key={i} className="flex-1" style={{
              paddingRight: 28,
              borderRight: i < 4 ? '1px solid rgba(255,255,255,0.06)' : 'none',
              marginRight: i < 4 ? 28 : 0
            }}>
              <div className="text-xs tracking-widest uppercase mb-1.5" style={{ color: 'rgba(255,255,255,0.28)' }}>{s.label}</div>
              <div className="font-serif text-xl font-light" style={{ color: s.color }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Category filter tabs */}
      <div style={{ background: 'white', borderBottom: '1px solid var(--line)', padding: '0 48px' }}>
        <div className="flex gap-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {[{ key: 'all', label: 'All', icon: '◎' }, ...OBJECTIVE_CATEGORIES].map(cat => {
            const count = cat.key === 'all' ? objectives.length : objectives.filter(o => o.category === cat.key).length
            const isActive = activeFilter === cat.key
            return (
              <button
                key={cat.key}
                onClick={() => setActiveFilter(cat.key)}
                className="text-xs tracking-widest uppercase px-4 py-4 whitespace-nowrap flex items-center gap-1.5"
                style={{
                  color: isActive ? 'var(--ink)' : 'var(--ink3)',
                  borderBottom: isActive ? '2px solid var(--ink)' : '2px solid transparent',
                  background: 'none',
                }}
              >
                <span style={{ opacity: 0.7 }}>{cat.icon}</span>
                {cat.label}
                {count > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full" style={{
                    background: isActive ? 'var(--ink)' : 'var(--cream2)',
                    color: isActive ? 'white' : 'var(--ink3)',
                    fontSize: 9
                  }}>{count}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Main content */}
      <div style={{ padding: '40px 48px', flex: 1 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 40 }}>

          {/* Objectives list */}
          <div>
            {filtered.length === 0 && derivedSuggestions.length === 0 ? (
              <div style={{ padding: '60px 0', textAlign: 'center' }}>
                <div className="font-serif text-2xl mb-3" style={{ color: 'var(--ink3)' }}>No objectives yet</div>
                <p className="text-sm mb-6" style={{ color: 'var(--ink3)' }}>
                  Define the client's strategic financial objectives to guide the planning process.
                </p>
                <button
                  onClick={() => { setEditObj(null); setShowModal(true) }}
                  className="text-sm px-5 py-2.5 font-medium"
                  style={{ background: 'var(--ink)', color: 'white' }}
                >
                  + Add First Objective
                </button>
              </div>
            ) : (
              <div>
                {/* Manual objectives */}
                {filtered.length > 0 && (
                  <div className="mb-8">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--ink3)' }}>Objectives</div>
                        <div className="font-serif text-xl" style={{ color: 'var(--ink)' }}>
                          {activeFilter === 'all' ? 'All Strategic Objectives' : OBJECTIVE_CATEGORIES.find(c => c.key === activeFilter)?.label}
                        </div>
                      </div>
                      <button
                        onClick={() => { setEditObj(null); setShowModal(true) }}
                        className="text-xs px-3 py-1.5"
                        style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}
                      >
                        + Add
                      </button>
                    </div>

                    <div className="space-y-0">
                      {filtered
                        .sort((a, b) => {
                          const pOrder = { high: 0, medium: 1, low: 2 }
                          return (pOrder[a.priority] || 1) - (pOrder[b.priority] || 1)
                        })
                        .map(obj => {
                          const cat = OBJECTIVE_CATEGORIES.find(c => c.key === obj.category)
                          const st = STATUS_CONFIG[obj.status] || STATUS_CONFIG.not_started
                          return (
                            <div key={obj.id} className="flex gap-4 py-5" style={{ borderBottom: '1px solid var(--line)' }}>
                              {/* Priority indicator */}
                              <div className="flex-shrink-0 mt-0.5">
                                <div className="w-1 rounded" style={{
                                  height: 48,
                                  background: obj.priority === 'high' ? '#E08080' : obj.priority === 'medium' ? '#A8834A' : 'var(--line2)'
                                }} />
                              </div>

                              {/* Icon */}
                              <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center text-base" style={{
                                background: cat?.light || 'var(--cream)',
                                color: cat?.color || 'var(--ink)',
                              }}>
                                {cat?.icon || '◎'}
                              </div>

                              {/* Content */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{obj.title}</span>
                                  <span className="text-xs px-1.5 py-0.5" style={{
                                    background: st.bg,
                                    color: st.color,
                                    fontSize: 10,
                                    letterSpacing: '0.05em'
                                  }}>{st.label}</span>
                                  {obj.priority === 'high' && (
                                    <span className="text-xs px-1.5 py-0.5" style={{
                                      background: '#F5EAEA',
                                      color: '#8A2828',
                                      fontSize: 10,
                                    }}>HIGH</span>
                                  )}
                                </div>
                                <div className="text-xs mb-2" style={{ color: 'var(--ink3)' }}>{obj.description}</div>
                                <div className="flex items-center gap-3">
                                  <span className="text-xs" style={{ color: 'var(--ink3)' }}>
                                    {cat?.label}
                                  </span>
                                  {obj.target_date && (
                                    <>
                                      <span style={{ color: 'var(--line2)' }}>·</span>
                                      <span className="text-xs font-mono" style={{ color: 'var(--ink3)' }}>
                                        Target: {obj.target_date}
                                      </span>
                                    </>
                                  )}
                                </div>
                                {obj.notes && (
                                  <div className="mt-2 text-xs px-3 py-2" style={{ background: 'var(--cream)', color: 'var(--ink2)', borderLeft: '2px solid var(--line2)' }}>
                                    {obj.notes}
                                  </div>
                                )}
                              </div>

                              {/* Actions */}
                              <div className="flex-shrink-0 flex gap-1 items-start pt-0.5">
                                <button
                                  onClick={() => { setEditObj(obj); setShowModal(true) }}
                                  className="text-xs px-2 py-1"
                                  style={{ color: 'var(--ink3)', border: '1px solid var(--line)' }}
                                >Edit</button>
                                <button
                                  onClick={() => deleteObjective(obj.id)}
                                  className="text-xs px-2 py-1"
                                  style={{ color: 'var(--rouge)', border: '1px solid var(--line)' }}
                                >×</button>
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  </div>
                )}

                {/* Derived suggestions */}
                {derivedSuggestions.length > 0 && activeFilter === 'all' && (
                  <div>
                    <div className="mb-4">
                      <div className="text-xs tracking-widest uppercase mb-1" style={{ color: 'var(--ink3)' }}>Suggested</div>
                      <div className="font-serif text-xl" style={{ color: 'var(--ink)' }}>Derived from Planning Data</div>
                    </div>
                    <div className="space-y-0">
                      {derivedSuggestions.map((s, i) => {
                        const cat = OBJECTIVE_CATEGORIES.find(c => c.key === s.category)
                        return (
                          <div key={i} className="flex gap-4 py-4" style={{ borderBottom: '1px solid var(--line)', opacity: 0.7 }}>
                            <div className="flex-shrink-0">
                              <div className="w-1 rounded" style={{ height: 40, background: 'var(--line2)' }} />
                            </div>
                            <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center text-base" style={{
                              background: cat?.light || 'var(--cream)',
                              color: cat?.color || 'var(--ink)',
                            }}>
                              {cat?.icon}
                            </div>
                            <div className="flex-1">
                              <div className="text-sm font-medium mb-0.5" style={{ color: 'var(--ink2)' }}>{s.title}</div>
                              <div className="text-xs" style={{ color: 'var(--ink3)' }}>{s.description}</div>
                            </div>
                            <button
                              onClick={async () => {
                                const newObj: Objective = {
                                  id: crypto.randomUUID(),
                                  client_id: client.id,
                                  category: s.category,
                                  title: s.title,
                                  description: s.description,
                                  priority: s.priority as any,
                                  status: 'not_started',
                                  target_date: '',
                                  notes: '',
                                  sort_order: objectives.length,
                                }
                                await saveObjectives([...objectives, newObj])
                              }}
                              className="flex-shrink-0 text-xs px-3 py-1.5 self-start"
                              style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}
                            >
                              + Add
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right sidebar */}
          <div>
            {/* Progress by category */}
            <div style={{ background: 'white', border: '1px solid var(--line)', marginBottom: 20 }}>
              <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
                <div className="text-xs tracking-widest uppercase mb-0.5" style={{ color: 'var(--ink3)' }}>Overview</div>
                <div className="font-serif text-lg">By Category</div>
              </div>
              <div className="px-5 py-3">
                {OBJECTIVE_CATEGORIES.map(cat => {
                  const catObjs = objectives.filter(o => o.category === cat.key)
                  if (catObjs.length === 0) return null
                  const done = catObjs.filter(o => o.status === 'completed').length
                  const pct = Math.round((done / catObjs.length) * 100)
                  return (
                    <div key={cat.key} className="flex items-center gap-3 py-2.5" style={{ borderBottom: '1px solid var(--line)' }}>
                      <div className="w-5 h-5 flex items-center justify-center text-xs flex-shrink-0" style={{ color: cat.color }}>{cat.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs" style={{ color: 'var(--ink2)' }}>{cat.label}</span>
                          <span className="text-xs font-mono" style={{ color: 'var(--ink3)' }}>{done}/{catObjs.length}</span>
                        </div>
                        <div className="w-full h-0.5 rounded" style={{ background: 'var(--cream2)' }}>
                          <div className="h-0.5 rounded" style={{ width: pct + '%', background: cat.color, transition: 'width 0.5s ease' }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
                {objectives.length === 0 && (
                  <div className="text-xs py-4 text-center" style={{ color: 'var(--ink3)' }}>No objectives added yet</div>
                )}
              </div>
            </div>

            {/* Planning goals link */}
            {goals.length > 0 && (
              <div style={{ background: 'var(--charcoal)', padding: 20, marginBottom: 20 }}>
                <div className="text-xs tracking-widest uppercase mb-2" style={{ color: 'rgba(168,131,74,0.6)' }}>Linked Planning</div>
                <div className="font-serif text-base font-light mb-3" style={{ color: '#F0EDE8' }}>Investment Goals</div>
                {goals.map((g, i) => (
                  <div key={g.id} className="flex items-center gap-2 py-2" style={{ borderTop: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                    <div className="w-1 h-6 rounded flex-shrink-0" style={{ background: '#A8834A' }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs" style={{ color: 'rgba(240,237,232,0.8)' }}>{g.name}</div>
                      <div className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                        {g.type === 'retirement' ? 'Retire at ' + (g.ret_age || 65) : 'By age ' + (g.target_age || '—')}
                      </div>
                    </div>
                    <span className="text-xs px-1.5 py-0.5" style={{ background: 'rgba(168,131,74,0.15)', color: '#C4A464', fontSize: 9 }}>
                      {g.type === 'retirement' ? 'RETIREMENT' : 'GOAL'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Checklist summary */}
            {checklist.length > 0 && (
              <div style={{ border: '1px solid var(--line)', background: 'white' }}>
                <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
                  <div className="text-xs tracking-widest uppercase mb-0.5" style={{ color: 'var(--ink3)' }}>Status</div>
                  <div className="font-serif text-lg">Planning Checklist</div>
                </div>
                <div className="px-5 py-3">
                  {checklist.map((item, i) => (
                    <div key={item.id} className="flex items-center gap-3 py-2.5" style={{ borderBottom: i < checklist.length - 1 ? '1px solid var(--line)' : 'none' }}>
                      <div className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center rounded-full border" style={{
                        borderColor: item.status === 'completed' ? '#2A5E46' : 'var(--line2)',
                        background: item.status === 'completed' ? '#2A5E46' : 'transparent',
                      }}>
                        {item.status === 'completed' && (
                          <svg width="7" height="5" viewBox="0 0 7 5" fill="none">
                            <path d="M1 2.5L2.5 4L6 1" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
                          </svg>
                        )}
                      </div>
                      <span className="text-xs flex-1" style={{ color: item.status === 'completed' ? 'var(--ink3)' : 'var(--ink2)', textDecoration: item.status === 'completed' ? 'line-through' : 'none' }}>
                        {item.category}
                      </span>
                      <span className="text-xs" style={{ color: item.status === 'completed' ? '#2A5E46' : 'var(--ink3)' }}>
                        {item.status === 'completed' ? 'Done' : 'Pending'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Objective Modal */}
      {showModal && (
        <ObjectiveModal
          client={client}
          obj={editObj}
          onClose={() => { setShowModal(false); setEditObj(null) }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

function getDerivedSuggestions(goals: any[], checklist: any[], existing: Objective[]) {
  const suggestions: { category: string; title: string; description: string; priority: string }[] = []
  const existingTitles = existing.map(o => o.title.toLowerCase())

  const retGoal = goals.find(g => g.type === 'retirement')
  if (retGoal && !existingTitles.some(t => t.includes('retire'))) {
    suggestions.push({
      category: 'retirement',
      title: 'Build Retirement Capital Fund',
      description: `Accumulate target corpus by age ${retGoal.ret_age || 65} to sustain income through life expectancy ${retGoal.life_exp || 85}.`,
      priority: 'high',
    })
  }

  const eduGoals = goals.filter(g => g.type !== 'retirement')
  if (eduGoals.length > 0 && !existingTitles.some(t => t.includes('education') || t.includes('goal'))) {
    suggestions.push({
      category: 'education',
      title: 'Fund Education Goal' + (eduGoals.length > 1 ? 's' : ''),
      description: eduGoals.map(g => `${g.name} — $${(g.target_amount || 0).toLocaleString()}`).join(', '),
      priority: 'medium',
    })
  }

  const hasInsurance = checklist.some(c => (c.category || '').toLowerCase().includes('insurance') || (c.category || '').toLowerCase().includes('protection'))
  if (!hasInsurance && !existingTitles.some(t => t.includes('insurance') || t.includes('protection'))) {
    suggestions.push({
      category: 'protection',
      title: 'Review Insurance Coverage',
      description: 'Ensure adequate life, critical illness, and disability coverage for client and family.',
      priority: 'high',
    })
  }

  if (!existingTitles.some(t => t.includes('estate') || t.includes('will') || t.includes('legacy'))) {
    suggestions.push({
      category: 'estate',
      title: 'Estate & Will Planning',
      description: 'Draft or update a will and review nomination of beneficiaries across all policies and accounts.',
      priority: 'medium',
    })
  }

  return suggestions
}

function ObjectiveModal({ client, obj, onClose, onSave }: {
  client: any
  obj: Objective | null
  onClose: () => void
  onSave: (o: Objective) => void
}) {
  const [category, setCategory] = useState(obj?.category || 'retirement')
  const [title, setTitle] = useState(obj?.title || '')
  const [description, setDescription] = useState(obj?.description || '')
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>(obj?.priority || 'medium')
  const [status, setStatus] = useState<string>(obj?.status || 'not_started')
  const [targetDate, setTargetDate] = useState(obj?.target_date || '')
  const [notes, setNotes] = useState(obj?.notes || '')
  const [error, setError] = useState('')

  function save() {
    if (!title.trim()) { setError('Title is required'); return }
    const o: Objective = {
      id: obj?.id || crypto.randomUUID(),
      client_id: client.id,
      category,
      title: title.trim(),
      description: description.trim(),
      priority: priority as any,
      status: status as any,
      target_date: targetDate,
      notes: notes.trim(),
      sort_order: obj?.sort_order ?? 999,
    }
    onSave(o)
  }

  const selStyle = (active: boolean, activeColor = 'var(--ink)') => ({
    background: active ? activeColor : 'var(--cream)',
    color: active ? 'white' : 'var(--ink2)',
    border: '1px solid ' + (active ? activeColor : 'var(--line)'),
    padding: '6px 12px',
    fontSize: 12,
    cursor: 'pointer',
  } as React.CSSProperties)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,24,22,0.6)' }}>
      <div className="w-full max-w-lg overflow-y-auto" style={{ background: 'white', borderRadius: 4, maxHeight: '90vh' }}>
        <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="font-serif text-xl">{obj ? 'Edit Objective' : 'Add Objective'}</div>
          <button onClick={onClose} style={{ color: 'var(--ink3)', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Category */}
          <div>
            <label className="block text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Category</label>
            <div className="grid grid-cols-3 gap-2">
              {OBJECTIVE_CATEGORIES.map(cat => (
                <button key={cat.key} onClick={() => setCategory(cat.key)} style={{
                  background: category === cat.key ? cat.light : 'var(--cream)',
                  color: category === cat.key ? cat.color : 'var(--ink3)',
                  border: '1px solid ' + (category === cat.key ? cat.color + '40' : 'var(--line)'),
                  padding: '8px 10px',
                  fontSize: 11,
                  letterSpacing: '0.03em',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}>
                  <span className="mr-1.5" style={{ opacity: 0.8 }}>{cat.icon}</span>
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Objective Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full px-3 py-2.5 text-sm outline-none"
              style={{ border: '1px solid var(--line)', background: 'var(--cream)' }}
              placeholder="e.g. Build retirement corpus by 65"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 text-sm outline-none resize-none"
              style={{ border: '1px solid var(--line)', background: 'var(--cream)' }}
              placeholder="Brief description of the objective..."
            />
          </div>

          {/* Priority + Status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label className="block text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Priority</label>
              <div className="flex gap-1.5">
                {(['high', 'medium', 'low'] as const).map(p => (
                  <button key={p} onClick={() => setPriority(p)} style={selStyle(priority === p,
                    p === 'high' ? '#8A2828' : p === 'medium' ? '#A8834A' : 'var(--ink3)'
                  )}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="w-full px-3 py-2 text-sm outline-none"
                style={{ border: '1px solid var(--line)', background: 'var(--cream)' }}
              >
                <option value="not_started">Not Started</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="deferred">Deferred</option>
              </select>
            </div>
          </div>

          {/* Target date */}
          <div>
            <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Target Date (optional)</label>
            <input
              type="month"
              value={targetDate}
              onChange={e => setTargetDate(e.target.value)}
              className="w-full px-3 py-2.5 text-sm outline-none"
              style={{ border: '1px solid var(--line)', background: 'var(--cream)' }}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Advisor Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 text-sm outline-none resize-none"
              style={{ border: '1px solid var(--line)', background: 'var(--cream)' }}
              placeholder="Internal notes for this objective..."
            />
          </div>

          {error && (
            <div className="text-sm px-3 py-2" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)' }}>{error}</div>
          )}
        </div>

        <div className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--line)' }}>
          <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}>Cancel</button>
          <button onClick={save} className="px-4 py-2 text-sm font-medium text-white" style={{ background: 'var(--ink)' }}>
            {obj ? 'Update' : 'Save Objective'}
          </button>
        </div>
      </div>
    </div>
  )
}
