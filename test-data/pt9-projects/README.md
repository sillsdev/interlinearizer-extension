# Paratext 9 interlinear test projects

Four minimal Paratext 9 projects for exercising the Paratext 9 interlinear import against a real
running platform. Each has one book (PHP) and a handful of verses, so an import finishes immediately
and its report is small enough to read whole.

The verse text is invented for the shapes the import has to handle: a form that repeats within a
verse, runs of words a phrase can span, forms that divide into a stem and a suffix, and forms that
recur with no cluster of their own, so an analysis approved elsewhere has somewhere to be suggested.

These complement [`../Pt9InterlinearProjectData.json`](../Pt9InterlinearProjectData.json), which is
the served payload the converter's unit tests read directly. These are whole projects, for what no
unit test covers:

- the platform reading the files;
- the import service persisting the result;
- the WebView presenting it.

The XML schema they follow is documented in
[`src/parsers/pt9/pt9-xml.md`](../../src/parsers/pt9/pt9-xml.md).

## Using them

1. Copy the project folders into the Platform.Bible project root.

   - On Windows: `%USERPROFILE%\.platform.bible\projects\Paratext 9 Projects\`.
   - Elsewhere: `~/.platform.bible/projects/Paratext 9 Projects/`.
   - Alternatively point `PLATFORM_BIBLE_PROJECT_ROOT_FOLDER` at a folder holding them, which leaves
     your own projects untouched.

2. Start Platform.Bible with the extension (`npm start`).
3. Open the Interlinearizer on one of the projects and use **Import from Paratext 9**, or invoke
   `interlinearizer.importPt9Project` with the project's ID directly.

The platform serves this data through the `platformScripture.Pt9Interlinear` projectInterface, which
is advertised only on unpublished (editable) projects. So a project copied here must load as an
ordinary editable project, not as a resource.

Project GUIDs and `unique.id` values are fixed rather than generated, so re-copying a project after
deleting it reuses the same Platform.Bible project ID and any interlinearizer state still keyed to
it.

## What each project covers

| Project | Purpose       | Key features                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PIA`   | Happy path    | Two gloss languages (`es`, `fr`) over one book, so records merge across languages and one token's parses conflict; five phrase clusters in `es` (a plain two-word one, one ambiguous between two matching runs, one overlapping an approved run so it demotes to `candidate`, an excluded one, and a three-word one both languages gloss); word parses, including a one-morpheme one on a token the other language leaves alone; a word and a parse cluster sharing one range; verse hashes placed so each analysis shape has at least one approved - and therefore linked - instance, since only an approved link is applied to anything; one verse approved by `es` alone, so the phrase both languages gloss merges back down to `suggested`; an excluded cluster; a punctuation entry; a repeated surface form, for an ambiguous anchor; two unanalyzed tokens whose forms carry an approved analysis elsewhere in the book, for the suggestion pool; every sense-resolution outcome; every bare-word-analysis outcome |
| `PIB`   | Cluster drops | All five `clusterDrops` reasons (`formMismatch`, `duplicateCluster`, `lemmaOrOther`, `unparseableLexemeId`, `verseNotFound`); two phrases that drop, one matching no run of words and one whose form is blank, beside a phrase that anchors as a control, in an approved verse so it lands somewhere visible; plus an `Interlinear_es_JAS.xml` for a book the project has no text for, which reports `bookFound: false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `PIC`   | File identity | A canonical book file beside a non-canonical twin of it (`booksDroppedAsDuplicates`, and the canonical file's data is the data that must survive); one file with no `GlossLanguage` and one with no `BookId` (`booksMissingIdentity`); `GlossLanguage="English"` (`tagIsFallback`); `es-MX` and `es-mx`, which stay separate language groups but resolve onto one tag (`sameTagCollisions`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `PID`   | Lexicon only  | A `Lexicon.xml` and `WordAnalyses.xml` with no interlinear book file at all: the manifest is non-empty, so the import is offered and succeeds, but the conversion has no book to report on and `report.languages` comes back empty                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

For the remaining case, a project the import must refuse outright, use any project with no
`Lexicon.xml`, no `WordAnalyses.xml`, and no `Interlinear_*` file. Its manifest is empty, which is
what makes the import throw rather than create anything.
