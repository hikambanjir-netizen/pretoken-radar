// PreToken Radar — the page's behaviour. Everything renders from window.RADAR, the
// data file the program writes beside this page's folder: no network, no framework.
// State lives in one object and every control re-renders from it, so the board, the
// filters and the detail view can never disagree with each other.

const R = window.RADAR;
const $ = (id) => document.getElementById(id);

const state = { view: 'board', q: '', cat: '', chain: '', minTvl: 0, sort: 'rank', watchOnly: false, detail: null };

const fmtUsd = (n) => {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n;
};
const fmtFull = (n) => (n === null || n === undefined ? '—' : '$' + n.toLocaleString('en-US'));
const fmtAge = (days) => {
  if (days === null) return 'unreported';
  if (days < 60) return days + 'd';
  if (days < 730) return Math.round(days / 30.4) + ' mo';
  return (days / 365.25).toFixed(1) + ' yrs';
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fillMasthead() {
  const c = R.counts;
  $('mastStats').innerHTML = [
    [c.protocols, 'protocols scanned'],
    [c.candidates, 'pre-token candidates ranked'],
    [c.watchlist + ' / ' + c.watchlist, 'watchlist covered'],
    [c.live, 'already tokenised, set aside'],
    [c.aside, 'wrapped / staked / exchange, set aside'],
  ].map(([n, label]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`).join('');
  $('sourceLine').textContent =
    `Snapshot: ${R.source}. The watchlist floor is ${fmtUsd(R.floor_usd)} of TVL; the board ranks well below it, because the early protocols are the point of a radar.`;
}

function fillMethod() {
  const v = R.validation;
  $('methodText').textContent =
    'Implied value = TVL × peer multiple × momentum × maturity × reach. The peer multiple is the median market-cap/TVL ' +
    'of the protocols in the same category whose tokens already trade (falling back to a wider family, then to all traded ' +
    'protocols, when a category has too few). Momentum reads the protocol\'s own 7-day TVL change, maturity how long it ' +
    'has run with no token, reach how many chains its TVL sits on. No name is priced by hand: change the snapshot and ' +
    'every number on this page moves.';
  $('methodStats').innerHTML =
    `<span>Validated out-of-sample on <b>${v.peers}</b> traded protocols, each priced by the full model from its peers alone</span>` +
    `<span>Median outcome <b>×${v.medianRatio}</b> of prediction</span>` +
    `<span>Rank correlation <b>${v.spearman}</b></span>` +
    `<span>Value band per row: the middle half of that test, <b>×${v.bandLow} – ×${v.bandHigh}</b></span>`;
}

/** The board rows after the current filters, in the current sort. */
function visibleRows() {
  let rows = R.rows.filter((r) =>
    (!state.watchOnly || r.watchlist) &&
    (!state.cat || r.category === state.cat) &&
    (!state.chain || r.chains.includes(state.chain)) &&
    r.tvl_usd >= state.minTvl &&
    (!state.q || (r.name + ' ' + (r.category || '')).toLowerCase().includes(state.q)));
  const by = {
    rank: (a, b) => a.rank - b.rank,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    growth: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
    budget: (a, b) => a.farm_budget_usd - b.farm_budget_usd,
  };
  return rows.sort(by[state.sort]);
}

let maxBandHigh = 1;

function renderBoard() {
  const rows = visibleRows();
  $('rowCount').textContent = rows.length + ' of ' + R.rows.length + ' protocols';
  $('boardBody').innerHTML = rows.map((r) => {
    const chg = r.change_7d === null
      ? '<span class="flat">—</span>'
      : `<span class="${r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : 'flat'}">${r.change_7d > 0 ? '+' : ''}${r.change_7d.toFixed(2)}%</span>`;
    const left = Math.max(0, (r.band_low_usd / maxBandHigh) * 100);
    const width = Math.max(1.5, ((r.band_high_usd - r.band_low_usd) / maxBandHigh) * 100);
    return `<tr data-slug="${esc(r.slug)}" class="${r.watchlist ? 'watchlist-row' : ''}">
      <td class="num">${r.rank}</td>
      <td><span class="proto-name">${esc(r.name)}</span>${r.watchlist ? '<span class="badge">Watchlist</span>' : ''}<br><span class="proto-cat">${esc(r.category || 'Uncategorised')}</span></td>
      <td>${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ' +' + (r.chains.length - 3) : ''}</td>
      <td class="num">${fmtUsd(r.tvl_usd)}</td>
      <td class="num">${chg}</td>
      <td class="num">${fmtAge(r.age_days)}</td>
      <td class="num"><b>${fmtUsd(r.implied_value_usd)}</b></td>
      <td><span class="band-cap">${fmtUsd(r.band_low_usd)} – ${fmtUsd(r.band_high_usd)}</span><div class="band"><div class="band-fill" style="left:${left}%;width:${width}%"></div></div></td>
      <td class="num">${fmtUsd(r.farm_budget_usd)}</td>
      <td class="num">${r.farm_weeks} wks</td>
    </tr>`;
  }).join('');
}

function renderLive() {
  $('liveBody').innerHTML = R.live.map((p) => `<tr data-live="${esc(p.slug)}">
    <td><span class="proto-name">${esc(p.name)}</span></td>
    <td class="mono">${esc(p.symbol || '—')}</td>
    <td>${esc(p.category || 'Uncategorised')}</td>
    <td class="num">${fmtUsd(p.tvl_usd)}</td>
    <td class="num">${fmtUsd(p.mcap_usd)}</td>
    <td class="num">${p.mcap_usd && p.tvl_usd ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : '—'}</td>
  </tr>`).join('');
}

function renderAside() {
  $('asideBody').innerHTML = R.aside.map((p) => `<tr>
    <td><span class="proto-name">${esc(p.name)}</span></td>
    <td>${esc(p.category || 'Uncategorised')}</td>
    <td class="num">${fmtUsd(p.tvl_usd)}</td>
    <td>${esc(p.reason)}</td>
  </tr>`).join('');
}

/** Open the detail drawer for one board row: the full model breakdown and the farm plan. */
function openDetail(slug) {
  const r = R.rows.find((row) => row.slug === slug);
  if (!r) return;
  state.detail = slug;
  const multipleFrom = r.multiple_level === 'category'
    ? `the median of ${r.multiple_peers} traded ${r.category || ''} protocols`
    : r.multiple_level === 'family'
      ? `the median of ${r.multiple_peers} traded protocols in its wider family (its own category has too few traded peers)`
      : `the median of all ${r.multiple_peers} traded protocols (no category or family median stands up)`;
  $('detailBody').innerHTML = `
    <h2>${esc(r.name)}${r.watchlist ? '<span class="badge">Watchlist</span>' : ''}</h2>
    <p class="sub">${esc(r.category || 'Uncategorised')} · records no token in the snapshot of ${esc(R.as_of)} · rank #${r.rank} of ${R.rows.length}</p>
    <div class="big-value">${fmtFull(r.implied_value_usd)}</div>
    <p class="sub">implied launch value · model band ${fmtFull(r.band_low_usd)} – ${fmtFull(r.band_high_usd)}</p>
    <h3>Why this number</h3>
    <dl class="kv">
      <dt>TVL (snapshot)</dt><dd>${fmtFull(r.tvl_usd)}</dd>
      <dt>Peer multiple</dt><dd>×${r.multiple}</dd>
      <dt>Momentum (7d ${r.change_7d === null ? 'unreported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(2) + '%'})</dt><dd>×${r.growth_factor.toFixed(3)}</dd>
      <dt>Maturity (${fmtAge(r.age_days)} with no token)</dt><dd>×${r.maturity_factor.toFixed(3)}</dd>
      <dt>Reach (${r.chains.length} chain${r.chains.length === 1 ? '' : 's'})</dt><dd>×${r.reach_factor.toFixed(3)}</dd>
    </dl>
    <p class="factor-note">The multiple is ${multipleFrom}. The band is the middle half of the model's out-of-sample test: half of traded protocols landed within ×${R.validation.bandLow} – ×${R.validation.bandHigh} of the value this same method predicted for them.</p>
    <h3>The record</h3>
    <dl class="kv">
      <dt>Chains</dt><dd>${esc(r.chains.join(', ') || '—')}</dd>
      <dt>TVL change, 7 days</dt><dd>${r.change_7d === null ? 'unreported' : r.change_7d.toFixed(2) + '%'}</dd>
      <dt>Tracked since</dt><dd>${r.age_days === null ? 'unreported' : fmtAge(r.age_days) + ' ago'}</dd>
    </dl>
    <h3>Farm plan — about ${fmtUsd(r.farm_budget_usd)} over ${r.farm_weeks} weeks</h3>
    <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  $('detail').classList.remove('hidden');
  $('scrim').classList.remove('hidden');
}

function closeDetail() {
  state.detail = null;
  $('detail').classList.add('hidden');
  $('scrim').classList.add('hidden');
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('#viewTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $('boardWrap').classList.toggle('hidden', view !== 'board');
  $('liveWrap').classList.toggle('hidden', view !== 'live');
  $('asideWrap').classList.toggle('hidden', view !== 'aside');
  $('boardControls').classList.toggle('hidden', view !== 'board');
}

function fillFilterOptions() {
  const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
  $('catFilter').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  $('chainFilter').innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');
}

function wire() {
  $('q').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); renderBoard(); });
  $('catFilter').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
  $('chainFilter').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
  $('tvlFilter').addEventListener('change', (e) => { state.minTvl = Number(e.target.value); renderBoard(); });
  $('sortBy').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });
  $('watchOnly').addEventListener('change', (e) => { state.watchOnly = e.target.checked; renderBoard(); });
  $('boardBody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.dataset.slug);
  });
  $('detailClose').addEventListener('click', closeDetail);
  $('scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });
  document.querySelectorAll('#viewTabs .tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
}

/** Deep links: ?view=live, ?cat=Lending&watch=1, ?detail=<slug> — the same state the controls set. */
function applyQuery() {
  const p = new URLSearchParams(location.search);
  if (p.get('cat')) { state.cat = p.get('cat'); $('catFilter').value = state.cat; }
  if (p.get('chain')) { state.chain = p.get('chain'); $('chainFilter').value = state.chain; }
  if (p.get('watch') === '1') { state.watchOnly = true; $('watchOnly').checked = true; }
  if (p.get('sort')) { state.sort = p.get('sort'); $('sortBy').value = state.sort; }
  if (p.get('view')) setView(p.get('view'));
  renderBoard();
  if (p.get('detail')) openDetail(p.get('detail'));
}

maxBandHigh = Math.max(...R.rows.map((r) => r.band_high_usd));
fillMasthead();
fillMethod();
fillFilterOptions();
wire();
applyQuery();
renderLive();
renderAside();
