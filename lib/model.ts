// PreToken Radar — the value model.
//
// Everything on the board is derived from the sealed snapshot's own figures at run time:
// no protocol name is hardcoded anywhere in this file. The model has four parts.
//
// 1. Classification. Every protocol in the snapshot is sorted into one of three sets:
//    - "live": it already records a token (a CoinGecko id, a symbol, or a market cap), so
//      there is no launch left to price. These are set aside, and they become the peer set
//      the value model is calibrated on.
//    - "aside": it records no token, but it is a wrapped, staked or bridged product of a
//      token that already trades, a centralised exchange's own entry, or a versioned copy
//      of another protocol — again no launch of its own to price.
//    - "candidate": it records no token and is none of the above. These are ranked.
//
// 2. Peer multiples. For each candidate, the base value is its TVL times the median
//    market-cap/TVL multiple of the live protocols in its category. Categories with too
//    few live peers fall back to a coarser family multiple, then to the global median, so
//    every candidate is priced from real traded peers, never from a guess typed by hand.
//
// 3. Adjustments. The base is adjusted by three factors read off the protocol's own
//    record: its seven-day TVL momentum, its maturity (how long DefiLlama has tracked
//    it with no token), and its chain reach (how many chains its TVL sits on).
//
// 4. Validation. The same multiple machinery is run leave-one-out over the live set:
//    each traded protocol's market cap is predicted from its peers alone and compared
//    with the cap it actually trades at. The board publishes the outcome — median error,
//    rank correlation, and the interquartile band that becomes each row's value range —
//    so a reader can see how much the model is worth before trusting a single number.

/** One protocol object, exactly as the snapshot carries it. */
export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot: a date, a source line, the TVL floor, the protocols, the watchlist. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export type ProtocolClass = 'candidate' | 'live' | 'aside';

/** Parse and lightly validate the snapshot text; throws on anything malformed. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  for (const p of raw.protocols) {
    if (typeof p.slug !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error('snapshot: a protocol is missing its slug or tvl_usd');
    }
  }
  return raw;
}

// The set-aside categories are exactly the field guide's own list — no more, no fewer.
// Anything wider would push a watchlist protocol off the board (Saturn, a stablecoin
// wrapper the house keeps, is the standing example), and coverage is not negotiable.
const ASIDE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Why a no-token protocol was set aside, in words a reader can check. Empty for candidates and live protocols. */
export function asideReason(p: Protocol): string {
  if (p.category !== null && ASIDE_CATEGORIES.has(p.category)) {
    return `a ${p.category.toLowerCase()} product: its value rides on a token that already trades, so it has no launch of its own`;
  }
  if (WRAPPED_WORD.test(p.name)) {
    return 'a wrapped or staked product of a token that already trades, not a protocol waiting on its own launch';
  }
  if (VERSION_SUFFIX.test(p.name)) {
    return 'a versioned deployment of a protocol family; the family launch, if any, belongs to the original';
  }
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name === prefix || p.name.startsWith(prefix + ' ')) {
      return 'an entry for a centralised exchange or its own product, not an independent protocol launch';
    }
  }
  return '';
}

/** Sort a protocol into candidate, live or aside from its record alone. */
export function classify(p: Protocol): ProtocolClass {
  if (p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null) return 'live';
  return asideReason(p) === '' ? 'candidate' : 'aside';
}

/** The median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Coarse families used when a category has too few live peers of its own. */
const FAMILY_OF: Record<string, string> = {
  Dexs: 'trading',
  Derivatives: 'trading',
  'Prediction Market': 'trading',
  Options: 'trading',
  Synthetics: 'trading',
  Lending: 'credit',
  CDP: 'credit',
  'CDP Manager': 'credit',
  'Uncollateralized Lending': 'credit',
  Yield: 'yield',
  'Yield Aggregator': 'yield',
  'Risk Curators': 'yield',
  'Onchain Capital Allocator': 'yield',
  'Leveraged Farming': 'yield',
  Farm: 'yield',
  'Liquidity Manager': 'yield',
  Indexes: 'yield',
  'Basis Trading': 'yield',
  'Liquid Staking': 'staking',
  'Liquid Restaking': 'staking',
  Restaking: 'staking',
  'Staking Pool': 'staking',
  RWA: 'real-world',
  'Token Locker': 'infrastructure',
  Launchpad: 'infrastructure',
  Chain: 'infrastructure',
  Payments: 'infrastructure',
  Privacy: 'infrastructure',
  Insurance: 'infrastructure',
  'NFT Marketplace': 'infrastructure',
};

