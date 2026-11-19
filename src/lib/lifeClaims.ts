// Shared types + pure helpers for the Death / TPD / CI claims tracker.
// One LifeClaim = one policy claimed. Used by the per-client Claims page,
// the Business Claims Board and the Portfolio badge, so the wording of
// "who is it waiting on" can never differ between them.

export type LifeClaimType = 'death' | 'tpd' | 'early_ci' | 'advanced_ci'
export type LifeStage = 'with_client' | 'with_insurer' | 'outcome'
export type LifeOutcome = 'approved' | 'partly_approved' | 'declined' | 'withdrawn'

export interface LifeClaim {
  id: string
  client_id: string
  group_id: string | null
  claim_type: LifeClaimType
  life_assured_person: string
  date_notified: string
  event_date: string | null
  cause: string | null
  claimant: string | null
  insurer_ref: string | null
  policy_id: string | null
  policy_company: string | null
  policy_product: string | null
  policy_no: string | null
  stage: LifeStage
  outcome: LifeOutcome | null
  reason: string | null
  rounds: number
  paid_amount: number | null
  paid_date: string | null
  created_at: string
  updated_at: string
}

export interface LifeChecklistItem { id: string; life_claim_id: string; label: string; done: boolean; sort: number }
export interface LifeTodo { id: string; life_claim_id: string; text: string; due_date: string | null; done: boolean; created_at: string }
export interface LifeNote { id: string; life_claim_id: string; text: string; note_date: string; created_at: string }
export interface LifeAttachment {
  id: string; life_claim_id: string; checklist_id: string | null; file_name: string
  drive_file_id: string | null; drive_view_url: string | null; uploaded_at: string
}

export const LIFE_COLUMNS =
  'id, client_id, group_id, claim_type, life_assured_person, date_notified, event_date, cause, claimant, insurer_ref, policy_id, policy_company, policy_product, policy_no, stage, outcome, reason, rounds, paid_amount, paid_date, created_at, updated_at'

export const TYPE_LABEL: Record<LifeClaimType, string> = {
  death: 'Death', tpd: 'TPD', early_ci: 'Early CI', advanced_ci: 'Advanced CI',
}
export const STAGE_LABEL: Record<LifeStage, string> = {
  with_client: 'With client', with_insurer: 'With insurer', outcome: 'Outcome',
}
export const OUTCOME_LABEL: Record<LifeOutcome, string> = {
  approved: 'Approved', partly_approved: 'Partly approved', declined: 'Declined', withdrawn: 'Withdrawn',
}

export const DEFAULT_CHECKLIST: Record<LifeClaimType, string[]> = {
  death: ['Death certificate', 'Insurer claim form', 'Claimant NRIC copy', 'Policy documents', 'Grant of probate / letters of administration', 'Nominee / trustee documents'],
  tpd: ['Insurer claim form', "Attending doctor's report", 'Medical reports & test results', 'Employer statement', 'Policy documents'],
  early_ci: ['Insurer claim form', 'Diagnosis report (specialist / histology)', 'Hospital discharge summary', 'Client NRIC copy', 'Policy documents'],
  advanced_ci: ['Insurer claim form', 'Diagnosis report (specialist / histology)', 'Hospital discharge summary', 'Client NRIC copy', 'Policy documents'],
}

export function sgDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
}

export function daysSinceIso(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso)
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

export function isOverdue(due: string | null, done: boolean): boolean {
  if (done || !due) return false
  const d = new Date(due + 'T00:00:00')
  if (isNaN(d.getTime())) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return d.getTime() < today.getTime()
}

export function hasOverdueTodo(todos: LifeTodo[]): boolean {
  return todos.some(t => isOverdue(t.due_date, t.done))
}

export interface WaitInfo {
  kind: 'your_move' | 'client' | 'insurer' | 'none'
  who: string
  line: string
}

// Derived, never stored. docsDone/docsTotal come from the checklist.
export function waitInfo(c: LifeClaim, docsDone: number, docsTotal: number): WaitInfo {
  if (c.stage === 'outcome') return { kind: 'none', who: '', line: '' }
  const again = c.rounds > 0 ? ` · asked again ×${c.rounds}` : ''
  if (c.stage === 'with_insurer') return { kind: 'insurer', who: 'Insurer', line: `Waiting on insurer${again}` }
  if (docsTotal > 0 && docsDone >= docsTotal) {
    return { kind: 'your_move', who: 'You', line: `Your move · all ${docsTotal} documents in` }
  }
  const who = c.claim_type === 'death' ? 'nominee / executor' : 'client'
  return { kind: 'client', who, line: `Waiting on ${who} · ${docsDone} of ${docsTotal} documents in${again}` }
}

export function policyLabel(c: Pick<LifeClaim, 'policy_company' | 'policy_product' | 'policy_no'>): string {
  const name = [c.policy_company, c.policy_product].filter(Boolean).join(' · ') || 'Policy'
  return c.policy_no ? `${name} · ${c.policy_no}` : name
}

// Does an earlier claim concern this policy? Matches on policy id OR on the
// saved policy-number snapshot (policies are JSON and can be deleted + re-added
// with a new id).
export function claimMatchesPolicy(c: LifeClaim, p: { id: string; policyNo?: string }): boolean {
  if (c.policy_id && c.policy_id === p.id) return true
  const a = (c.policy_no || '').trim().toLowerCase()
  const b = (p.policyNo || '').trim().toLowerCase()
  return !!a && !!b && a === b
}

export function isOpen(c: LifeClaim): boolean {
  return c.stage !== 'outcome'
}

// Sidebar / board "needs attention": a to-do is overdue.
export function lifeAttentionIds(todos: LifeTodo[]): string[] {
  const ids: string[] = []
  todos.forEach(t => { if (isOverdue(t.due_date, t.done) && ids.indexOf(t.life_claim_id) === -1) ids.push(t.life_claim_id) })
  return ids
}

export function personLabel(key: string, clientName: string, spouseName?: string): string {
  if (key === 'client') return clientName
  if (key === 'spouse') return spouseName || 'Spouse'
  return 'Dependent'
}
