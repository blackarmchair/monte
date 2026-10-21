<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo_dark.png">
    <img src="logo_light.png" alt="Monte" width="120">
  </picture>
</p>

<h1 align="center">Monte</h1>

<p align="center"><em>A dynasty fantasy football desk for Sleeper leagues.</em></p>

Monte reads your Sleeper leagues, values every roster against TylerFFCreator's dynasty rankings
sheet and the FantasyCalc trade market, and simulates the rest of the season to tell you where
your picks land. It runs as an Electron desktop app (built and used on Windows) and an Expo phone
app (built for Android), both on the same shared core. There is no server: everything runs on your machine or phone.

## What it does

- **League overview.** Every team ranked by total value, starter strength and position, with
  contender tiers, a value-vs-starters map and each roster in detail.
- **Pick odds.** A Monte Carlo of the rest of the season projects the draft order and where each
  of your picks lands, with what-if toggles for next week's matchups.
- **Trades.** Your side valued on Tyler's sheet, theirs on the market at an adjustable blend.
  Verdicts on effective value (one star beats a bundle of the same raw total), a deal finder
  where both sides win, and roster value by position after the trade. The phone app can send the
  offer in Sleeper.
- **Start/Sit.** This week's lineup off Tyler's weekly boards, the best swap, and a win
  probability against your opponent.
- **Usage vs projection (PWOPR).** Who is out-earning or under-earning their role: buy, sell,
  start, fade.
- **Draft.** A live rookie-draft board, pick grades against the sheet, and team grades.
- **Ranks.** Tyler's superflex boards, matched to who rosters each player in your league.
- **Hide names** for sharing screenshots, light and dark themes, and injury overrides that feed
  every model.

## Repository layout

| Path | What it is |
|---|---|
| `src/` | Desktop app: Electron main process, preload, and the React renderer |
| `packages/core/` | Shared data layer: Sleeper and FantasyCalc fetching, screen builders, trade and draft maths, trade proposals |
| `mobile/` | Phone app (Expo / React Native, Expo Router), five tabs. See [mobile/README.md](mobile/README.md) |
| `scripts/` | Parity and smoke checks against the reference tools |
| `resources/` | Desktop app icons |

## Getting started

Monte depends on the [sleeperStandings](https://github.com/blackarmchair/sleeperTool) engine
(pick-odds simulation and PWOPR), checked out **next to** this repo and built:

```
your-folder/
  monte/             ← this repo
  sleeperStandings/  ← git clone https://github.com/blackarmchair/sleeperTool.git sleeperStandings
```

```sh
cd sleeperStandings && npm install && npm run build && cd ..
```

You also need TylerFFCreator's dynasty rankings sheet, downloaded as Excel (.xlsx). It isn't in
this repo.

### Desktop

```sh
cd monte
npm install
npm run dev        # run with hot reload
npm run build      # production build into out/
npm run typecheck
```

On first launch, enter your Sleeper username and point Monte at the rankings .xlsx. Monte
watches the file and reloads when you download a newer copy.

### Mobile

```sh
cd monte/mobile
npm install
npx expo start     # then open in Expo Go (SDK 57)
```

Installing a signed Android build, picking the rankings sheet on the phone, and connecting
Sleeper to send trades are all covered in [mobile/README.md](mobile/README.md).

## Credits

- Rankings: TylerFFCreator's dynasty rankings (Patreon).
- League data: the [Sleeper API](https://docs.sleeper.com/).
- Market values: [FantasyCalc](https://www.fantasycalc.com/).

Monte is a personal project and isn't affiliated with Sleeper, FantasyCalc or TylerFFCreator.
Sending trades uses Sleeper's undocumented API, which can change without notice.
