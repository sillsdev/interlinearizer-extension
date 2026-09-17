# Morph-type indicator help — mockup

Preliminary exploration for [#130](https://github.com/sillsdev/interlinearizer-extension/issues/130):
somewhere in the morpheme breakdown editor that tells the user what `-`, `=`, `~` and `*` mean.
Nothing here is implemented; the screenshots come from a static page, not the running extension.

Prior art is the FieldWorks **Insert Morpheme Breaks** dialog (`Src/LexText/Interlinear/EditMorphBreaksDlg.resx`),
which shows a "Break Characters" group box with nine patterns and an "Examples" box. The notation
below is FLEx's, verified against a linked project's `MoMorphType` records (see the issue thread).

## Variants

| #   | Placement                            | Screenshots                                                     |
| --- | ------------------------------------ | --------------------------------------------------------------- |
| A   | Expandable section inside the editor | [light](a-inline-expand.png) · [dark](a-inline-expand-dark.png) |
| B   | Hover / focus card off a help icon   | [light](b-hover-card.png) · [dark](b-hover-card-dark.png)       |
| C   | Docked side panel                    | [light](c-side-drawer.png) · [dark](c-side-drawer-dark.png)     |

All three on one page: [all-variants.png](all-variants.png).

**A — expandable section.** A help toggle in the panel header expands the list in place, and the
panel echoes back the type it read from each morpheme as the user types. One floating layer, nothing
to hover-hunt, and the expanded state can persist across opens. Costs vertical space while open.

**B — hover card.** Closest to the "hoverable or clickable help icon" the issue asks for, and the
editor keeps its current size. But it stacks a second floating layer over an already-modal popover,
and a card that dismisses on pointer-out is awkward to consult while typing.

**C — docked panel.** Toggled from the view options, independent of any one token, with room for
every type plus prose, and it stays put across a whole passage. Costs horizontal space in an
already-wide strip and is the most work to build.

The echo row in A ("`un-` prefix · `believe` stem · `-able` suffix") is separable from the placement
question — it could ride along with any of the three, or ship on its own.

## Help icon

A and B use lucide `Info` (circled "i"), bare at 16px in `text-muted-foreground` with no button
background. That follows the platform's two existing help affordances: `platform-scripture`'s
find-filters (`Info`, `h-3.5 w-3.5 text-muted-foreground`) and its marker-settings dialog
(`HelpCircle` in a chrome-less `button` with `text-muted-foreground hover:text-foreground`).

`CircleHelp` was the first draft and read as a smudge at this size — its glyph is a curl and a dot
with no straight strokes. A circled `!` (`CircleAlert`) was the other candidate, but in this
codebase that icon means an error or warning (first-run steps, footnote items, registration form),
so it would misread. Dropping the button's own background was as much of the fix as changing the
glyph.

## Break characters shown

`am` stands for the morpheme form.

| Pattern | Type                   |
| ------- | ---------------------- |
| `am`    | root, stem             |
| `*am`   | bound root, bound stem |
| `am-`   | prefix                 |
| `-am`   | suffix                 |
| `-am-`  | infix                  |
| `am=`   | proclitic              |
| `=am`   | enclitic               |
| `=am=`  | simulfix               |
| `~am~`  | suprafix               |

Clitic, circumfix, particle, phrase and discontiguous phrase take no indicator, so they are not
listed; interfixes reuse the marks of the affix they are shaped like. That is nine rows for nineteen
FLEx types, matching what FieldWorks shows.

Two things the mockup does **not** settle, both raised in the issue: whether PT9's `<om>` or FLEx's
`-om-` is canonical for infixes, and what happens to the twelve FLEx types PT9 cannot express.

## Regenerating

```bash
node docs/mockups/issue-130-morph-type-help/screenshot.mjs
```

Edit `mockup.html` and re-run. Needs `npx playwright install chromium` once.
