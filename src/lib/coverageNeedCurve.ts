// Coverage need by age — shared by the Risk Management chart (ProtectionOverview)
// and the Financial Report timeline (protectionSnapshot), so both always agree.
//
// Rule (Brian, Nov 2026):
//   need(age) = max( gross(age) − assets ,  floor + loan still owing at that age )
// • Assets come off in FULL at every age (not as a shrinking percentage).
// • The floor is the "client lost everything" safety amount, so it ignores
//   assets, but any loan still outstanding is added on top of it.
//
// The by-age shape comes from the caller's own per-component model (family
// dependency, loan, education). Each component is anchored to the figure
// saved on Strategic Objectives at today's age, so the first point always
// matches the dial card. Anything saved but not modelled by age (one-off
// income tax, buffers, non-mortgage debts) is held flat while the family
// dependency period lasts.

export interface NeedParts {
  fd: number    // family dependency / living expenses
  mort: number  // loan owing (D/TPD: balance at the person's cover %; CI: instalments in the recovery window)
  edu: number   // education fund still to be funded
}

export interface SavedNeed extends NeedParts {
  gross: number // saved total before assets
}

export function makeNeedAtAge(args: {
  startAge: number
  partsAtAge: (age: number) => NeedParts
  saved: SavedNeed
  assets: number
  floor: number
}): (age: number) => number {
  const { startAge, partsAtAge, saved, assets, floor } = args
  const cur = partsAtAge(startAge)
  const curTotal = cur.fd + cur.mort + cur.edu
  const savedSum = saved.fd + saved.mort + saved.edu

  // Per-component anchors. Legacy records with no saved breakdown fall back to
  // one uniform ratio against the saved gross total.
  const uniform = savedSum <= 0
  const k = (c: number, s: number) => (uniform ? (curTotal > 0 ? saved.gross / curTotal : 0) : c > 0 ? s / c : 0)
  const kFd = k(cur.fd, saved.fd)
  const kMort = k(cur.mort, saved.mort)
  const kEdu = k(cur.edu, saved.edu)

  const modelledAtStart = cur.fd * kFd + cur.mort * kMort + cur.edu * kEdu
  const extras = uniform ? 0 : Math.max(0, saved.gross - modelledAtStart)

  return (age: number) => {
    const c = partsAtAge(age)
    const loan = c.mort * kMort
    const gross = c.fd * kFd + loan + c.edu * kEdu + (c.fd > 0 ? extras : 0)
    const needAfterAssets = Math.max(0, gross - assets)
    return Math.max(needAfterAssets, floor + loan)
  }
}