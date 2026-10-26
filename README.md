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

Both apps share one design (the hybrid "2b" handoff: warm palette, dark first) and the same five
sections: League, Lineup, Trade, Players and Picks, plus a page for every player.

- **League.** Every team ranked by total value, starter strength and record, with contender
  tiers and each roster in detail (a side panel on desktop, its own page on the phone). The phone
  also has the value-vs-starters map.
- **Lineup.** This week's lineup off Tyler's weekly boards, the best swap, a win probability
  against your opponent, and Set in Sleeper.
- **Trade.** Your side valued on Tyler's sheet, theirs on the market at an adjustable blend.
  Verdicts on effective value (one star beats a bundle of the same raw total), deals Monte found
  where both sides win, roster value by position after the trade, and Send in Sleeper.
- **Players.** Tyler's superflex board matched to who rosters each player (Value), and usage vs
  projection, PWOPR (Usage): who is out-earning or under-earning his role.
- **Player.** Sheet against market, this season's games from Sleeper, trade actions, and his
  injury override.
- **Picks.** A Monte Carlo of the rest of the season projects the draft order and where each of
  your picks lands, with what-if picks for next week's matchups; and the rookie draft: a live
  board, pick grades against the sheet, and team grades.
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
npm run dist       # Windows installer: dist/Monte-Setup-<version>.exe
npm run typecheck
```

The installer is unsigned, so Windows SmartScreen asks once (More info → Run anyway). Installing
a newer version over an old one keeps your settings.

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