function familyOf(category: string | null): string {
  if (category === null) return 'other';
  return FAMILY_OF[category] ?? 'other';
}

/** A resolved multiple: the number itself, where it came from, and how many peers stand behind it. */
export interface Multiple {
  value: number;
  level: 'category' | 'family' | 'global';
  peers: number;
}

function pushTo(map: Map<string, number[]>, key: string, value: number): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/**
 * The multiple machinery: medians of market-cap/TVL over the live set, resolvable by
 * category, then family, then globally. A peer set built without one protocol is what
 * makes the validation below an honest out-of-sample test.
 */
export class PeerMultiples {
  private readonly byCategory = new Map<string, number[]>();
  private readonly byFamily = new Map<string, number[]>();
  private readonly all: number[] = [];

  constructor(live: Protocol[]) {
    for (const p of live) {
      if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
      const ratio = p.mcap_usd / p.tvl_usd;
      this.all.push(ratio);
      pushTo(this.byCategory, p.category ?? '(uncategorised)', ratio);
      pushTo(this.byFamily, familyOf(p.category), ratio);
    }
  }

  /** How many live protocols carry a usable market cap and TVL. */
  get peerCount(): number {
    return this.all.length;
  }

  /** Resolve the multiple for a category, falling back until at least `minPeers` stand behind it. */
  resolve(category: string | null, minPeers = 4): Multiple {
    const catPeers = this.byCategory.get(category ?? '(uncategorised)') ?? [];
    if (catPeers.length >= minPeers) return { value: median(catPeers), level: 'category', peers: catPeers.length };
    const famPeers = this.byFamily.get(familyOf(category)) ?? [];
    if (famPeers.length >= minPeers) return { value: median(famPeers), level: 'family', peers: famPeers.length };
    return { value: median(this.all), level: 'global', peers: this.all.length };
  }
}

