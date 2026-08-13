'use client'
import { STAGES, Stage } from '@/lib/newBusinessAttention'
import NewBusinessCaseExtras from '@/components/NewBusinessCaseExtras'
import NewBusinessCaseDocuments from '@/components/NewBusinessCaseDocuments'
import NewBusinessCaseProducts from '@/components/NewBusinessCaseProducts'
import GmailClaimSearch from '@/components/GmailClaimSearch'
import type { Policy } from '@/components/PolicyModal'

// Shared between the firm-wide Business Dashboard board
// (dashboard/business/new-business) and the per-client Client Servicing
// list (dashboard/servicing/new-business) — same case, same drawer, viewed
// from two different entry points. Extracted here rather than duplicated
// so a change to the drawer (new section, new outcome type, etc.) only
// needs to happen once.

export type CaseParty = 'client' | 'spouse' | 'both'
export type Outcome = 'lost' | 'deferred' | null
export type ProductStatus = 'active' | 'withdrawn' | 'declined_by_insurer' | 'declined_by_client' | 'issued'
// declined_by_insurer/declined_by_client are retired going forward — the
// new `outcome` field below replaces them (outcome='declined' + a
// status_note reason). Left in the DB check constraint untouched so no
// destructive migration was needed; the UI just never writes them again.
export type ProductOutcome = 'accepted' | 'declined' | 'postponed' | null

export interface CaseRow {
  id: string
  advisor_id: string
  client_id: string | null
  prospect_name: string | null
  prospect_contact: string | null
  prospect_email: string | null
  case_party: CaseParty
  spouse_family_member_id: string | null
  case_title: string
  stage: Stage
  stage_changed_at: string
  outcome: Outcome
  outcome_reason: string | null
  outcome_at_stage: string | null
  revisit_date: string | null
  source: string | null
  referred_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ProductRow {
  id: string
  case_id: string
  life_assured_family_member_id: string | null
  life_assured_role: 'self' | 'spouse' | 'child' | 'other'
  life_assured_name: string
  product_type: string | null
  product_name: string | null
  insurer: string | null
  premium: number | null
  premium_frequency: string | null
  status: ProductStatus
  outcome: ProductOutcome
  status_note: string | null
  reference_number: string | null
  linked_policy_id: string | null
  submitted_at: string | null
  issued_at: string | null
  policy_draft: Policy | null
}

export const T = {
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  emerald: 'var(--emerald)', emeraldSoft: 'rgba(45,90,78,.12)',
  rose: 'var(--rouge)', roseSoft: 'rgba(138,40,40,.10)',
  slate: '#5C6B73', slateSoft: 'rgba(92,107,115,.12)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)',
  line: 'var(--line)', cream2: 'var(--cream2)',
}

export const btnSmStyle: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif', fontSize: 12.5, fontWeight: 600, padding: '6px 11px',
  borderRadius: 7, border: `1px solid ${T.line}`, background: '#fff', color: T.text, cursor: 'pointer',
}

// Product status label/color mapping now lives in NewBusinessCaseProducts.tsx
// (which owns the products table since the add/edit/delete rework), kept
// out of here to avoid two copies drifting.

const OUTCOME_REASON_PLACEHOLDER: Record<'lost' | 'deferred', string> = {
  lost: 'Why did this not proceed?',
  deferred: 'What are you waiting on before revisiting?',
}

