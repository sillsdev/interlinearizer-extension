This document is for things about which the dev team wants feedback from users or other stakeholders.

As decisions are needed in development, the developer should feel free to make the decision and add section in this document for external engagement. This _ex post facto_ review prevents unnecessary development delays.

If there are two options we want users to choose from, a pr can include a switch at the top of the extension for toggling between the options in demonstration. The switch is to be removed later after a final decision is made. (We are free to do this on the `main` branch until we make our first public release.)

## Topic Template

Description of thing needing decisions.

Explicit questions and/or clear list of options. Use multiple questions as needed: combining distinct factors into a single question leads to incomplete or confusing answers.

List of relevant GitHub issues/prs/commits.

## Draft project, Save / Save As, and Wipe

The Interlinearizer now keeps an always-present **draft** per source project that auto-saves every
edit (so work is never lost), decoupled from the user's saved projects. Editing no longer writes to a
project automatically; instead the user explicitly **Save**s (writes the draft to the active project)
or **Save As**es (new project, or overwrite an existing one). **New** starts an empty draft (a project
is only created on Save As), and **Open** loads a project into the draft as a working copy. Users can
**Wipe** the draft via a single **Wipe…** dialog where they choose the scope — the whole draft or just
the current book. The tab title shows a `●` marker while the draft has unsaved changes (Platform.Bible
exposes no native "unsaved" tab indicator).

Decisions made during development that we'd like reviewed:

1. **Save with no active project.** When nothing has been opened/saved yet, the "Save" menu item opens
   "Save As" (there is no target). Alternative: hide or disable "Save" until there is an active
   project. Current choice: route to Save As.

2. **Discarding unsaved draft changes.** Switching projects (New / Open) while the draft has unsaved
   changes shows a two-button confirm (Discard / Cancel). Should it instead offer a three-way choice
   ("Save As first" / Discard / Cancel) so the in-progress draft can be kept?

3. **"Wipe book" scope.** The Wipe dialog's "Current book" option targets the book currently in view.
   A future option — a picker of the books that have draft analysis — is the likely direction but is
   not yet confirmed; "current book only" is a deliberate interim choice to keep this PR scoped.

4. **Unsaved indicator + Save feedback.** The unsaved state is shown as a `●` appended to the tab
   title. Options: a different glyph, swapping the tab icon to a "modified" badge, and/or whether a
   success toast should appear on Save (currently the only feedback is the marker disappearing).

5. **New dialog fields.** The "New" dialog still collects name/description (retained on the draft to
   prefill Save As) even though no project is created until Save As. Is collecting them at "New" time
   useful, or should they be collected only at Save As?

6. **Active-project indication.** It was previously impossible to tell which saved project the draft
   was working against. The "Select Interlinear Project" list now highlights the active project's row
   (accent border/background) and shows an "Active" badge on it. This is currently the _only_ place
   the active project is surfaced. Alternatives considered: showing the project name in the tab title
   and/or a persistent toolbar label/badge. Should the active project also be shown outside the
   select modal?

7. **Unsaved indicator timing.** The `●` marker now appears as soon as the user starts typing in a
   gloss field, not only after the field loses focus (gloss values are still committed/persisted on
   blur — only the indicator is eager). Is reflecting in-progress typing as "unsaved" the right
   behavior, or should the marker wait until an edit is actually committed?

8. **Wipe and the unsaved indicator.** Wiping the **entire draft** is treated as a clean baseline: it
   clears the `●` marker (the empty draft is not flagged as unsaved) while keeping the active project
   as the Save target, so a subsequent Save still writes the (now empty) draft to it. Wiping the
   **current book** stays flagged as unsaved, since it is a partial edit the user will usually want to
   save. Is this split right, or should both wipes behave the same?

