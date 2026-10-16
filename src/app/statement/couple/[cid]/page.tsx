import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import CoupleStatementClient from './CoupleStatementClient'

// Server wrapper for /statement/couple/[cid]: only sets the browser-tab / WhatsApp
// preview title ("<firm> — Financial Statement <year>"). Everything else is in
// CoupleStatementClient, which talks to /api/statement/couple/[cid].

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function generateMetadata({ params }: { params: { cid: string } }): Promise<Metadata> {
  let firm: string | null = null
  let year: number | null = null
  if (UUID_RE.test(params.cid)) {
    const { data: stmt } = await supabaseAdmin
      .from('financial_statements').select('client_id, year').eq('couple_id', params.cid).limit(1).maybeSingle()
    year = stmt?.year ?? null
    if (stmt?.client_id) {
      const { data: client } = await supabaseAdmin.from('clients').select('advisor_id').eq('id', stmt.client_id).maybeSingle()
      if (client?.advisor_id) {
        const { data: advisor } = await supabaseAdmin.from('advisors').select('firm').eq('id', client.advisor_id).maybeSingle()
        firm = advisor?.firm || null
      }
    }
  }
  return { title: `${firm || 'Bespoke Capital'} — Financial Statement${year ? ` ${year}` : ''}` }
}

export default function CoupleStatementPage() {
  return <CoupleStatementClient />
}