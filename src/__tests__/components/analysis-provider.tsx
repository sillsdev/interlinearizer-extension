import { act, render } from '@testing-library/react';
import type { Book, TextAnalysis } from 'interlinearizer';
import type { ReactElement, ReactNode } from 'react';
import { PageClient } from '../../cache/pageClient';
import { SessionAnalysisProvider } from '../../components/AnalysisStore';
import { emptyAnalysis } from '../../types/empty-factories';
import { fakeHost, hostSettled, type FakeText } from '../cache/fake-host';

/** What the last provider made saves its edits to. */
type Saved = Readonly<{
  settle: () => Promise<void>;
  savedAnalysis: () => Promise<TextAnalysis>;
  editsSaved: () => number;
}>;

/** A rendered subject, with the analysis that its edits have saved. */
export type AnalysisRendered = ReturnType<typeof render> & Saved;

let last: Saved | undefined;

/** The last provider that {@link prepareAnalysis} made. */
function lastRendered(): Saved {
  if (!last) throw new Error('nothing rendered with an analysis yet');
  return last;
}

/** Waits until every edit that the last subject sent has been applied and its reply rendered. */
export function settle(): Promise<void> {
  return lastRendered().settle();
}

/** The analysis as the last subject's edits have saved it. */
export function savedAnalysis(): Promise<TextAnalysis> {
  return lastRendered().savedAnalysis();
}

/** How many edits the last subject has saved. */
export function editsSaved(): number {
  return lastRendered().editsSaved();
}

/** Props that a test may give the provider that {@link prepareAnalysis} makes. */
export type AnalysisProviderProps = Readonly<{
  children: ReactNode;
  analysisLanguage?: string;
  readOnly?: boolean;
  onPendingEditsChange?: (pending: boolean) => void;
}>;

/**
 * Makes a {@link SessionAnalysisProvider} over a session on `analysis` that a fake host serves, with
 * every segment of `book` loaded, and `text` as the source text it reads whole, unread by default.
 * {@link settle}, {@link savedAnalysis} and {@link editsSaved} then answer for it.
 */
export async function prepareAnalysis(
  analysis: Partial<TextAnalysis>,
  book: Book,
  text?: FakeText,
): Promise<(props: AnalysisProviderProps) => ReactElement> {
  const seeded = { ...emptyAnalysis(), ...analysis };
  const host = await fakeHost(undefined, undefined, { analysis: seeded, book, text });
  const readDraft = () =>
    host.sessions.run(host.sessionId, (session) => session.repository.getWholeDraft());
  const client = new PageClient(
    { getOutline: () => host.fetchOutline(), getSegments: host.fetchPage },
    { retryDelaysMs: [0], wait: async () => {} },
  );
  let saves = 0;
  // Fed as the session hook feeds them in the app.
  host.onChange((change) => {
    saves += 1;
    client.hear(change);
  });
  await client.open();
  client.load(0, host.outline.segments.length, 'list');
  await client.settled();
  last = {
    settle: () =>
      act(async () => {
        await client.settled();
        await hostSettled();
      }),
    savedAnalysis: async () => (await readDraft()).analysis,
    editsSaved: () => saves,
  };
  return function SessionProvider({
    children,
    analysisLanguage = 'en',
    ...props
  }: AnalysisProviderProps) {
    return (
      <SessionAnalysisProvider
        client={client}
        sessionId={host.sessionId}
        analysisLanguage={analysisLanguage}
        {...props}
      >
        {children}
      </SessionAnalysisProvider>
    );
  };
}

/**
 * Renders `ui` inside the provider that {@link prepareAnalysis} makes over `analysis`, `book` and
 * `text`.
 */
export async function renderWithAnalysis(
  ui: ReactElement,
  {
    analysis,
    book,
    text,
    ...props
  }: Readonly<{ analysis: Partial<TextAnalysis>; book: Book; text?: FakeText }> &
    Omit<AnalysisProviderProps, 'children'>,
): Promise<AnalysisRendered> {
  const Provider = await prepareAnalysis(analysis, book, text);
  const rendered = render(ui, {
    wrapper: ({ children }) => <Provider {...props}>{children}</Provider>,
  });
  return { ...rendered, ...lastRendered() };
}