9. **Save As → Overwrite and the target's metadata.** "Save As → Overwrite an existing project"
   replaces that project's analysis with the draft's. The draft's _config_ (analysis languages and
   alignment target) can differ from the chosen project's — e.g. you Open project A (languages
   `[en]`), then Save As → Overwrite project B (languages `[fr]`). We currently push the draft's
   analysis languages and alignment target onto the overwritten project so its declared metadata
   matches the glosses now stored in it, while keeping the project's existing **name and
   description** (overwriting an existing named project keeps its identity). This mirrors how
   Save As → New carries the draft's config into the newly created project. Is this the right split?
   Options to review:
   - Should overwrite also adopt the draft's **name/description** (i.e. fully replace the target),
     or keep the target's identity as it does now?
   - Should overwrite instead be **analysis-only**, leaving the target's languages/target untouched
     (accepting that the stored glosses may then be tagged with languages the project doesn't
     declare)?
   - Should the Overwrite confirmation surface when the draft's languages differ from the target's,
     so the user is aware their language tags are about to change?

10. **Single "Wipe…" menu item with a scope picker.** The two former menu items ("Wipe Current Book…"
    and "Wipe Draft…") were collapsed into one **Wipe…** item that opens a dialog where the user picks
    the scope — current book or entire draft — then confirms. The dialog defaults to "Current book"
    (the less destructive option) and disables that option when no book is loaded. Alternative: keep
    two separate menu items (each a single click, no scope step). Current choice: one menu item plus a
    scope-picker dialog.

11. **In-progress typing guards a project swap.** Switching projects (New / Open) shows the discard
    confirm (item 2) whenever the draft has unsaved changes. This now also fires when a gloss field
    holds **uncommitted** text — the same eager signal that lights the `●` marker (item 7) — not only
    after that text has committed on blur. Previously the guard checked committed changes only, so
    opening or creating a project while mid-typing a gloss discarded that in-progress text silently.
    The two definitions of "unsaved" (the tab marker vs. the discard guard) are now unified, so the
    prompt and the indicator always agree. Is prompting on uncommitted typing the right behavior, or
    should a project swap only guard against changes that have actually committed (accepting that
    mid-typing text is then lost without warning)? Note this is coupled to item 7: if the marker is
    changed to wait until an edit commits, this guard should follow.

## Suggestion engine: editing a shared analysis, and per-instance analyses

The suggestion engine reuses an existing analysis on other matching surface forms by creating a new
**link** to the same analysis payload (not a copy). Because the payload is shared, analyses behave
**globally**: editing the gloss/parse of an analysis updates every token instance linked to it
(the FieldWorks/LCM model — one wordform analysis shared across occurrences).

Decisions made during development that we'd like reviewed:

