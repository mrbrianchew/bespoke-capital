import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

export interface UniCostEntry {
  id: string
  label: string
  annual_tuition: number
  annual_living: number
  annual_fees_living: number
  default_duration: number
  notes: string | null
}

export const UNI_COST_DEFAULTS: Record<string, UniCostEntry> = {
  sg_local:     { id: 'sg_local',     label: 'SG Local (NUS / NTU / SMU)', annual_tuition: 10750, annual_living: 12500, annual_fees_living: 23250, default_duration: 4, notes: null },
  sg_private:   { id: 'sg_private',   label: 'SG Private University',       annual_tuition: 20000, annual_living: 12500, annual_fees_living: 32500, default_duration: 3, notes: null },
  overseas_avg: { id: 'overseas_avg', label: 'Overseas — Average',          annual_tuition: 31500, annual_living: 20000, annual_fees_living: 51500, default_duration: 4, notes: null },
  overseas_uk:  { id: 'overseas_uk',  label: 'Overseas — UK',               annual_tuition: 42000, annual_living: 26500, annual_fees_living: 68500, default_duration: 3, notes: null },
  overseas_aus: { id: 'overseas_aus', label: 'Overseas — Australia',        annual_tuition: 29500, annual_living: 21000, annual_fees_living: 50500, default_duration: 4, notes: null },
  overseas_us:  { id: 'overseas_us',  label: 'Overseas — USA',              annual_tuition: 54000, annual_living: 22500, annual_fees_living: 76500, default_duration: 4, notes: null },
  overseas_cn:  { id: 'overseas_cn',  label: 'Overseas — China',            annual_tuition: 15000, annual_living: 12000, annual_fees_living: 27000, default_duration: 4, notes: null },
  overseas_eu:  { id: 'overseas_eu',  label: 'Overseas — Europe',           annual_tuition: 25000, annual_living: 18000, annual_fees_living: 43000, default_duration: 4, notes: null },
}

export function useUniCosts() {
  const [uniCosts, setUniCosts] = useState<Record<string, UniCostEntry>>(UNI_COST_DEFAULTS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('uni_costs')
      .select('id, label, annual_tuition, annual_living, annual_fees_living, default_duration, notes')
      .then(({ data, error }) => {
        if (!error && data && data.length > 0) {
          const map: Record<string, UniCostEntry> = { ...UNI_COST_DEFAULTS }
          for (const row of data) {
            if (row.annual_tuition != null && row.annual_living != null) {
              map[row.id] = {
                ...row,
                annual_fees_living: (row.annual_tuition ?? 0) + (row.annual_living ?? 0),
              } as UniCostEntry
            }
          }
          setUniCosts(map)
        }
        setLoading(false)
      })
  }, [])

  return { uniCosts, loading }
}
