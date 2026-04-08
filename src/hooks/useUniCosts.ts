import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

export interface UniCostEntry {
  id: string
  label: string
  annual_fees_living: number
  default_duration: number
  notes: string | null
}

export const UNI_COST_DEFAULTS: Record<string, UniCostEntry> = {
  sg_local:     { id: 'sg_local',     label: 'SG Local (NUS / NTU / SMU)', annual_fees_living: 34000, default_duration: 4, notes: null },
  sg_private:   { id: 'sg_private',   label: 'SG Private University',       annual_fees_living: 42000, default_duration: 3, notes: null },
  overseas_avg: { id: 'overseas_avg', label: 'Overseas — Average',          annual_fees_living: 55000, default_duration: 4, notes: null },
  overseas_uk:  { id: 'overseas_uk',  label: 'Overseas — UK',               annual_fees_living: 72000, default_duration: 3, notes: null },
  overseas_aus: { id: 'overseas_aus', label: 'Overseas — Australia',        annual_fees_living: 65000, default_duration: 4, notes: null },
  overseas_us:  { id: 'overseas_us',  label: 'Overseas — USA',              annual_fees_living: 85000, default_duration: 4, notes: null },
  overseas_cn:  { id: 'overseas_cn',  label: 'Overseas — China',            annual_fees_living: 35000, default_duration: 4, notes: null },
  overseas_eu:  { id: 'overseas_eu',  label: 'Overseas — Europe',           annual_fees_living: 50000, default_duration: 4, notes: null },
}

export function useUniCosts() {
  const [uniCosts, setUniCosts] = useState<Record<string, UniCostEntry>>(UNI_COST_DEFAULTS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('uni_costs')
      .select('id, label, annual_fees_living, default_duration, notes')
      .then(({ data, error }) => {
        if (!error && data && data.length > 0) {
          const map: Record<string, UniCostEntry> = { ...UNI_COST_DEFAULTS }
          for (const row of data) {
            map[row.id] = row as UniCostEntry
          }
          setUniCosts(map)
        }
        setLoading(false)
      })
  }, [])

  return { uniCosts, loading }
}