1. **Confirming a global edit.** Editing an analysis that is linked from more than one token is
   proposed to require an explicit confirmation ("This analysis is used by N tokens — updating it
   changes all of them") so users are never surprised that a single edit rewrote many verses. Is a
   confirmation the right friction, or is it too much for power users? Should it be suppressible
   ("don't ask again")?

2. **Making a per-instance analysis without rigmarole.** Users will sometimes want a _separate_
   analysis for one occurrence of a surface form (a genuine local divergence) rather than editing the
   shared one. The proposal is to offer this directly inside the global-edit confirmation as a second
   button ("Make a separate analysis for just this one"), so forking an instance is one click. Is the
   edit-confirmation modal the right home for this action, or should "fork this instance" be its own
   distinct, always-available control?

3. **Status colors.** Approved = default foreground, suggested = blue, candidate = grey,
   rejected = orange, stale = red (the suggested/candidate colors track Paratext 9). Does this
   mapping read correctly to users, with approved work in the plain foreground and the engine's pick
   subordinate to it in blue?

## Suggestion engine: separating per-token edits from global analysis edits

This revisits the model in "editing a shared analysis, and per-instance analyses" (above). In the
shipped interim, **both** a per-token act and a global edit go through the same gloss input: typing a
new gloss into a token whose analysis is shared rewrites every token linked to that analysis. To keep
that from surprising users, an edit to a shared analysis is intercepted and a confirmation modal asks
"this is used by N tokens — update all of them?" (with a "fork just this one" escape).

The concern with that model: the gloss input cannot express _which_ of two different intents the user
has — "set what _this token_ means" (local) versus "edit _this shared analysis_" (global, affecting
every linked occurrence) — so the confirmation modal exists only to recover that intent after the
keystroke. It is a guardrail bolted onto an input that conflates the two operations.

**Proposed alternative.** Make the two operations distinct controls instead of one input plus a
confirmation:

- The **gloss input stays purely per-token** — typing a gloss or clearing it only ever affects _that_
  token. It never fans out, so no interception or confirmation is needed.
- **Global edit/delete move onto the suggestion dropdown rows.** Each row already _is_ a distinct
  shared analysis from the pool (with its approval frequency known), so a **pencil** (edit this shared
  analysis) and **trash** (delete it from the pool) on a row target an unambiguous payload. The global
  act becomes a deliberate, directly-chosen control rather than a side effect of typing — and the
  per-token confirmation modal can be retired.

Questions for users/stakeholders:

1. **Is this split the right model?** Per-token meaning via the gloss input, global edit/delete via
   dedicated controls on the shared analysis — versus the shipped "one input + confirm-on-fan-out"
   approach. Does separating the two operations read as clearer, or is editing-in-place (with a
   confirmation) the more natural flow for the people doing this work?

2. **Delete semantics on a shared analysis.** Trashing an analysis that N tokens approve — should it
   un-approve all N (they fall back to a suggestion or blank), or should delete be offered only on a
   zero-approval candidate (an analysis nothing currently relies on)? This is the most consequential
   question, since one click could un-analyze many verses.

3. **Where inline edit happens.** Pencil → does the row become editable **in place** (keeping the
   "this is a global analysis" framing), or does it route the analysis back into the token's gloss
   input pre-filled (which risks reintroducing the very local/global ambiguity this is meant to
   remove)?

4. **Discoverability.** Global edit/delete would now live inside the dropdown, which a user must open.
   Is that acceptable, or do approved tokens — which may not surface a populated dropdown today — need
   their own affordance to reach the shared analysis's controls?

## Suggestion engine: bulk acceptance (post-v1)

v1 accepts suggestions strictly one token at a time, to stay honest to the rule that every analysis
requires explicit human review. We anticipate users will want to **bulk-accept a verse's suggestions**
once the feature is in hand.

Questions for users/stakeholders:

1. **Is bulk-accept wanted, and at what scope?** Verse only (small enough to eyeball before
   approving), or also chapter/book? Book-level bulk-accept is effectively mass approval of unreviewed
   suggestions — does that still count as "human review"?

2. **What should bulk-accept require?** e.g. only enabled when the whole unit is visible, a confirmation
   summarizing how many analyses will be approved, or nothing extra.

## Suggestion engine: display prominence and candidate review

Suggestions are shown **always-on**: every token with no approved analysis that matches something in
the pool renders its `suggested` (blue) analysis continuously, derived live as you work.

Questions for users/stakeholders:

1. **Visual prominence of suggestions vs approved work.** A screen can fill with blue suggestions the
   moment a common word is glossed. Suggested (blue) must read as clearly subordinate to approved
   (foreground) so a field of suggestions is never mistaken for finished work. Is color enough, or do
   suggestions also need a weaker treatment (reduced opacity, italic, an icon/affordance)?

2. **Reviewing candidates (homographs).** When a surface form has competing analyses, one shows as
   `suggested` (blue) and the rest are `candidate` (grey) alternatives. How should a reviewer see and
   switch to a candidate — an inline dropdown, a hover/expand list, cycling with a key? How many
   candidates is it reasonable to surface before the list is truncated?

3. **Suggestions with no gloss in the active analysis language.** For multi-language projects, an
   analysis can match and be suggested for its morphemes/POS while its gloss in the _active_ language
   is blank (v1 suggests regardless of language). Is a blank-gloss blue suggestion acceptable, or
   should suggestions be hidden unless they carry a gloss in the active language?

Decisions made during development that we'd like reviewed (the interim treatment shipped behind a
removable **"Show suggestions"** demo toggle in the view-options dropdown, default **on** — flip it off
to A/B the "screen fills with suggestions" concern):

