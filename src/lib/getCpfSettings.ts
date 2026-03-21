import { createClient } from "@/lib/supabase"
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