/** Spearman's rank correlation between two equal-length series, in [-1, 1]. */
export function spearman(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const rankOf = (series: number[]): number[] => {
    const order = series.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const ranks = new Array<number>(n);
    for (let r = 0; r < n; r++) ranks[order[r]![1]] = r + 1;
    return ranks;
  };
  const rx = rankOf(xs);
  const ry = rankOf(ys);
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (rx[i]! - ry[i]!) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

/** The outcome of running the model over the live set it was calibrated on, one left out at a time. */
export interface Validation {
  peers: number;
  medianRatio: number;
  medianAbsErrorPct: number;
  spearman: number;
  bandLow: number;
  bandHigh: number;
}

/**
 * Out-of-sample check: predict every live protocol's market cap with the board's full
 * model — its TVL, its peers' multiples (itself excluded), and its own momentum,
 * maturity and reach factors — then compare with the cap it actually trades at.
 * The 25th and 75th percentiles of actual/predicted become the board's value band.
 */
export function validateModel(live: Protocol[], asOf: string): Validation {
  const usable = live.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const ratios: number[] = [];
  const predicted: number[] = [];
  const actual: number[] = [];
  for (const p of usable) {
    const rest = usable.filter((q) => q.slug !== p.slug);
    const multiples = new PeerMultiples(rest);
    const guess = scoreCandidate(p, multiples, { low: 1, high: 1 }, asOf).implied;
    if (guess <= 0) continue;
    ratios.push(p.mcap_usd! / guess);
    predicted.push(guess);
    actual.push(p.mcap_usd!);
  }
  const sorted = [...ratios].sort((a, b) => a - b);
  const pct = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const absErr = ratios.map((r) => Math.abs(Math.log(r)));
  return {
    peers: ratios.length,
    medianRatio: Math.round(median(ratios) * 1000) / 1000,
    medianAbsErrorPct: Math.round((Math.exp(median(absErr)) - 1) * 100),
    spearman: Math.round(spearman(predicted, actual) * 1000) / 1000,
    bandLow: Math.round(pct(0.25) * 100) / 100,
    bandHigh: Math.round(pct(0.75) * 100) / 100,
  };
}

/** Whole days between the day DefiLlama began tracking a protocol and the snapshot date; null when unreported. */
export function ageDays(p: Protocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const from = Date.parse(p.listed_at + 'T00:00:00Z');
  const to = Date.parse(asOf + 'T00:00:00Z');
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/** The three adjustment factors and the implied value they produce for one candidate. */
export interface Scored {
  multiple: Multiple;
  growthFactor: number;
  maturityFactor: number;
  reachFactor: number;
  implied: number;
  bandLowUsd: number;
  bandHighUsd: number;
}

/**
 * Score one candidate. The base is TVL x peer multiple; momentum scales it by up to
 * +36% for a protocol growing 60% in a week and down to 0.82x for one shrinking 30%;
 * maturity pays up to +10% for three-plus years tracked with no token; reach pays up
 * to +12% for TVL spread over nine or more chains. Unreported figures score neutral
 * and are flagged as such on the dashboard, never invented.
 */
export function scoreCandidate(p: Protocol, multiples: PeerMultiples, band: { low: number; high: number }, asOf: string): Scored {
  const multiple = multiples.resolve(p.category);
  const change = p.change_7d === null ? 0 : Math.max(-30, Math.min(60, p.change_7d));
  const growthFactor = 1 + 0.006 * change;
  const age = ageDays(p, asOf);
  const maturityFactor = age === null ? 0.95 : 0.9 + 0.1 * Math.min(1, age / 1095);
  const reachFactor = 1 + 0.015 * Math.min(Math.max(p.chains.length - 1, 0), 8);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple.value * growthFactor * maturityFactor * reachFactor));
  return {
    multiple,
    growthFactor,
    maturityFactor,
    reachFactor,
    implied,
    bandLowUsd: Math.max(1, Math.round(implied * band.low)),
    bandHighUsd: Math.round(implied * band.high),
  };
}

/** A small deterministic hash of a slug, so per-protocol plan details vary without any randomness. */
function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

interface Tier {
  position: number;
  volume: number;
  gas: number;
}

function tierFor(tvl: number, chain: string): Tier {
  const gasBase = chain === 'Ethereum' ? 90 : chain === 'Solana' ? 6 : chain === 'Bitcoin' ? 40 : 18;
  if (tvl >= 1_000_000_000) return { position: 1000, volume: 25000, gas: gasBase };
  if (tvl >= 250_000_000) return { position: 500, volume: 10000, gas: gasBase };
  if (tvl >= 50_000_000) return { position: 250, volume: 5000, gas: gasBase };
  if (tvl >= 10_000_000) return { position: 150, volume: 2500, gas: Math.max(5, Math.round(gasBase / 2)) };
  return { position: 75, volume: 1000, gas: Math.max(4, Math.round(gasBase / 3)) };
}

const money = (n: number): string => '$' + n.toLocaleString('en-US');