export default function NewBusinessCaseDrawer({
  row, clientName, spouseName, products, onClose, onMoveStage,
  outcomeDraft, onStartOutcome, onCancelOutcome, onChangeOutcomeDraft, onSubmitOutcome, savingOutcome, onReopen, onDelete,
  onProductAdded, onProductUpdated, onProductDeleted,
}: {
  row: CaseRow
  clientName: string | null
  spouseName: string | null
  products: ProductRow[]
  onClose: () => void
  onMoveStage: (stage: Stage) => void
  outcomeDraft: { type: 'lost' | 'deferred'; reason: string; revisitDate: string } | null
  onStartOutcome: (type: 'lost' | 'deferred') => void
  onCancelOutcome: () => void
  onChangeOutcomeDraft: (d: { type: 'lost' | 'deferred'; reason: string; revisitDate: string }) => void
  onSubmitOutcome: () => void
  savingOutcome: boolean
  onReopen: () => void
  onDelete: () => void
  onProductAdded: (p: ProductRow) => void
  onProductUpdated: (p: ProductRow) => void
  onProductDeleted: (id: string) => void
}) {
  const stageIdx = STAGES.findIndex(s => s.key === row.stage)
  const isProspect = !row.client_id

  // Client + spouse first names only (client/spouse, never children, per
  // Brian's call — matches the Claims dashboard's Gmail search scope).
  // Reference numbers used to be pooled in here from every product on the
  // case; that's moved to a per-product search panel on each product row
  // instead (Aug 2026) — searching one product's correspondence no longer
  // means wading through every other product's matches too.
  const emailSearchTerms = (() => {
    const terms: string[] = []
    const clientFirst = (clientName || row.prospect_name || '').split(' ')[0]
    if (clientFirst) terms.push(clientFirst)
    if (spouseName && (row.case_party === 'spouse' || row.case_party === 'both')) {
      const spouseFirst = spouseName.split(' ')[0]
      if (spouseFirst && spouseFirst !== clientFirst) terms.push(spouseFirst)
    }
    return Array.from(new Set(terms)).slice(0, 5)
  })()

  return (
    <div>
      <div style={{ padding: '26px 32px 20px', borderBottom: `1px solid ${T.line}`, position: 'sticky', top: 0, background: 'var(--cream)', zIndex: 5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="font-serif" style={{ fontSize: 28, fontWeight: 600, color: T.text, margin: '0 0 4px' }}>{row.case_title}</div>
            <div style={{ fontSize: 12.5, color: T.textDim, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span>{clientName || row.prospect_name || 'Unnamed'}</span>
              {row.source && <span style={{ fontFamily: 'DM Mono, monospace' }}>· {row.source}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, fontSize: 22, lineHeight: 1, padding: 2 }}>×</button>
        </div>

        {row.outcome && (
          <div style={{ marginTop: 16, background: row.outcome === 'lost' ? T.roseSoft : T.slateSoft, border: `1px solid ${row.outcome === 'lost' ? 'rgba(138,40,40,.25)' : 'rgba(92,107,115,.25)'}`, borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: row.outcome === 'lost' ? T.rose : T.slate, marginBottom: 3 }}>
              {row.outcome === 'lost' ? 'Marked Lost / Not Proceeded' : 'Deferred'}
              {row.outcome === 'deferred' && row.revisit_date && ` — revisit ${new Date(row.revisit_date).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}`}
            </div>
            {row.outcome_reason && <div style={{ fontSize: 12.5, color: T.textDim }}>{row.outcome_reason}</div>}
            <button onClick={onReopen} style={{ marginTop: 8, ...btnSmStyle }}>Reopen Case</button>
          </div>
        )}

        {!row.outcome && (
          <div style={{ display: 'flex', marginTop: 20, borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.line}` }}>
            {STAGES.map((s, i) => {
              const done = i < stageIdx, current = i === stageIdx
              return (
                <button key={s.key} onClick={() => onMoveStage(s.key)} title={`Move to ${s.label}`}
                  style={{
                    flex: 1, padding: '8px 4px', textAlign: 'center', fontFamily: 'DM Mono, monospace', fontSize: 9, cursor: 'pointer', border: 'none',
                    borderRight: i < STAGES.length - 1 ? `1px solid ${T.line}` : 'none',
                    background: done ? T.emerald : current ? T.gold : '#fff', color: done || current ? '#fff' : T.textFaint,
                    fontWeight: current ? 700 : 400,
                  }}>{s.label}</button>
              )
            })}
          </div>
        )}
      </div>

      <div style={{ padding: '24px 32px 60px' }}>
        {isProspect && !row.outcome && (
          <div style={{ marginBottom: 28, background: T.goldSoft, border: '1px solid rgba(168,131,74,.3)', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 12.5, color: '#6B5225', lineHeight: 1.4 }}>
              <b style={{ display: 'block', marginBottom: 3 }}>Not yet a client record.</b>
              Convert once they agree to proceed, or automatically on first product inception.
            </p>
            <button style={{ ...btnSmStyle, background: T.text, color: 'var(--cream)', whiteSpace: 'nowrap' }} disabled title="Convert-to-client action lands with the case-creation flow">Convert to Client</button>
          </div>
        )}

        <div style={{ marginBottom: 28 }}>
          <NewBusinessCaseProducts
            caseId={row.id}
            clientId={row.client_id}
            clientName={clientName}
            spouseName={spouseName}
            prospectName={row.prospect_name}
            products={products}
            onProductAdded={onProductAdded}
            onProductUpdated={onProductUpdated}
            onProductDeleted={onProductDeleted}
          />
        </div>

        <div style={{ marginBottom: 28 }}>
          <NewBusinessCaseExtras caseId={row.id} />
        </div>

        <div style={{ marginBottom: 28 }}>
          <NewBusinessCaseDocuments caseId={row.id} clientId={row.client_id} />
        </div>

        <div style={{ marginBottom: 28 }}>
          <GmailClaimSearch newBusinessCaseId={row.id} defaultTerms={emailSearchTerms} />
        </div>

        {row.notes && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: T.text, marginBottom: 8 }}>Notes</div>
            <div style={{ fontSize: 12.5, color: T.textDim, background: '#fff', border: `1px solid ${T.line}`, borderRadius: 10, padding: 12 }}>{row.notes}</div>
          </div>
        )}

        {!row.outcome && (
          <div>
            {!outcomeDraft ? (
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => onStartOutcome('deferred')} style={{ ...btnSmStyle, borderColor: T.slate, color: T.slate }}>Mark as Deferred</button>
                <button onClick={() => onStartOutcome('lost')} style={{ ...btnSmStyle, borderColor: T.rose, color: T.rose }}>Mark as Lost / Not Proceeded</button>
              </div>
            ) : (
              <div style={{ background: '#fff', border: `1px solid ${T.line}`, borderRadius: 10, padding: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: T.text, marginBottom: 10 }}>
                  {outcomeDraft.type === 'lost' ? 'Mark as Lost / Not Proceeded' : 'Mark as Deferred'}
                </div>
                <textarea value={outcomeDraft.reason} onChange={e => onChangeOutcomeDraft({ ...outcomeDraft, reason: e.target.value })}
                  placeholder={OUTCOME_REASON_PLACEHOLDER[outcomeDraft.type]}
                  style={{ width: '100%', minHeight: 64, border: `1px solid ${T.line}`, borderRadius: 8, padding: '10px 12px', fontFamily: 'Inter, sans-serif', fontSize: 13, color: T.text, background: 'var(--cream)', marginBottom: 10 }} />
                {outcomeDraft.type === 'deferred' && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.textFaint, marginBottom: 6 }}>Revisit Date <span style={{ textTransform: 'none', fontStyle: 'italic' }}>optional</span></div>
                    <input type="date" value={outcomeDraft.revisitDate} onChange={e => onChangeOutcomeDraft({ ...outcomeDraft, revisitDate: e.target.value })}
                      style={{ border: `1px solid ${T.line}`, borderRadius: 8, padding: '9px 12px', fontFamily: 'Inter, sans-serif', fontSize: 13, color: T.text, background: 'var(--cream)' }} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={onCancelOutcome} style={btnSmStyle}>Cancel</button>
                  <button onClick={onSubmitOutcome} disabled={savingOutcome}
                    style={{ ...btnSmStyle, background: T.text, color: 'var(--cream)', opacity: savingOutcome ? 0.6 : 1 }}>
                    {savingOutcome ? 'Saving…' : 'Confirm'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Delete — separate from Lost/Deferred: those are recoverable
            outcomes (Reopen brings them back), this is permanent. Always
            available, active or not, so a mis-created case can be cleaned
            up regardless of stage. */}
        <div style={{ marginTop: 28, paddingTop: 16, borderTop: `1px solid ${T.line}` }}>
          <button
            onClick={() => { if (window.confirm(`Permanently delete "${row.case_title}"? This removes the case and all its products, meetings, to-dos, and email search history. This cannot be undone.`)) onDelete() }}
            style={{ ...btnSmStyle, border: 'none', background: 'none', color: T.textFaint, padding: '4px 0' }}
          >
            Delete this case
          </button>
        </div>
      </div>
    </div>
  )
}