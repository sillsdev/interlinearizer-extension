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

## User-defined segment boundaries

Segments were previously fixed to verses (rebuilt from USJ on every load). Users can now define
their own segment boundaries: a **Edit segment boundaries** view toggle exposes per-slot **merge**
(combine a segment into the one before it) and **split** (start a new segment at a token) controls,
and linking a phrase across a verse boundary pulls the adjacent segment's **edge** token into the
focused segment (only the immediate adjacent-edge link buttons are active for this). Boundaries are
stored as a delta from the default verse segmentation on the draft and carried to the project on
Save; discontiguous segments are not supported.

Decisions made during development that we'd like reviewed:

1. **Merged-segment separator.** When two verses are merged into one segment, their baseline texts
   are joined with a single space. This is reasonable for whitespace-delimited scripts but wrong for
   scriptio continua (Chinese, Thai, …) and for cases where the USFM implied a different break.
   Should the separator be configurable per project/writing system, or derived from the source?

2. **Split-segment baseline display.** A segment created by splitting a verse currently keeps the
   **whole verse's** baseline text (token offsets unchanged; the invariant holds trivially). In the
   baseline-text display mode this duplicates the verse text under each half. The alternative is to
   trim each half's baseline to just its tokens' span (cleaner, but drops edge whitespace and
   punctuation). Current choice: keep the full-verse baseline for simplicity and safety.

3. **Free translation when merging.** A segment's free translation is keyed by segment id. An
   untouched or merged segment keeps the **leading** verse's id (so its free translation survives);
   the **absorbed** verse's free translation is retained in storage but hidden while merged, and
   reappears if the segments are split back apart. Splitting keeps the first half's free translation
   and starts later halves blank. Is "hide-and-restore" the desired behavior, or should merging
   prompt the user to keep/discard the absorbed verse's translation?

4. **Boundary edits and the unsaved indicator.** Merging/splitting/pulling a boundary marks the
   draft dirty (lighting the tab `●`), exactly like a gloss edit. Confirm this is desired, or whether
   boundary edits should be treated differently from analysis edits.

5. **Boundary editing is a transient mode.** The **Edit segment boundaries** toggle is local UI
   state (off on reload), not a persisted project setting, since it changes what the link slots do
   rather than a display preference. Confirm this is the right treatment.
