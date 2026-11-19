import type { MethodDocumentationWithoutName } from '@papi/core';
import type { CommandNames } from 'papi-shared-types';

/** The commands that this extension's TypeScript side registers. */
export type ExtensionCommand = Exclude<
  Extract<CommandNames, `interlinearizer.${string}`>,
  // Registered by the C# host.
  'interlinearizer.csharpPing'
>;

/** A parameter in a command's documentation. */
type ParamDoc = Extract<MethodDocumentationWithoutName['params'][number], { name: string }>;

/** The parameter naming the session whose source a query reads. */
const sessionAddressParam = {
  name: 'address',
  required: true as const,
  summary: '{ sessionId } of the session whose source to read',
  schema: {
    type: 'object' as const,
    properties: { sessionId: { type: 'string' as const } },
    required: ['sessionId'],
  },
};

/** Parameters naming the book a segment query reads. */
const bookParams = [
  sessionAddressParam,
  {
    name: 'bookId',
    required: true,
    summary: 'Book code, such as GEN',
    schema: { type: 'string' },
  },
] as const;

/** The field naming the session that a session command acts on. */
const sessionIdParam = {
  name: 'sessionId',
  required: true,
  summary: 'ID of the session, as openSession returned it',
  schema: { type: 'string' },
} as const;

/** The field naming the change that a session command makes. */
const changeIdParam = {
  name: 'changeId',
  required: false,
  summary:
    'Names the change; a command sent again under the id of a change the session has applied replies as it did then, applying nothing. Omit to have the session name it',
  schema: { type: 'string' },
} as const;

/** Documents a command's one argument, an object holding `fields`. */
const argsParam = (summary: string, fields: ParamDoc[]): ParamDoc[] => [
  {
    name: 'args',
    required: true,
    summary,
    schema: {
      type: 'object',
      properties: Object.fromEntries(
        fields.map(({ name, summary: description, schema }) => [name, { description, ...schema }]),
      ),
      required: fields.filter(({ required }) => required).map(({ name }) => name),
    },
  },
];

/** Documents a session command's one argument, which holds `fields` beside `sessionId`. */
const sessionArgs = (...fields: ParamDoc[]) =>
  argsParam("The session, and the command's own fields", [sessionIdParam, ...fields]);

/** The result of a command that replies with the changes it applied, if any. */
const appliedChangesResult = {
  name: 'return value',
  summary:
    'JSON-stringified CommandReply: the ChangeSet the undo or redo applied and the pool buckets it touched; omitted when there was nothing to apply',
  schema: { type: 'string' },
} as const;

/** The fields giving the token that a token edit acts on, and that token's current text. */
const tokenParams = [
  {
    name: 'tokenRef',
    required: true,
    summary: 'Token.ref of the token edited',
    schema: { type: 'string' },
  },
  {
    name: 'surfaceText',
    required: true,
    summary: "The token's current surface text",
    schema: { type: 'string' },
  },
] as const;

const editResult = {
  name: 'return value',
  summary:
    'JSON-stringified CommandReply: the ChangeSet the edit applied and the pool buckets it touched',
  schema: { type: 'string' },
} as const;

const staleAnalysisParam = {
  name: 'analysisId',
  required: true,
  summary: 'Id of the token analysis the stale link names',
  schema: { type: 'string' },
} as const;

const staleTranslationParam = {
  name: 'analysisId',
  required: true,
  summary: 'Id of the stale segment analysis',
  schema: { type: 'string' },
} as const;

/** The field naming the token analysis that a catalog-wide edit acts on. */
const catalogAnalysisParam = {
  name: 'analysisId',
  required: true,
  summary: 'Id of the token analysis edited, for every token linked to it',
  schema: { type: 'string' },
} as const;

const analysisIdsParam = {
  name: 'analysisIds',
  required: true,
  summary: 'Ids of the token analyses',
  schema: { type: 'array', items: { type: 'string' } },
} as const;

const senseRefParam = {
  name: 'senseRef',
  required: true,
  summary: 'SenseRef of the lexicon sense linked',
  schema: { type: 'object' },
} as const;

const keepGlossParam = {
  name: 'keepGloss',
  required: false,
  summary:
    "Gloss to write in the session's analysis language before the link is dropped; omit or leave blank to keep none",
  schema: { type: 'string' },
} as const;

const morphemeIdParam = {
  name: 'morphemeId',
  required: true,
  summary: 'MorphemeAnalysis.id of the morpheme edited',
  schema: { type: 'string' },
} as const;

const adoptValueParam = {
  name: 'value',
  required: true,
  summary: "The linked sense's gloss, which is never blank",
  schema: { type: 'string' },
} as const;

