// Generic digest email builder. One email, multiple sections — Claims is
// the only section wired in today. When Servicing Pipeline or New Business
// Pipeline ship, they add their own section to the same `sections` array in
// the same scheduled job (see /api/send-digest/route.ts) rather than sending
// a second email. Keep this file free of any claims-specific logic — that
// belongs in the route that builds the sections.

export interface DigestItem {
  label: string   // e.g. client name + context, "Tan Wei Ming · Inpatient / Surgery"
  detail: string   // e.g. the task or reason, "Chase insurer for outstanding invoice"
  badge: string    // e.g. "Overdue · 2d", "Due today", "13d idle"
  badgeColor: 'rose' | 'gold' | 'neutral'
}

export interface DigestSection {
  title: string     // e.g. "Claims"
  items: DigestItem[]
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const BADGE_COLORS: Record<DigestItem['badgeColor'], { bg: string; text: string }> = {
  rose: { bg: '#F5E6E6', text: '#8A2828' },
  gold: { bg: '#F2E9DA', text: '#7A5F35' },
  neutral: { bg: '#EFEBE2', text: '#6B6860' },
}

// Total item count across all sections — used by the caller to decide
// whether there's anything worth emailing about at all.
export function totalDigestItems(sections: DigestSection[]): number {
  return sections.reduce((sum, s) => sum + s.items.length, 0)
}

export function buildDigestHtml(advisorName: string, sections: DigestSection[], appUrl: string): string {
  const nonEmpty = sections.filter(s => s.items.length > 0)
  const sectionsHtml = nonEmpty.map(section => `
    <div style="margin-bottom:28px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#8A8880;margin-bottom:10px;">
        ${escapeHtml(section.title)} · ${section.items.length}
      </div>
      ${section.items.map(item => {
        const c = BADGE_COLORS[item.badgeColor]
        return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #E4E0D4;border-radius:10px;margin-bottom:8px;">
          <tr>
            <td style="padding:12px 14px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:12.5px;font-weight:600;color:#1C1A17;">${escapeHtml(item.label)}</td>
                  <td align="right" style="white-space:nowrap;">
                    <span style="font-size:10.5px;font-weight:700;color:${c.text};background:${c.bg};padding:3px 9px;border-radius:6px;">${escapeHtml(item.badge)}</span>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="font-size:12px;color:#8A8880;padding-top:2px;">${escapeHtml(item.detail)}</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>`
      }).join('')}
    </div>`).join('')

  return `
    <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;background:#F5F3EE;padding:24px;">
      <div style="font-size:9.5px;letter-spacing:1.4px;text-transform:uppercase;color:#A8834A;font-weight:700;">Bespoke Capital</div>
      <div style="font-family:Georgia,serif;font-size:22px;margin-top:4px;color:#1C1A17;">This week's follow-ups</div>
      <div style="font-size:12.5px;color:#8A8880;margin-top:4px;margin-bottom:20px;">Hi ${escapeHtml(advisorName)}, here's what needs attention this week.</div>
      ${sectionsHtml}
      <div style="margin-top:8px;">
        <a href="${appUrl}" style="display:inline-block;font-size:12.5px;font-weight:700;color:#ffffff;background:#1C1A17;padding:9px 16px;border-radius:8px;text-decoration:none;">Open dashboard</a>
      </div>
    </div>
  `
}