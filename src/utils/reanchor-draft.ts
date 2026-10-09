import type { Book } from 'interlinearizer';
import type { DraftContent } from '../hooks/useDraftProject';
import { resegmentBook } from '../parsers/papi/resegmentBook';
import { perfTime } from './perf-marks';
import { reanchorAnalysisToBook } from './reanchor-analysis';
import { reanchorSegmentation } from './segmentation';
import type { BookPass } from './undo-history';

/** Builds the pass that re-anchors a draft's content to `verseBook`'s current text. */
export function reanchorDraftToBook(verseBook: Book): BookPass<DraftContent> {
  return (content) => {
    const segmentation = reanchorSegmentation(verseBook, content.segmentation);
    const analysis = perfTime(
      'reanchor',
      () =>
        reanchorAnalysisToBook(
          content.analysis,
          resegmentBook(verseBook, segmentation),
          new Date().toISOString(),
          content.segmentation?.addedStarts,
        ),
      { book: verseBook.bookRef },
    );
    return { analysis, segmentation };
  };
}