/** The field naming the phrase occurrence that a phrase edit acts on. */
const phraseIdParam = {
  name: 'phraseId',
  required: true,
  summary: 'PhraseAnalysisLink.id of the phrase occurrence edited',
  schema: { type: 'string' },
} as const;

const tokenSnapshotsSchema = {
  type: 'array' as const,
  items: {
    type: 'object' as const,
    properties: {
      tokenRef: { type: 'string' as const },
      surfaceText: { type: 'string' as const },
      formCount: { type: 'integer' as const },
    },
    required: ['tokenRef', 'surfaceText'],
  },
};

const discardResult = {
  name: 'return value',
  summary:
    'JSON-stringified CommandReply with hasFreeTranslations: the ChangeSet the discard applied and the pool buckets it touched; whether any segment of the draft the discard leaves has a free translation',
  schema: { type: 'string' },
} as const;

const currentBookParam = {
  name: 'currentBook',
  required: true,
  summary: 'Book code the per-book usage count is taken against',
  schema: { type: 'string' },
} as const;

const catalogRowsResult = {
  name: 'return value',
  summary: "JSON-stringified CatalogRow[], each row's books listed",
  schema: { type: 'string' },
} as const;

/** The documentation that each command is registered with. */
export const commandDocs: Record<ExtensionCommand, MethodDocumentationWithoutName> = {
  'interlinearizer.openForWebView': {
    summary: 'Open the Interlinearizer for the project associated with a WebView',
    params: [
      {
        name: 'webViewId',
        required: false,
        summary: 'The WebView ID whose project to open; if omitted a picker dialog is shown',
        schema: { type: 'string' },
      },
    ],
    // `undefined` (returned on cancel) is not a JSON type and cannot appear in a JSON-RPC
    // response, so the schema only describes the shape when a value is present.
    result: {
      name: 'return value',
      summary: 'The ID of the opened WebView, if opened; omitted when the user cancels',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.createProject': {
    summary: 'Create a new interlinearizer project',
    params: [
      {
        name: 'sourceProjectId',
        required: true,
        summary: 'Platform.Bible project ID of the source text to interlinearize',
        schema: { type: 'string' },
      },
      {
        name: 'analysisLanguages',
        required: true,
        summary: 'BCP 47 tags for gloss / annotation languages (e.g. ["en"]); must be non-empty',
        schema: { type: 'array', items: { type: 'string' } },
      },
      {
        name: 'targetProjectId',
        required: false,
        summary:
          'Optional Platform.Bible project ID of the target text for bilateral alignment projects',
        schema: { type: 'string' },
      },
      {
        name: 'name',
        required: false,
        summary: 'Optional user-facing name for the project',
        schema: { type: 'string' },
      },
      {
        name: 'description',
        required: false,
        summary: 'Optional user-facing description for the project',
        schema: { type: 'string' },
      },
    ],
    result: {
      name: 'return value',
      summary:
        'JSON-stringified InterlinearProjectSummary of the new project; rejects (throws) on storage failure',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.getProjectSummary': {
    summary:
      'Return the summary of the interlinearizer project with the given UUID as a JSON string, without its analysis',
    params: [
      {
        name: 'interlinearProjectId',
        required: true,
        summary: 'UUID of the interlinearizer project to summarize',
        schema: { type: 'string' },
      },
    ],
    result: {
      name: 'return value',
      summary: 'JSON-stringified InterlinearProjectSummary, or undefined if not listed',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.saveDraftToProject': {
    summary: "Copy a source project's stored draft into an existing interlinearizer project",
    params: [
      {
        name: 'sessionId',
        required: true,
        summary:
          'The session editing the draft; the copy runs in its turn, and its history marks the draft saved',
        schema: { type: 'string' },
      },
      {
        name: 'sourceProjectId',
        required: true,
        summary: 'Platform.Bible project ID whose draft to copy',
        schema: { type: 'string' },
      },
      {
        name: 'interlinearProjectId',
        required: true,
        summary: 'UUID of the interlinearizer project to save into',
        schema: { type: 'string' },
      },
      {
        name: 'config',
        required: false,
        summary:
          "The project's target to set in the same write, along with the draft's analysis languages, a missing target clearing the binding; omit to leave its configuration unchanged",
        schema: {
          type: 'object',
          properties: {
            targetProjectId: { type: 'string' },
          },
        },
      },
    ],
    result: {
      name: 'return value',
      summary:
        'JSON-stringified project summary with the refreshed updatedAt, or undefined if not found',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.saveDraftAsProject': {
    summary: "Create an interlinearizer project holding a copy of a source project's draft",
    params: [
      {
        name: 'sessionId',
        required: true,
        summary:
          'The session editing the draft; the copy runs in its turn, and when no book is left out, its history marks the draft saved',
        schema: { type: 'string' },
      },
      {
        name: 'sourceProjectId',
        required: true,
        summary: 'Platform.Bible project ID whose draft to copy',
        schema: { type: 'string' },
      },
      {
        name: 'analysisLanguages',
        required: true,
        summary: 'BCP 47 tags for gloss / annotation languages (e.g. ["en"]); must be non-empty',
        schema: { type: 'array', items: { type: 'string' } },
      },
      {
        name: 'targetProjectId',
        required: false,
        summary:
          'Optional Platform.Bible project ID of the target text for bilateral alignment projects',
        schema: { type: 'string' },
      },
      {
        name: 'name',
        required: false,
        summary: 'Optional user-facing name for the project',
        schema: { type: 'string' },
      },
      {
        name: 'description',
        required: false,
        summary: 'Optional user-facing description for the project',
        schema: { type: 'string' },
      },
    ],
    result: {
      name: 'return value',
      summary:
        "JSON-stringified { project, omittedBooks }: the new project's summary and the books left out of it; rejects (throws) on storage failure",
      schema: { type: 'string' },
    },
  },
  'interlinearizer.getProjectsForSource': {
    summary: 'Return all interlinearizer projects for a source project as a JSON string',
    params: [
      {
        name: 'sourceProjectId',
        required: true,
        summary: 'Platform.Bible project ID of the source text to query',
        schema: { type: 'string' },
      },
    ],
    result: {
      name: 'return value',
      summary: 'JSON-stringified InterlinearProjectSummary[] for the given source',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.getBookOutline': {
    summary:
      "Return the outline of a book of a session's source, segmented by the draft's boundaries, as a JSON string",
    params: [...bookParams],
    result: {
      name: 'return value',
      summary:
        'JSON-stringified BookOutline, or undefined when the project has no text for the book',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.getSegments': {
    summary:
      "Return a run of the segments of a book of a session's source, with the draft's analysis of them, as a JSON string",
    params: [
      ...bookParams,
      {
        name: 'start',
        required: true,
        summary: 'Outline index of the first segment to return',
        schema: { type: 'integer' },
      },
      {
        name: 'end',
        required: true,
        summary: 'Outline index after the last segment to return',
        schema: { type: 'integer' },
      },
    ],
    result: {
      name: 'return value',
      summary:
        'JSON-stringified SegmentPage, or undefined when the project has no text for the book',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.getTextReadStatus': {
    summary:
      "Return how far reading a session's whole source text has got, starting the session's read when it has none, as a JSON string",
    params: [sessionAddressParam],
    result: {
      name: 'return value',
      summary: 'JSON-stringified TextReadStatus',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.retryTextRead': {
    summary: "Read again each book of a session's whole source text whose latest read failed",
    params: [sessionAddressParam],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.startDraftOver': {
    summary:
      "Start a source project's draft over, from a stored project or empty, closing the source's session first",
    params: [
      {
        name: 'args',
        required: true,
        summary: 'The source project, and what its draft starts over from',
        schema: {
          type: 'object',
          properties: {
            sourceProjectId: {
              description: 'Platform.Bible source project ID whose draft to start over',
              type: 'string',
            },
            from: {
              description:
                'Either { interlinearProjectId } to copy a stored project (Open), or the New configuration { analysisLanguages, suggestedDescription? }',
              type: 'object',
            },
          },
          required: ['sourceProjectId', 'from'],
        },
      },
    ],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.getStaleSummary': {
    summary:
      "Summarize the stale analyses that a book of a session's source holds, segmented by the draft's boundaries, as a JSON string",
    params: sessionArgs({
      name: 'bookId',
      required: true,
      summary: 'Book code, such as GEN',
      schema: { type: 'string' },
    }),
    result: {
      name: 'return value',
      summary:
        'JSON-stringified StaleSummary, or undefined when the project has no text for the book',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.openSession': {
    summary:
      "Open a session on a source project's draft, or read-only on its Paratext 9 import, closing the source's earlier session",
    params: argsParam('The source project, and the interlinear project to open with it', [
      {
        name: 'sourceProjectId',
        required: true,
        summary: 'Platform.Bible source project ID whose analysis to open',
        schema: { type: 'string' },
      },
      {
        name: 'interlinearProjectId',
        required: false,
        summary: 'UUID of the interlinear project the draft saves to; omit for the draft alone',
        schema: { type: 'string' },
      },
      {
        name: 'importProjectId',
        required: false,
        summary: 'UUID of the Paratext 9 import to read instead of the draft',
        schema: { type: 'string' },
      },
    ]),
    result: {
      name: 'return value',
      summary: 'JSON-stringified OpenedSession',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.closeSession': {
    summary: 'Close a session once the commands sent to it settle',
    params: sessionArgs(),
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.setAnalysisLanguage': {
    summary: "Set the language a session's glosses are read and written in",
    params: sessionArgs({
      name: 'analysisLanguage',
      required: true,
      summary: 'BCP 47 tag of the language',
      schema: { type: 'string' },
    }),
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.setSaveTarget': {
    summary: "Set which project a session's draft saves to, if any",
    params: sessionArgs({
      name: 'interlinearProjectId',
      required: false,
      summary: 'The interlinear project to save to; absent for none',
      schema: { type: 'string' },
    }),
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.detachFromProject': {
    summary: "Leave a session's draft with no project to save to, once its project is deleted",
    params: sessionArgs(),
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.undoEdit': {
    summary: "Revert a session's latest edit not yet undone",
    params: sessionArgs(changeIdParam),
    result: appliedChangesResult,
  },
  'interlinearizer.redoEdit': {
    summary: "Make a session's latest undone edit again",
    params: sessionArgs(changeIdParam),
    result: appliedChangesResult,
  },
  'interlinearizer.writeGloss': {
    summary: "Write a token's gloss in a session's analysis language; a blank value clears it",
    params: sessionArgs(
      ...tokenParams,
      {
        name: 'value',
        required: true,
        summary: 'The gloss',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.approveAnalysisForToken': {
    summary: 'Approve a stored token analysis for a token, in place of any approval the token held',
    params: sessionArgs(
      ...tokenParams,
      {
        name: 'analysisId',
        required: true,
        summary: 'Id of the stored token analysis to approve',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.writeMorphemes': {
    summary: "Write a token's morpheme breakdown",
    params: sessionArgs(
      ...tokenParams,
      {
        name: 'forms',
        required: true,
        summary: 'The morpheme forms, in order',
        schema: { type: 'array', items: { type: 'string' } },
      },
      {
        name: 'writingSystem',
        required: true,
        summary: 'BCP 47 tag of the writing system the forms are in',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.deleteMorphemes': {
    summary: "Remove a token's morpheme breakdown",
    params: sessionArgs(tokenParams[0], changeIdParam),
    result: editResult,
  },
  'interlinearizer.writeMorphemeGloss': {
    summary:
      "Gloss one morpheme of a token's breakdown in a session's analysis language; a blank value clears the morpheme's gloss",
    params: sessionArgs(
      tokenParams[0],
      {
        name: 'morphemeId',
        required: true,
        summary: 'MorphemeAnalysis.id of the morpheme glossed',
        schema: { type: 'string' },
      },
      {
        name: 'value',
        required: true,
        summary: 'The gloss',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.discardStaleAnalysis': {
    summary: 'Give up the place an analysis went stale at, leaving its other places alone',
    params: sessionArgs(
      staleAnalysisParam,
      {
        name: 'tokenRef',
        required: true,
        summary: 'Token.ref the stale link names',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.reapplyStaleAnalysis': {
    summary:
      'Move an analysis from a place it went stale at onto a token, approving it there in place of whatever the token held',
    params: sessionArgs(
      staleAnalysisParam,
      {
        name: 'staleTokenRef',
        required: true,
        summary: 'Token.ref the stale link names',
        schema: { type: 'string' },
      },
      ...tokenParams,
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.keepStaleFreeTranslation': {
    summary:
      "Keep a stale free translation as a claim about a segment's current text, approving it for that segment",
    params: sessionArgs(
      staleTranslationParam,
      {
        name: 'segmentId',
        required: true,
        summary: 'Segment.id of the segment it is kept for',
        schema: { type: 'string' },
      },
      {
        name: 'surfaceText',
        required: true,
        summary: "The segment's current baseline text",
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.discardStaleFreeTranslation': {
    summary: 'Drop a stale free translation, one whose verse the book no longer holds included',
    params: sessionArgs(staleTranslationParam, changeIdParam),
    result: editResult,
  },
  'interlinearizer.writeAnalysisGloss': {
    summary:
      "Write a token analysis's gloss in a session's analysis language, for every token linked to it; a blank value clears it",
    params: sessionArgs(
      catalogAnalysisParam,
      { name: 'value', required: true, summary: 'The gloss', schema: { type: 'string' } },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.clearAnalysisGlosses': {
    summary: "Clear the glosses of several token analyses in a session's analysis language",
    params: sessionArgs(analysisIdsParam, changeIdParam),
    result: editResult,
  },
  'interlinearizer.writeAnalysisMorphemes': {
    summary:
      "Re-split a token analysis's breakdown, for every token linked to it; no forms removes the breakdown",
    params: sessionArgs(
      catalogAnalysisParam,
      {
        name: 'forms',
        required: true,
        summary: "The breakdown's forms in order",
        schema: { type: 'array', items: { type: 'string' } },
      },
      {
        name: 'writingSystem',
        required: true,
        summary: 'Writing system the morphemes are tagged with',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.confirmAnalysisMorphemes': {
    summary: "Keep a token analysis's stale breakdown as it stands, for every token linked to it",
    params: sessionArgs(
      catalogAnalysisParam,
      {
        name: 'tokenRef',
        required: false,
        summary:
          "Token.ref the undo step is placed at; omit to name the analysis's catalog row instead",
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.writeAnalysisMorphemeGloss': {
    summary:
      "Write the gloss of one morpheme of a token analysis in a session's analysis language, for every token linked to it; a blank value clears it",
    params: sessionArgs(
      catalogAnalysisParam,
      {
        name: 'morphemeId',
        required: true,
        summary: 'MorphemeAnalysis.id of the morpheme glossed',
        schema: { type: 'string' },
      },
      { name: 'value', required: true, summary: 'The gloss', schema: { type: 'string' } },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.linkAnalysisSense': {
    summary:
      'Link a token analysis to a lexicon sense, for every token linked to it, replacing any sense it had',
    params: sessionArgs(catalogAnalysisParam, senseRefParam, changeIdParam),
    result: editResult,
  },
  'interlinearizer.unlinkAnalysisSense': {
    summary:
      "Drop a token analysis's lexicon sense link, for every token linked to it, optionally keeping a gloss",
    params: sessionArgs(catalogAnalysisParam, keepGlossParam, changeIdParam),
    result: editResult,
  },
  'interlinearizer.linkAnalysisMorphemeSense': {
    summary:
      'Link one morpheme of a token analysis to a lexicon sense, for every token linked to it; a different entry drops its allomorph and grammar references',
    params: sessionArgs(
      catalogAnalysisParam,
      morphemeIdParam,
      {
        name: 'entryRef',
        required: true,
        summary: 'EntryRef of the lexicon entry that owns the sense',
        schema: { type: 'object' },
      },
      senseRefParam,
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.unlinkAnalysisMorphemeSense': {
    summary:
      'Drop every lexicon reference of one morpheme of a token analysis, for every token linked to it, optionally keeping a gloss',
    params: sessionArgs(catalogAnalysisParam, morphemeIdParam, keepGlossParam, changeIdParam),
    result: editResult,
  },
  'interlinearizer.adoptAnalysisSenseGloss': {
    summary:
      "Write a linked sense's gloss as a token analysis's gloss in a session's analysis language, keeping the link",
    params: sessionArgs(catalogAnalysisParam, adoptValueParam, changeIdParam),
    result: editResult,
  },
  'interlinearizer.adoptAnalysisMorphemeSenseGloss': {
    summary:
      "Write a linked sense's gloss as one morpheme's gloss in a session's analysis language, keeping the link",
    params: sessionArgs(catalogAnalysisParam, morphemeIdParam, adoptValueParam, changeIdParam),
    result: editResult,
  },
  'interlinearizer.deleteAnalyses': {
    summary: 'Remove token analyses with every token link to them',
    params: sessionArgs(analysisIdsParam, changeIdParam),
    result: editResult,
  },
  'interlinearizer.mergeAnalysesInto': {
    summary:
      "Fold token analyses into a survivor and write the settled content onto it, in a session's analysis language",
    params: sessionArgs(
      {
        name: 'survivorAnalysisId',
        required: true,
        summary: 'Id of the token analysis kept',
        schema: { type: 'string' },
      },
      {
        name: 'mergedAnalysisIds',
        required: true,
        summary: 'Ids of the token analyses folded in, most-preferred first',
        schema: { type: 'array', items: { type: 'string' } },
      },
      {
        name: 'content',
        required: true,
        summary: 'MergedContent the survivor says once the merge settles',
        schema: { type: 'object' },
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.createPhrase': {
    summary:
      'Add an approved phrase occurrence, sharing a content-identical stored payload where one exists',
    params: sessionArgs(
      {
        name: 'tokens',
        required: true,
        summary: "The phrase's token snapshots, in document order",
        schema: tokenSnapshotsSchema,
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.updatePhrase': {
    summary: 'Give a phrase occurrence a new token run, keeping its gloss; an empty run removes it',
    params: sessionArgs(
      phraseIdParam,
      {
        name: 'tokens',
        required: true,
        summary: 'The new token snapshots, in document order',
        schema: tokenSnapshotsSchema,
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.deletePhrase': {
    summary: 'Remove a phrase occurrence, with its payload unless another occurrence shares it',
    params: sessionArgs(phraseIdParam, changeIdParam),
    result: editResult,
  },
  'interlinearizer.mergePhrases': {
    summary:
      'Grow a phrase occurrence to a merged token run, removing the absorbed occurrence when named',
    params: sessionArgs(
      {
        name: 'targetPhraseId',
        required: true,
        summary: 'PhraseAnalysisLink.id of the phrase occurrence that grows',
        schema: { type: 'string' },
      },
      {
        name: 'tokens',
        required: true,
        summary: 'The merged token snapshots, in document order',
        schema: tokenSnapshotsSchema,
      },
      {
        name: 'absorbedPhraseId',
        required: false,
        summary:
          'PhraseAnalysisLink.id of the neighboring occurrence merged in; omit when the neighbor is in no phrase',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.writePhraseGloss': {
    summary:
      "Write a phrase occurrence's gloss in a session's analysis language; a blank value clears it",
    params: sessionArgs(
      phraseIdParam,
      {
        name: 'value',
        required: true,
        summary: 'The gloss',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.approvePhrase': {
    summary: 'Approve a phrase occurrence, unless any of its tokens is in an approved phrase',
    params: sessionArgs(phraseIdParam, changeIdParam),
    result: editResult,
  },
  'interlinearizer.splitPhrase': {
    summary:
      "Split a phrase occurrence just after a token, in the document order of the token's book",
    params: sessionArgs(
      phraseIdParam,
      {
        name: 'splitAfterTokenRef',
        required: true,
        summary: 'Token.ref of the token the first half ends with',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.writeSegmentFreeTranslation': {
    summary:
      "Write a segment's free translation in a session's analysis language; a blank value clears it",
    params: sessionArgs(
      {
        name: 'segmentId',
        required: true,
        summary: 'Segment.id of the segment translated',
        schema: { type: 'string' },
      },
      {
        name: 'surfaceText',
        required: true,
        summary: "The segment's current baseline text",
        schema: { type: 'string' },
      },
      {
        name: 'value',
        required: true,
        summary: 'The free translation',
        schema: { type: 'string' },
      },
      {
        name: 'adoptStaleAnalysisId',
        required: false,
        summary:
          'Id of the stale translation the value was typed over, adopted when the segment has no approved one; omit when there is none',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.mergeSegments': {
    summary: 'Merge the segment beginning at a token into the one before it',
    params: sessionArgs(
      {
        name: 'secondSegmentStartRef',
        required: true,
        summary: 'Token.ref of the first token of the segment merged away',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.splitSegment': {
    summary:
      'Split a segment so a new one begins at a token, first splitting every approved phrase the boundary would cut',
    params: sessionArgs(
      {
        name: 'tokenRef',
        required: true,
        summary: 'Token.ref of the token the new segment begins with',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.moveBoundary': {
    summary:
      'Move a segment boundary from one token to another, first splitting every approved phrase the moved boundary would cut',
    params: sessionArgs(
      {
        name: 'fromRef',
        required: true,
        summary: 'Token.ref of the token that stops beginning a segment',
        schema: { type: 'string' },
      },
      {
        name: 'toRef',
        required: true,
        summary: 'Token.ref of the token that begins a segment instead',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.discardBook': {
    summary:
      "Discard the unsaved changes to one book of a session's draft, restoring what the project it saves to holds for the book",
    params: sessionArgs(
      {
        name: 'bookCode',
        required: true,
        summary: 'Three-letter code of the book discarded',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: discardResult,
  },
  'interlinearizer.discardAll': {
    summary:
      "Discard every unsaved change to a session's draft, restoring what the project it saves to holds",
    params: sessionArgs(changeIdParam),
    result: discardResult,
  },
  'interlinearizer.changeAnalysisLanguages': {
    summary:
      "Give a session's draft new analysis languages, optionally moving or deleting one tag's glosses and free translations",
    params: sessionArgs(
      {
        name: 'analysisLanguages',
        required: true,
        summary: 'BCP 47 tags, primary first; never empty',
        schema: { type: 'array', items: { type: 'string' } },
      },
      {
        name: 'retag',
        required: false,
        summary: 'Glosses and free translations to move from one tag to another',
        schema: {
          type: 'object',
          properties: { from: { type: 'string' }, to: { type: 'string' } },
          required: ['from', 'to'],
        },
      },
      {
        name: 'deleteTextOf',
        required: false,
        summary: 'The tag whose glosses and free translations are deleted',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  },
  'interlinearizer.countLanguageText': {
    summary:
      "Count the glosses and free translations of a session's draft under each language tag that has any",
    params: sessionArgs(),
    result: {
      name: 'return value',
      summary: 'JSON-stringified counts keyed by tag',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.previewRemovals': {
    summary: "Name the token analyses a command would remove from a session's draft",
    params: sessionArgs({
      name: 'request',
      required: true,
      summary: 'RemovalPreviewRequest naming the command by intent, with its arguments',
      schema: { type: 'object' },
    }),
    result: {
      name: 'return value',
      summary: 'JSON-stringified ids of the token analyses; "[]" when it would remove none',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.previewBreakdownEdit': {
    summary:
      'Read what a breakdown edit at a token would do to the payload that the token approves',
    params: sessionArgs({
      name: 'tokenRef',
      required: true,
      summary: 'Token.ref of the token whose breakdown would be edited',
      schema: { type: 'string' },
    }),
    result: {
      name: 'return value',
      summary: 'JSON-stringified BreakdownPreview',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.getCatalogRows': {
    summary: "Serve one page of a session's analysis catalog, with the filter choices to offer",
    params: sessionArgs({
      name: 'request',
      required: true,
      summary: 'CatalogRowsRequest naming the search, sort, filters, page and current book',
      schema: { type: 'object' },
    }),
    result: {
      name: 'return value',
      summary: "JSON-stringified CatalogPage, each row's books listed",
      schema: { type: 'string' },
    },
  },
  'interlinearizer.getSelectionSummary': {
    summary:
      "Summarize the selected analyses of a session's draft: their use count, the glossed ones, and the merge they allow",
    params: sessionArgs({
      name: 'analysisIds',
      required: true,
      summary: 'IDs of the selected token analyses, in listing order',
      schema: { type: 'array', items: { type: 'string' } },
    }),
    result: {
      name: 'return value',
      summary: 'JSON-stringified SelectionSummary',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.countUsages': {
    summary: "Count the distinct tokens in a session's draft that approve any of the analyses",
    params: sessionArgs({
      name: 'analysisIds',
      required: true,
      summary: 'IDs of the token analyses',
      schema: { type: 'array', items: { type: 'string' } },
    }),
    result: { name: 'return value', summary: 'How many tokens', schema: { type: 'number' } },
  },
  'interlinearizer.getCatalogRowsByIds': {
    summary: "Serve the catalog rows of the named analyses in a session's draft, in that order",
    params: sessionArgs(currentBookParam, {
      name: 'analysisIds',
      required: true,
      summary: 'IDs of the token analyses; an unstored one is left out',
      schema: { type: 'array', items: { type: 'string' } },
    }),
    result: catalogRowsResult,
  },
  'interlinearizer.getHomographRows': {
    summary:
      "Serve the catalog rows in a session's draft sharing an analysis's normalized surface form, most used first",
    params: sessionArgs(currentBookParam, {
      name: 'analysisId',
      required: true,
      summary: 'ID of the token analysis',
      schema: { type: 'string' },
    }),
    result: {
      name: 'return value',
      summary: `JSON-stringified CatalogRow[], each row's books listed; "[]" when no analysis carries the id`,
      schema: { type: 'string' },
    },
  },
  'interlinearizer.previewDeletion': {
    summary:
      "Report what deleting a token analysis in a session's draft would do to the tokens that approve it",
    params: sessionArgs({
      name: 'analysisId',
      required: true,
      summary: 'ID of the token analysis',
      schema: { type: 'string' },
    }),
    result: {
      name: 'return value',
      summary: 'JSON-stringified AnalysisDeletionOutcome; "null" when no analysis carries the id',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.getConcordance': {
    summary:
      "Serve one page of a session's concordance: of the forms of its source's whole text, or of one form's occurrences",
    params: sessionArgs({
      name: 'request',
      required: true,
      summary:
        'ConcordanceRequest naming the page, and either the current book or the form whose occurrences are paged',
      schema: { type: 'object' },
    }),
    result: {
      name: 'return value',
      summary:
        'JSON-stringified ConcordancePage, or ConcordanceOccurrencePage for a form; "null" until the whole text has been read',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.checkIndexes': {
    summary:
      "Report where a session's derived indexes, or stored shards, differ from its records, for debugging",
    params: sessionArgs(),
    result: {
      name: 'return value',
      summary: 'JSON-stringified IndexDifference[]; "[]" when none differ',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.getDraftEnvelope': {
    summary: "Read a session's draft without its analysis or boundaries",
    params: sessionArgs(),
    result: {
      name: 'return value',
      summary: 'JSON-stringified DraftEnvelope',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.setPerfMarks': {
    summary: "Turn the extension host's timing entries on or off for the performance harness",
    params: [
      {
        name: 'enabled',
        required: true,
        summary: 'Whether the host records timing entries',
        schema: { type: 'boolean' },
      },
    ],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.setSkipSessionReads': {
    summary:
      'Turn on or off skipping the whole-text read that a session starts, for the performance harness',
    params: [
      {
        name: 'skip',
        required: true,
        summary: 'Whether sessions read no text, even when a feature needs it',
        schema: { type: 'boolean' },
      },
    ],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.sessionIdFor': {
    summary:
      "Return the id of the session open on a source project, for the performance harness to address the view's session",
    params: [
      {
        name: 'sourceProjectId',
        required: true,
        summary: 'Source project whose open session to name',
        schema: { type: 'string' },
      },
    ],
    result: {
      name: 'return value',
      summary: 'The session id, or undefined when the source has no session open',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.readPerf': {
    summary: 'Take the timing entries the extension host recorded since the last reading',
    params: [],
    result: {
      name: 'return value',
      summary: 'JSON-stringified { entries, pid }, or undefined while timing entries are off',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.updateProjectMetadata': {
    summary: 'Update the name, description, and target of an existing interlinearizer project',
    params: [
      {
        name: 'interlinearProjectId',
        required: true,
        summary: 'UUID of the interlinearizer project to update',
        schema: { type: 'string' },
      },
      {
        name: 'name',
        required: false,
        summary: 'New user-facing name; omit to clear',
        schema: { type: 'string' },
      },
      {
        name: 'description',
        required: false,
        summary: 'New user-facing description; omit to clear',
        schema: { type: 'string' },
      },
      {
        name: 'targetProjectId',
        required: false,
        summary: 'New target-project ID; omit to clear the target binding',
        schema: { type: 'string' },
      },
    ],
    result: {
      name: 'return value',
      summary:
        'JSON-stringified InterlinearProjectSummary of the updated project, or undefined if no project with that ID exists; rejects (throws) on storage failure',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.importPt9Project': {
    summary:
      "Import or sync the source project's Paratext 9 interlinear data into its single frozen import project",
    params: [
      {
        name: 'sourceProjectId',
        required: true,
        summary: 'Platform.Bible project ID whose Paratext 9 interlinear files to import',
        schema: { type: 'string' },
      },
    ],
    result: {
      name: 'return value',
      summary:
        "JSON-stringified { outcome: 'imported' | 'staleKept', projectId, report?, summary? }; rejects (throws) when the source has nothing to import or the import fails",
      schema: { type: 'string' },
    },
  },
  'interlinearizer.createEditableCopy': {
    summary:
      'Create an editable project from a Paratext 9 import, carrying its analysis and no import provenance',
    params: [
      {
        name: 'interlinearProjectId',
        required: true,
        summary: 'UUID of the Paratext 9 import to copy',
        schema: { type: 'string' },
      },
      {
        name: 'name',
        required: true,
        summary: 'User-facing name for the copy',
        schema: { type: 'string' },
      },
      {
        name: 'description',
        required: false,
        summary: 'User-facing description for the copy',
        schema: { type: 'string' },
      },
    ],
    result: {
      name: 'return value',
      summary:
        'JSON-stringified InterlinearProjectSummary of the created copy; rejects (throws) when the project is missing or not a Paratext 9 import',
      schema: { type: 'string' },
    },
  },
  'interlinearizer.deleteProject': {
    summary: 'Delete an interlinearizer project by UUID',
    params: [
      {
        name: 'interlinearProjectId',
        required: true,
        summary: 'UUID of the interlinearizer project to delete',
        schema: { type: 'string' },
      },
    ],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.openSelectProjectModal': {
    summary: 'Open the project-selector modal in the Interlinearizer WebView',
    params: [],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.openNewProjectModal': {
    summary: 'Open the create-project modal in the Interlinearizer WebView',
    params: [],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.openProjectInfoModal': {
    summary:
      'Open the interlinear-info modal for the active project in the Interlinearizer WebView',
    params: [],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.openDeleteProjectModal': {
    summary: 'Ask to delete the active project in the Interlinearizer WebView',
    params: [],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.openAnalysisCatalog': {
    summary: 'Open the analysis catalog panel in the Interlinearizer WebView',
    params: [],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.openConcordance': {
    summary: 'Open the concordance panel in the Interlinearizer WebView',
    params: [],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.undo': {
    summary: 'Undo the latest edit to the draft in the Interlinearizer WebView',
    params: [],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.redo': {
    summary: 'Redo the most recently undone edit to the draft in the Interlinearizer WebView',
    params: [],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.undoFromNotification': {
    summary: "Undo the draft edit a notification's Undo button offered to undo",
    params: [
      {
        name: 'notificationId',
        required: true,
        summary: 'ID of the notification whose Undo button was clicked',
        schema: { type: ['string', 'number'] },
      },
    ],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.openLexiconChooser': {
    summary: 'Open the lexicon chooser for this project from the Interlinearizer WebView',
    params: [],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.save': {
    summary:
      'Save the current draft to the active project (handled in the Interlinearizer WebView)',
    params: [],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.openSaveAsModal': {
    summary: 'Open the Save As modal in the Interlinearizer WebView',
    params: [],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
  'interlinearizer.openDiscardChangesModal': {
    summary:
      'Open the dialog that discards the unsaved analysis of the current book or the whole draft (handled in the WebView)',
    params: [],
    result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
  },
};

function isExtensionCommand(name: string): name is ExtensionCommand {
  return name in commandDocs;
}

/** Every command of this extension, in the order that {@link commandDocs} lists them. */
export const extensionCommands: readonly ExtensionCommand[] =
  Object.keys(commandDocs).filter(isExtensionCommand);