/** The core weekly action and the second action for a category, as sentence fragments with amounts filled in. */
function playbook(category: string | null, t: Tier): { core: string; second: string } {
  const pos = money(t.position);
  const vol = money(t.volume);
  switch (category) {
    case 'Dexs':
      return {
        core: `swap ${pos} each way between the two deepest pairs every week, building toward ${vol} of cumulative volume over the plan`,
        second: `add ${pos} of two-sided liquidity to the busiest pair and leave it in range; concentrated ranges earn the fee share points programs usually count`,
      };
    case 'Lending':
      return {
        core: `supply ${pos} as collateral and keep it supplied; borrow no more than 30% against it and repay in full twice during the plan`,
        second: `rotate the supplied asset once mid-plan (for example stablecoin to ETH and back) so both markets record real usage from the wallet`,
      };
    case 'Derivatives':
      return {
        core: `trade perps with ${pos} of margin, opening and closing two small positions a week toward ${vol} of cumulative volume, always with a stop`,
        second: `post the same margin as vault or insurance-fund liquidity if the venue offers it, which most perps points programs weight more than raw volume`,
      };
    case 'CDP':
    case 'CDP Manager':
      return {
        core: `open a vault with ${pos} of collateral and mint the protocol stablecoin at under 50% of the liquidation ratio`,
        second: `hold or deploy the minted stablecoin inside the protocol's own markets instead of selling it, and top the collateral up whenever it drifts`,
      };
    case 'Yield':
    case 'Yield Aggregator':
    case 'Farm':
      return {
        core: `deposit ${pos} into the flagship vault and keep it there; compounding vaults are where points and future allocations are usually measured`,
        second: `split a second ${pos} across two smaller vaults so the wallet shows breadth, and harvest or restake the yield monthly rather than withdrawing`,
      };
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return {
        core: `allocate ${pos} through the largest curator vault on the platform and keep the allocation live for the whole plan`,
        second: `move a quarter of the position to a second curator mid-plan; allocator platforms track distinct curator exposure per wallet`,
      };
    case 'RWA':
      return {
        core: `complete the platform onboarding and subscribe ${pos} to its shortest-duration real-world asset vault`,
        second: `hold the position to one full distribution cycle and reinvest the payout, which is the activity record these platforms can verify`,
      };
    case 'Launchpad':
      return {
        core: `register the wallet, complete every open participation task, and stake or commit ${pos} toward the next sale window`,
        second: `take part in each sale that opens during the plan, even at the minimum ticket; participation history is the usual allocation input`,
      };
    case 'Chain':
      return {
        core: `bridge ${pos} to the chain and use two of its native applications weekly — a swap and a lending deposit — toward ${vol} of on-chain volume`,
        second: `keep a small native-token balance for gas and hold bridged assets on the chain rather than round-tripping them back`,
      };
    case 'Payments':
      return {
        core: `route real payments totalling ${vol} through the protocol across the plan, in at least eight separate transfers`,
        second: `hold an average balance of ${pos} in the account between payments; balance-over-time is the metric payment networks can snapshot`,
      };
    case 'Prediction Market':
      return {
        core: `place small positions on both sides of liquid markets each week, about ${pos} at risk at any time, toward ${vol} of cumulative volume`,
        second: `provide liquidity to one mid-sized market and leave the quotes live; market-making is usually weighted above directional bets`,
      };
    default:
      return {
        core: `deposit or stake ${pos} in the protocol's flagship market and transact with it every week, toward ${vol} of cumulative volume`,
        second: `use a second feature of the protocol at least twice (a different market, chain or product line) so the wallet's history is not one-dimensional`,
      };
  }
}

/**
 * A concrete farm plan for one candidate: five steps, each carrying what it costs and
 * how long it takes. Amounts scale with the protocol's TVL tier and its main chain's
 * gas level; the duration varies deterministically by slug so plans are not clones.
 */
export function farmPlan(p: Protocol): { steps: string[]; weeks: number; budgetUsd: number } {
  const chain = p.chains[0] ?? 'Ethereum';
  const t = tierFor(p.tvl_usd, chain);
  const weeks = 6 + (slugHash(p.slug) % 7);
  const fees = Math.round(t.position * 0.04);
  const budget = t.position + t.gas + fees;
  const book = playbook(p.category, t);
  const steps = [
    `Set up one fresh wallet for this protocol only, fund it with ${money(t.position)} plus about ${money(t.gas)} for gas on ${chain}, and connect it to the protocol's app. Setup cost about ${money(t.gas)}, time about 30 minutes.`,
    `Core position: ${book.core}. First session about 45 minutes; the weekly repeat takes about 10 minutes.`,
    `Second angle: ${book.second}. Budget an extra ${money(fees)} across the plan for swap fees and slippage.`,
    `Hold for ${weeks} weeks, repeating the core action weekly so activity spans ${weeks} distinct weeks. Points and snapshot programs consistently weight duration and regularity over one large day of volume.`,
    `Total budget about ${money(budget)} (position ${money(t.position)}, gas ${money(t.gas)}, fees ${money(fees)}) over ${weeks} weeks. Review monthly; exit if a token is announced with no community allocation, or if TVL falls 40% from your entry week.`,
  ];
  return { steps, weeks, budgetUsd: budget };
}

