import type { ReactNode } from 'react';

/** Props for {@link CatalogList}. */
type CatalogListProps = Readonly<{
  /** Receives the element the rows scroll in. */
  scrollRef: (el: HTMLElement | null) => void;
  /** Receives the element whose coming into view means the reader reached the last mounted row. */
  sentinelRef: (el: HTMLElement | null) => void;
  /** The mounted rows. */
  children: ReactNode;
}>;

/**
 * Lists the catalog's rows on the columns {@link CatalogRowHeader} fills, so the columns of every
 * row line up.
 */
export default function CatalogList({ scrollRef, sentinelRef, children }: CatalogListProps) {
  return (
    <ul
      className="tw:grid tw:grid-cols-[auto_auto_minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto] tw:content-start tw:flex-1 tw:min-h-0 tw:overflow-y-auto"
      ref={scrollRef}
    >
      {children}
      {/*
        Sits after the last mounted row, so reaching it means the reader has scrolled to the end of
        what is mounted rather than to the end of the listing. A list item rather than a bare div,
        since a `ul` may hold nothing else.
      */}
      <li
        aria-hidden
        className="tw:col-span-full"
        data-testid="catalog-rows-sentinel"
        ref={sentinelRef}
      />
    </ul>
  );
}
