/**
 * getCpfSettings.ts — src/lib/getCpfSettings.ts
 *
 * Server-side helper that fetches the current CPF ceilings from Supabase.
 * Called by the API route and any server component that needs CPF data.
 * Caches for 1 hour via Next.js fetch cache — so a single DB hit serves
 * all requests until the cache expires or is revalidated on save.
 */

import { createClient } from "@/lib/supabase/server"
import { DEFAULT_CEILINGS, type CpfCeilings } from "@/lib/cpf"

export async function getCpfSettings(): Promise<CpfCeilings> {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("cpf_settings")
      .select("ow_ceiling, aw_ceiling")
      .order("effective_year", { ascending: false })
      .limit(1)
      .single()

    if (error || !data) {
      console.warn("[getCpfSettings] Falling back to defaults:", error?.message)
      return DEFAULT_CEILINGS
    }

    return {
      owCeiling: Number(data.ow_ceiling),
      awCeiling: Number(data.aw_ceiling),
    }
  } catch (err) {
    console.warn("[getCpfSettings] Unexpected error, using defaults:", err)
    return DEFAULT_CEILINGS
  }
}
