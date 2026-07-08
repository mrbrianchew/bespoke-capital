const CACHE_KEY = 'bespoke_fx_usd_sgd'
const CACHE_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours
const FALLBACK_RATE = 1.35
const FETCH_TIMEOUT_MS = 4000

interface CachedRate { rate: number; fetchedAt: number }

function readCache(): CachedRate | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.rate === 'number' && typeof parsed?.fetchedAt === 'number') return parsed
    return null
  } catch {
    return null // localStorage unavailable (private browsing, etc.) — non-fatal
  }
}

function writeCache(rate: number) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ rate, fetchedAt: Date.now() }))
  } catch {
    // storage unavailable — the rate still gets used for this session, just not cached
  }
}

/**
 * Gets the current USD→SGD rate, used to convert USD-denominated policy
 * sums/premiums to SGD for display and calculations.
 *
 * - Returns a cached rate immediately (no network call) if it's less than
 *   12 hours old — this is a currency conversion aid, not a trading feed,
 *   so a few-hours-old rate is fine and avoids hitting the API on every
 *   page load.
 * - Otherwise fetches from Frankfurter (a free, keyless FX API) with a
 *   4-second timeout, so a slow or unresponsive API can't stall the page.
 * - On any failure (timeout, network error, bad response), falls back to
 *   the last cached rate even if stale, and only falls back to the
 *   hardcoded default (1.35) if there's no cache at all — a slightly
 *   stale real rate is still a better guess than a fixed constant.
 */
export async function getUsdSgdRate(): Promise<number> {
  const cached = readCache()
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.rate

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=SGD', { signal: controller.signal })
    clearTimeout(timeout)
    const data = await res.json()
    const rate = data?.rates?.SGD
    if (typeof rate === 'number' && rate > 0) {
      writeCache(rate)
      return rate
    }
  } catch {
    // network error, timeout, or bad response — fall through to cache/default
  }

  return cached?.rate ?? FALLBACK_RATE
}
