# pretoken-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/hikambanjir-netizen/pretoken-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/hikambanjir-netizen/pretoken-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. It reads a sealed snapshot of every protocol DefiLlama tracks (758 protocols, fetched 2026-11-14), works out which ones still record no token, and ranks those by what their launch would be worth — each with a concrete farm plan that states its budget and its duration. The 416 protocols whose tokens already trade are not ranked; they are the peer set the value model is calibrated on. The 144 wrapped, staked, bridged and exchange products that record no token are set aside too, each with its reason stated, because none of them has a launch of its own coming.

## The model

Implied value = TVL × peer multiple × momentum × maturity × reach.

- **Peer multiple** — the median market-cap/TVL of the traded protocols in the same category, falling back to a wider family median, then the global median, when a category has too few traded peers. No protocol is priced by name or by hand.
- **Momentum** — the protocol's own 7-day TVL change, clamped to −30%…+60%, worth up to ×1.36 or down to ×0.82.
- **Maturity** — how long the protocol has been tracked with no token: up to ×1.10 at three years.
- **Reach** — how many chains its TVL sits on: up to ×1.12.

The model is validated out-of-sample before it is trusted: every traded protocol is priced by the full model with itself left out of its peer set, and the prediction is compared with the market cap it actually trades at. On this snapshot (128 usable peers) the median outcome is ×0.959 of the prediction, the rank correlation is 0.425, and the middle half of outcomes land within ×0.25 – ×5.05 of the prediction — that interquartile range is printed on the dashboard as each row's value band, so no implied value is ever shown as more precise than the method is.

## The dashboard

A static page, no network, no framework: the ranked board with search, category and chain filters, a TVL floor, five sort orders and a watchlist toggle; a detail view per protocol showing the full factor breakdown behind its number and its farm plan; a view of the traded peer set with each protocol's actual cap/TVL; and the set-aside view with a reason per protocol.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22, standard library only. The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory, deterministically — two runs over the same snapshot write the same bytes.

---

<sub>Entered on [make.fun](https://make.fun/?ref=dfkzjsa3&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