1. **Prominence treatment (question #1).** An un-approved token's empty gloss input shows the
   suggested gloss as **blue italic ghost placeholder text**, so which tokens have a suggestion reads
   at a glance without focus or hover. Focusing the input (clicking it) opens a small **dropdown**
   whose top row is the suggested gloss (blue italic, an "accept" row); clicking it — or pressing
   Enter — approves the analysis. Keeping the suggestion in the placeholder/dropdown rather than the
   committed input, plus the italic + color, keep it subordinate to approved work (plain foreground).
   Is this enough, or is a further weakening (opacity, an icon) wanted?

2. **Candidate review (question #2).** Homograph candidates render as **grey italic "promote" rows**
   in the same focus-triggered dropdown, below the blue suggested row; clicking one (or arrow-keys +
   Enter) approves that candidate. A small **"+" button** inside the input — shown only when a token
   has more than one suggestion — fades in on focus/hover and re-summons the dropdown over
   already-typed text. (This replaced an earlier inline column of stacked accept/promote buttons.)
   The dropdown currently lists **every** glossed candidate (scrollable, no truncation); how many to
   surface before truncating is still open, as are the hover-list / key-cycling alternatives.

3. **Blank-active-language suggestions (question #3).** Interim choice: an individual analysis with
   **no gloss in the active language is skipped** (it would otherwise be an empty dropdown row), but
   the engine **falls through to the highest-ranked matching analysis that _does_ have an
   active-language gloss** — so a blank top pick no longer hides a usable lower-ranked alternative;
   the best glossed match becomes the accept and the rest become candidates. v1 thus surfaces only
   glossed suggestions, but never drops a glossed one behind a blank higher-frequency homograph. Is
   skipping blank matches right, or should a match still surface (for its morphemes/POS) with an
   empty gloss?

4. **Suggestion after clearing an approved gloss.** Deleting an approved gloss commits only on blur,
   so for that brief window the token is still stored as approved. While the field is empty we now
   preview the suggestion the deletion will produce — the pool's best pick derived **as if this
   token's approval were already removed** — in both the ghost placeholder and the dropdown, so what
   shows while clearing matches what re-derives after blur. (Previously the just-cleared field briefly
   offered only the approved payload's _other_ pool alternatives, then snapped to the top pick on
   blur.) The alternative considered was to leave the suggestion blank until the deletion commits. Is
   previewing the post-deletion suggestion right, or should a just-cleared gloss show nothing until
   blur?

Remove the demo toggle (and these affordances' tuning) once the treatment is decided.

## User-defined segment boundaries

Segments were previously fixed to verses (rebuilt from USJ on every load). Users can now define
their own segment boundaries, with no dedicated edit mode:

- The gap between two token groups shows a **merge** control when the gap is a segment boundary
  (combine the two adjacent segments — this appears in the continuous strip, where adjacent
  segments share a row). Merge controls are always visible; a **split** marker (start a new segment
  at the next token) appears only while Alt is held, and a split is committed by Alt-clicking the
  gap.
- In the segment list, an always-visible **merge** button sits between adjacent segment rows.
- Linking a phrase across a verse boundary pulls the adjacent segment's free **edge** token into
  the focused segment (only the immediate adjacent-edge link buttons are active for this).

Boundaries are stored as a delta from the default verse segmentation on the draft and carried to
the project on Save. The only structural rule is contiguity: a segment is a contiguous run of the
book's tokens, so discontiguous segments are unrepresentable and only whole contiguous chunks can
move between adjacent segments.

Decisions made during development that we'd like reviewed:

1. **Merged-segment separator.** When two verses are merged into one segment, their baseline texts
   are joined with a single space. This is reasonable for whitespace-delimited scripts but wrong for
   scriptio continua (Chinese, Thai, …) and for cases where the USFM implied a different break.
   Should the separator be configurable per project/writing system, or derived from the source?

2. **Free translation when merging.** A segment's free translation is keyed by segment id. An
   untouched or merged segment keeps the **leading** verse's id (so its free translation survives);
   the **absorbed** verse's free translation is retained in storage but hidden while merged, and
   reappears if the segments are split back apart. Splitting keeps the first half's free translation
   and starts later halves blank. Is "hide-and-restore" the desired behavior, or should merging
   prompt the user to keep/discard the absorbed verse's translation?

3. **Chapter superscriptions are ordinary segments.** A chapter heading (a `d` descriptive title,
   e.g. a Psalm superscription) is extracted as a synthetic **verse 0** segment that sits in
   document order between the previous chapter's last verse and the new chapter's verse 1. Verse 0
   participates in boundary editing like any other segment: it can be merged into the previous
   chapter's last verse, absorb the verse after it, or be split. This means a user can deliberately
   (or accidentally) fold a Psalm title into verse text; the edit is always reversible by splitting
   the heading back out. Two questions:
   - Is "heading merges like any verse" acceptable, or should merging a superscription warn or be
     prevented? (An earlier build treated verse 0 as a hard wall that no edit could touch; that
     protection was removed in favor of uniform, predictable behavior.)
   - When a heading is merged into a neighbor, its free translation follows the hide-and-restore
     behavior of item 2 — confirm that parallels hold for headings too.

4. **Paratext 9 import: fixed project name and description.** A project imported from Paratext 9
   interlinear data is read-only, and its name and description are not editable; the import stamps
   fixed, localizable values instead (there is at most one such import per source project, and the
   project picker only lists projects for the current source, so the name never needs to
   disambiguate between imports). Proposed wording, to be reviewed: name "Paratext 9 Interlinear";
   description "Imported from this project's Paratext 9 interlinear data. Read-only; synced from
   the Paratext 9 files." Are these the right words, and are there localization concerns with
   stamping the resolved string at import time (the label stays in the language the UI had when the
   import ran, until a sync re-resolves it)?

5. **Paratext 9 import: on-screen wording.** Beyond item 4's project name/description, the import
   UX carries several fixed strings to review: the select-modal button ("Import from Paratext 9"),
   the read-only chip on the import's picker row ("Read-only"), the import modal's progress lines
   ("Importing from Paratext 9..." / "Syncing from Paratext 9..."), the report summary labels
   (languages, books, imported counts, "not imported" with plain-word reasons such as "did not
   match the project's text"), the view header banner ("Imported from Paratext 9 - read-only -
   last synced {date}"), the copy dialog's prefilled name ("Copy of Paratext 9 Interlinear"), and
   the warning shown when a sync cannot refresh ("...couldn't be refreshed; showing the last
   imported data"). Do these read right, and should "Paratext 9" be spelled out or abbreviated
   anywhere?

## First-open offer to convert Paratext 9 interlinear data

When the Interlinearizer is opened on a project for the first time (no draft or projects stored
yet) and the project has convertible Paratext 9 interlinear data (at least one interlinear book
file), a dialog offers the conversion before anything else: "This project has Paratext 9
interlinear data. Would you like to convert it now?" with Yes and No buttons.

- The check for convertible data runs after the tab opens; if it takes more than a moment, a
  "Checking for Paratext 9 interlinear data" dialog shows until it answers.
- Yes runs the conversion; the resulting read-only import is the only project created, and the
  usual import report follows with a single Open (dismissing the report also opens - the user
  already chose to convert, so the report is information on the way in, not a fork).
- No continues into the empty draft exactly as an open does today, and the answer sticks: the
  draft is persisted at that moment, so the offer never repeats for this project. Dismissing the
  dialog (Escape or a click outside) means No.
- Deleting every Interlinearizer project for the source returns it to a blank slate, so the offer
  reappears on the next open.

Decision made in development (2026-08-27); feedback welcome on the wording and on whether No
should be remembered forever, given the conversion stays reachable from the Select Project
dialog's import button.