/** One board row: the gate's five fields plus the evidence behind the number. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  multiple: number;
  multiple_level: string;
  multiple_peers: number;
  growth_factor: number;
  maturity_factor: number;
  reach_factor: number;
  band_low_usd: number;
  band_high_usd: number;
  farm_weeks: number;
  farm_budget_usd: number;
}

/** Everything the dashboard needs that is not a board row. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  counts: { protocols: number; candidates: number; live: number; aside: number; watchlist: number };
  validation: Validation;
  rows: BoardRow[];
  live: { slug: string; name: string; symbol: string | null; category: string | null; tvl_usd: number; mcap_usd: number | null }[];
  aside: { slug: string; name: string; category: string | null; tvl_usd: number; reason: string }[];
}

/** Build the whole radar from a snapshot: classify, calibrate, validate, score, rank. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const watch = new Set(snapshot.watchlist);
  const live: Protocol[] = [];
  const aside: Protocol[] = [];
  const candidates: Protocol[] = [];
  for (const p of snapshot.protocols) {
    const cls = classify(p);
    if (cls === 'live') live.push(p);
    else if (cls === 'aside') aside.push(p);
    else candidates.push(p);
  }
  const usableLive = live.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const validation = validateModel(live, snapshot.as_of);
  const multiples = new PeerMultiples(usableLive);
  const band = { low: validation.bandLow, high: validation.bandHigh };

  const scored = candidates.map((p) => {
    const s = scoreCandidate(p, multiples, band, snapshot.as_of);
    const plan = farmPlan(p);
    return { p, s, plan };
  });
  scored.sort((a, b) => b.s.implied - a.s.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const board: BoardRow[] = [];
  let previous = Number.POSITIVE_INFINITY;
  scored.forEach(({ p, s, plan }, i) => {
    // Ranks must carry strictly descending values: nudge a tie one dollar below the row above.
    const value = Math.max(1, Math.min(s.implied, previous - 1));
    previous = value;
    board.push({
      slug: p.slug,
      name: p.name,
      rank: i + 1,
      implied_value_usd: value,
      farm_steps: plan.steps,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: ageDays(p, snapshot.as_of),
      watchlist: watch.has(p.slug),
      multiple: Math.round(s.multiple.value * 10000) / 10000,
      multiple_level: s.multiple.level,
      multiple_peers: s.multiple.peers,
      growth_factor: Math.round(s.growthFactor * 1000) / 1000,
      maturity_factor: Math.round(s.maturityFactor * 1000) / 1000,
      reach_factor: Math.round(s.reachFactor * 1000) / 1000,
      band_low_usd: s.bandLowUsd,
      band_high_usd: s.bandHighUsd,
      farm_weeks: plan.weeks,
      farm_budget_usd: plan.budgetUsd,
    });
  });

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    counts: {
      protocols: snapshot.protocols.length,
      candidates: candidates.length,
      live: live.length,
      aside: aside.length,
      watchlist: snapshot.watchlist.length,
    },
    validation,
    rows: board,
    live: live
      .map((p) => ({ slug: p.slug, name: p.name, symbol: p.symbol, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd }))
      .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0)),
    aside: aside
      .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: asideReason(p) }))
      .sort((a, b) => b.tvl_usd - a.tvl_usd),
  };
  return { board, radar };
}

/** The dashboard's data file: one assignment the page's script reads. */
export function dataScript(radar: RadarData): string {
  return 'window.RADAR = ' + JSON.stringify(radar) + ';\n';
}

/** A plain-language reason the gate would refuse this board, or null when it passes. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const seen = new Set<string>();
  const validSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  let previous = Number.POSITIVE_INFINITY;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${row.slug}: rank ${row.rank}, expected ${i + 1}`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (!validSlugs.has(row.slug)) return `slug ${row.slug} is not in the snapshot`;
    if (!(row.implied_value_usd > 0) || row.implied_value_usd > 100_000_000_000_000) return `row ${row.slug}: implied value out of range`;
    if (row.implied_value_usd > previous) return `row ${row.slug}: implied value rises as rank ascends`;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug}: ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug}: a farm step is ${len} characters, outside 20..600`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}
