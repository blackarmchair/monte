"""Build Monte-Rankings-Template.xlsx: a blank rankings workbook for people without a sheet.

    python scripts/make-template.py [out.xlsx]      (default: dist/Monte-Rankings-Template.xlsx)

It carries only the layout Monte reads (packages/core/src/values.ts findBoards and
startSit.ts readBoards), with the Rank columns numbered and every player cell empty:

- "Dynasty Overall Ranks": a header row of Rank / Player / Pos, twice. Left block: no TE
  premium; right block: TE premium (the banner above each block says which). Monte needs a
  block with at least 150 ranked players, starting at 1.
- Weekly "<POS> Weekly Ranks" tabs: a header row of Rank / <POS> / Matchup, twice, under a
  banner naming the scoring (4pt / 6pt passing TD for QB, Half PPR / PPR otherwise), plus an
  optional injured-players table. The tab names carry no week number, so Monte doesn't warn
  that the boards are for an old week.

The workbook is generated rather than committed (*.xlsx is gitignored) and ships on each
GitHub release beside the installer and the APK.
"""
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / 'dist' / 'Monte-Rankings-Template.xlsx')
DYNASTY_ROWS = 400
WEEKLY_ROWS = {'QB': 40, 'RB': 80, 'WR': 100, 'TE': 50, 'Flex': 150}

BOLD = Font(bold=True)
BANNER = Font(bold=True, size=12)
HEAD_FILL = PatternFill('solid', fgColor='EFE9DF')
MUTED = Font(color='8A8175')


def header(ws, row, col, labels):
    for i, label in enumerate(labels):
        c = ws.cell(row=row, column=col + i, value=label)
        c.font = BOLD
        c.fill = HEAD_FILL


def widths(ws, spec):
    for col, w in spec.items():
        ws.column_dimensions[col].width = w


wb = Workbook()

# ---- Read me ---------------------------------------------------------------------------------
readme = wb.active
readme.title = 'Read me'
lines = [
    ('Monte rankings template', Font(bold=True, size=14)),
    ('', None),
    ('Fill this in with your own rankings, save it as .xlsx, and choose it in Monte (Settings > Rankings sheet).', None),
    ('Monte reloads the file whenever you save it on desktop; on the phone, pick the file again after changes.', None),
    ('', None),
    ('Dynasty Overall Ranks  (required)', BOLD),
    ('  Type player names in rank order. Player = full name as Sleeper spells it; Pos = QB, RB, WR or TE.', None),
    ('  Left block: no TE premium. Right block: TE premium. Fill either or both; Monte uses the TE-premium', None),
    ('  block for values when it has one, and the Rank board setting picks which block player pages show.', None),
    ('  Rank at least 150 players, starting at 1. Values fall off with rank, so order matters most at the top.', None),
    ('', None),
    ('QB / RB / WR / TE / Flex Weekly Ranks  (for Lineup)', BOLD),
    ('  This week\'s start/sit order. Each tab has two scoring columns: QB is 4pt vs 6pt passing TD,', None),
    ('  the others Half PPR vs PPR. Fill the one your league uses (or both). Matchup is optional.', None),
    ('  Leave a player off to mean he should not be started. The injured table on the right is optional.', None),
    ('  Lineup needs the QB, RB, WR and TE tabs filled; Flex is optional.', None),
    ('', None),
    ('Keep the tab layouts as they are: Monte finds each table by its header row (Rank / Player / Pos,', MUTED),
    ('and Rank / <position> / Matchup), not by tab name. Extra tabs are ignored.', MUTED),
]
for i, (text, font) in enumerate(lines, start=1):
    c = readme.cell(row=i, column=1, value=text)
    if font:
        c.font = font
widths(readme, {'A': 110})

# ---- Dynasty board -----------------------------------------------------------------------------
dyn = wb.create_sheet('Dynasty Overall Ranks')
dyn['A1'] = 'Dynasty Rankings (No TE Prem)'
dyn['E1'] = 'Dynasty Rankings (TE Prem)'
dyn['A1'].font = dyn['E1'].font = BANNER
header(dyn, 2, 1, ['Rank', 'Player', 'Pos'])
header(dyn, 2, 5, ['Rank', 'Player', 'Pos'])
for r in range(DYNASTY_ROWS):
    dyn.cell(row=3 + r, column=1, value=r + 1)
    dyn.cell(row=3 + r, column=5, value=r + 1)
widths(dyn, {'A': 7, 'B': 26, 'C': 6, 'D': 3, 'E': 7, 'F': 26, 'G': 6})
dyn.freeze_panes = 'A3'

# ---- Weekly boards -----------------------------------------------------------------------------
for pos, n in WEEKLY_ROWS.items():
    ws = wb.create_sheet(f'{pos} Weekly Ranks')
    left, right = ('4 Point Passing TD Start/Sit', '6 Point Passing TD Start/Sit') if pos == 'QB' else ('Half PPR Start/Sit', 'PPR Start/Sit')
    ws['B1'], ws['D1'] = left, right
    ws['B1'].font = ws['D1'].font = BANNER
    header(ws, 3, 1, ['Rank', pos, 'Matchup', pos, 'Matchup'])
    if pos != 'Flex':
        header(ws, 3, 7, ['Injured/Inactive Players', 'Injury/Reason', 'Game Status'])
    for r in range(n):
        ws.cell(row=4 + r, column=1, value=r + 1)
    widths(ws, {'A': 7, 'B': 24, 'C': 11, 'D': 24, 'E': 11, 'F': 3, 'G': 24, 'H': 16, 'I': 13})
    ws.freeze_panes = 'A4'

for ws in wb.worksheets:
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, int):
                c.alignment = Alignment(horizontal='center')

OUT.parent.mkdir(parents=True, exist_ok=True)
wb.save(OUT)
print(f'wrote {OUT}')
