/**
 * The PT9 interlinear converter's public surface: one function turning a project's PT9 interlinear
 * data, as the platform serves it, into the extension's analysis layer, the seam through which
 * lexical identities resolve, and the report types describing what a conversion did. The types each
 * stage hands the next are internal to the conversion and deliberately absent here. The report
 * guard rides along for callers receiving a report as JSON.
 */

export { convertPt9Project } from './convertPt9Project';
export type { Pt9ConversionInput, Pt9ConversionResult } from './convertPt9Project';

export type { Pt9LexiconResolver } from './lexiconResolver';

export { isPt9ImportReport } from './report';
export type {
  Pt9BarePayloadReport,
  Pt9BookReport,
  Pt9ClusterDropReason,
  Pt9ImportReport,
  Pt9LanguageReport,
  Pt9MergeReport,
  Pt9SenseReport,
} from './report';
