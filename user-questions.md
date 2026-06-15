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
**Wipe** the draft — the whole thing or just the current book. The tab title shows a `●` marker while
the draft has unsaved changes (Platform.Bible exposes no native "unsaved" tab indicator).

Decisions made during development that we'd like reviewed:

1. **Save with no active project.** When nothing has been opened/saved yet, the "Save" menu item opens
   "Save As" (there is no target). Alternative: hide or disable "Save" until there is an active
   project. Current choice: route to Save As.

2. **Discarding unsaved draft changes.** Switching projects (New / Open) while the draft has unsaved
   changes shows a two-button confirm (Discard / Cancel). Should it instead offer a three-way choice
   ("Save As first" / Discard / Cancel) so the in-progress draft can be kept?

3. **"Wipe book" scope.** "Wipe Current Book" targets the book currently in view. Alternative: present
   a picker of books that have draft analysis. Current choice: current book only.

4. **Unsaved indicator + Save feedback.** The unsaved state is shown as a `●` appended to the tab
   title. Options: a different glyph, swapping the tab icon to a "modified" badge, and/or whether a
   success toast should appear on Save (currently the only feedback is the marker disappearing).

5. **New dialog fields.** The "New" dialog still collects name/description (retained on the draft to
   prefill Save As) even though no project is created until Save As. Is collecting them at "New" time
   useful, or should they be collected only at Save As?
