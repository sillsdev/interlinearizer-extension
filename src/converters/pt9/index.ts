/**
 * The PT9 interlinear converter's public surface: one function turning parsed PT9 files into the
 * extension's analysis layer, the seam through which lexical identities resolve, and the report
 * types describing what a conversion did. The types each stage hands the next are internal to the
 * conversion and deliberately absent here.
 */

export { convertPt9Project } from './convertPt9Project';
export type { Pt9ConversionInput, Pt9ConversionResult, Pt9ProjectData } from './convertPt9Project';

export type { Pt9LexiconResolver } from './lexiconResolver';

export type {
  Pt9BarePayloadReport,
  Pt9BookReport,
  Pt9ClusterDropReason,
  Pt9ImportReport,
  Pt9LanguageReport,
  Pt9MergeReport,
  Pt9SenseReport,
} from './report';
