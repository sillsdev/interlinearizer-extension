# Re-anchoring analyses to shifted text

A token's ref embeds its verse and character offset (`"GEN 1:1:7"`), and a segment's id is derived from its verse. Every analysis link and every custom split boundary joins on these strings, so any edit that shifts offsets re-keys every later token in the verse, and a stored link then names a word it was never written for. This document records how the interlinearizer heals that, and how far it is meant to go.

The implementation is `reanchorAnalysisToBook` in [src/utils/reanchor-analysis.ts](../src/utils/reanchor-analysis.ts), with `reanchorSegmentation` in [src/utils/segmentation.ts](../src/utils/segmentation.ts) applying the same alignment to split boundaries.

## Decision

Refs stay derived from the text, and a re-anchoring pass re-points stored links at the freshly tokenized book. The pass is the contract.

Two alternatives were rejected:

- **Stable synthetic token ids.** Clean identity, but the token layer is rebuilt from USJ on every load and never stored; persisting it would make it a second copy of the text to keep in sync.
- **A persisted journal of token operations** replayed after tokenization. It solves only user-initiated splits and joins, not upstream text edits, and adds a second persisted structure to migrate.

## Target level of effort

**Minimal, on purpose.** The pass recovers insertions, deletions, and the offset shifts they cause. It does not follow a word whose own spelling was edited, and it does not guess between identical words the analysis does not fully cover. A stale link loses nothing: its analysis payload survives, and wherever the same form is approved elsewhere the suggestion engine still offers that gloss. So an honest `'stale'` costs the user little, while a wrong match puts a gloss on the wrong word with no sign that anything happened.

Do not grow this into a general diff, fuzzy matching, or cross-verse tracking. FieldWorks' more ambitious attempts at this are the cautionary example. If a real text edit strands analyses in a way users feel, raise it as an issue before extending the algorithm.

## Algorithm

When it runs: on every book load, in `useReanchorToBook` (`src/components/AnalysisStore.tsx`), for an editable project only. An imported, read-only project is a record of what was imported and is never healed. A pass that moves nothing leaves the analysis identical, so opening a book neither dirties the draft nor writes storage.

Token and phrase links carry a `TokenSnapshot` (`tokenRef` plus the `surfaceText` it was written against). For each verse independently:

1. Collect the snapshots that point into the verse, deduplicated by ref and normalized form, in offset order.
2. If every snapshot's own ref still names a token of the same normalized form, nothing moved; keep them.
3. Otherwise align the stored forms against the verse's current tokens by longest common subsequence, comparing forms through `normalizeSurfaceForm`, so case and Unicode normalization alone never orphan a link. Matching is positional, so the second `"the"` lands on the second surviving `"the"`.
4. Place a form only when the pairing is forced: every stored occurrence found a counterpart, and the verse holds exactly as many of that form as were stored. Otherwise leave it unplaced.

Verses are independent because a token never migrates between verses, and a verse whose own text is untouched must not shift because a neighbor changed.

Outcomes per link:

- **Placed:** the snapshot takes the new ref. A phrase is placed only when every member token is.
- **Unplaced:** the link keeps its old ref, and an `'approved'` link becomes `'stale'`. The record survives for review rather than being dropped or misattached.
- **Revived:** a `'stale'` link that places again returns to `'approved'`, unless another approved or candidate link already holds that token (or, for a phrase, any of its tokens). This way an edit that is later undone restores its analyses.

Only approvals are staled and only stale links revived. `'rejected'` and `'candidate'` record a review someone performed, so the pass never touches them. Every link the pass rewrites takes the pass time as its `updatedAt`.

Custom split boundaries (`SegmentationDelta.addedStarts`) are snapshots too, carrying the word each split was set before, and re-anchor through the same alignment in `InterlinearizerLoader` before the book is re-segmented, so a split follows its word and the segments it bounds keep their text. A split that cannot be placed keeps its ref, stops applying while that ref names a different word, and is reported by the lost-boundaries notice; it applies again once its word reads that way there. Merged verses (`removedVerseStarts`) name a verse's first token, always at offset 0, so edits never shift them.

Segment analyses (free translations) have no offsets to heal, so they are checked instead: a segment whose `baselineText` differs at all from the stored analysis's `surfaceText` stales its approval, as does a segment of the loaded book that no longer exists, and it revives once the segment reads exactly that way again. A split piece's id is its first token's ref, so an edit earlier in its verse re-keys it; its translation follows the piece's own split boundary through the same alignment, and goes stale when that boundary cannot be placed or the piece no longer reads exactly as before — never onto an identical sibling piece.

## Known limits

- **A deleted word with an unglossed twin.** A form stored once whose occurrence was deleted, leaving an identical unglossed word elsewhere in the verse, looks exactly like the gloss shifting onto that twin. A snapshot cannot tell the two apart.
- **Words that moved between verses** go stale rather than following.
- **Alignment endpoints** (`AlignmentLink`) are not re-anchored. No feature writes them yet, so they need handling when one does.
- **Token splits and joins.** A split or join changes the affected word's form, so its own analysis goes stale while the words after it re-anchor normally. Remembering a user's split or join across retokenization is separate work and is not covered by this pass.

## Validation

`src/__tests__/utils/reanchor-analysis.test.ts` covers the cases above against real tokenized text, including an insertion ahead of an analyzed word: inserting "and" before a morpheme-analyzed "unbelievable" leaves the analysis on "unbelievable" rather than moving it to whichever word takes over its old offset.
