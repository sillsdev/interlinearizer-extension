import type { SessionEditArgs, TextAnalysis } from 'interlinearizer';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { AnalysisState } from '../store/analysisSlice';
import type { CommandReply } from '../types/command-reply';
import type { PoolIndex } from '../utils/suggestion-engine';
import type { PageClient } from './pageClient';
import type { WholeAnalysis } from './wholeAnalysis';

type PageContext = Readonly<{
  client: PageClient;
  whole: WholeAnalysis;
  sessionId: string;
  analysisLanguage: string;
}>;

const PageClientContext = createContext<PageContext | undefined>(undefined);

/** Serves a session, and the client that holds its open book's pages, to the page hooks beneath it. */
export function PageClientProvider({
  client,
  whole,
  sessionId,
  analysisLanguage,
  children,
}: {
  client: PageClient;
  whole: WholeAnalysis;
  sessionId: string;
  /** BCP 47 tag that glosses and free translations are read in. */
  analysisLanguage: string;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ client, whole, sessionId, analysisLanguage }),
    [client, whole, sessionId, analysisLanguage],
  );
  return <PageClientContext.Provider value={value}>{children}</PageClientContext.Provider>;
}

/**
 * The selector state last built for each analysis, so that its readers in one language share one
 * object.
 */
const states = new WeakMap<TextAnalysis, AnalysisState>();

function stateOf(analysis: TextAnalysis, analysisLanguage: string): AnalysisState {
  const kept = states.get(analysis);
  if (kept?.analysisLanguage === analysisLanguage) return kept;
  const state = { analysis, analysisLanguage };
  states.set(analysis, state);
  return state;
}

/** A source of analysis that tells its listeners when what it holds changes. */
type AnalysisSource = Readonly<{
  subscribe: (listener: () => void) => () => void;
  read: () => TextAnalysis;
}>;

/**
 * Reads `select` over what `source` holds, again whenever it changes. Keeps the previous answer
 * while `isEqual` judges the new answer equal, so the caller re-renders only when the answer
 * changes.
 */
function useSourceSelector<T>(
  source: AnalysisSource,
  analysisLanguage: string,
  select: (state: AnalysisState) => T,
  isEqual: (a: T, b: T) => boolean,
): T {
  const last = useRef<{ value: T } | undefined>(undefined);
  const getSnapshot = () => {
    const value = select(stateOf(source.read(), analysisLanguage));
    if (last.current && isEqual(last.current.value, value)) return last.current.value;
    last.current = { value };
    return value;
  };
  return useSyncExternalStore(source.subscribe, getSnapshot);
}

/** @throws When called outside a {@link PageClientProvider}. */
function usePageContext(): PageContext {
  const context = useContext(PageClientContext);
  if (!context) throw new Error('Interlinearizer: page hooks need a PageClientProvider');
  return context;
}

/**
 * Reads `select` over the records that the page client holds, re-rendering the caller only when the
 * answer changes, as `isEqual` judges it.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function usePageSelector<T>(
  select: (state: AnalysisState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const { client, analysisLanguage } = usePageContext();
  const source = useMemo(
    () => ({
      subscribe: (listener: () => void) => client.subscribe(listener),
      read: () => client.heldAnalysis(),
    }),
    [client],
  );
  return useSourceSelector(source, analysisLanguage, select, isEqual);
}

/**
 * Reads `select` over the records that the page client holds and the suggestion pool of the forms
 * held. Re-renders the caller only when the answer changes, as `isEqual` judges it.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function usePagePoolSelector<T>(
  select: (state: AnalysisState, pool: PoolIndex) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const { client } = usePageContext();
  return usePageSelector((state) => select(state, client.poolIndex()), isEqual);
}

/**
 * Reads `select` over the session's whole analysis, re-rendering the caller only when the answer
 * changes, as `isEqual` judges it.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function useWholeSelector<T>(
  select: (state: AnalysisState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const { whole, analysisLanguage } = usePageContext();
  const source = useMemo(
    () => ({
      subscribe: (listener: () => void) => whole.subscribe(listener),
      read: () => whole.current,
    }),
    [whole],
  );
  return useSourceSelector(source, analysisLanguage, select, isEqual);
}

/**
 * Returns a getter of the session's whole analysis and language, as they stand when the getter is
 * called.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function useWholeStateGetter(): () => AnalysisState {
  const { whole, analysisLanguage } = usePageContext();
  return useCallback(() => stateOf(whole.current, analysisLanguage), [whole, analysisLanguage]);
}

/**
 * Returns a getter of the records that the page client holds and the session's language, as they
 * stand when the getter is called.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function usePageStateGetter(): () => AnalysisState {
  const { client, analysisLanguage } = usePageContext();
  return useCallback(
    () => stateOf(client.heldAnalysis(), analysisLanguage),
    [client, analysisLanguage],
  );
}

/**
 * Returns a function that sends an edit to the session through the page client, which applies the
 * reply. The function hands `call` the session's id and a change id that the client mints, and
 * expects the reply's JSON back.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function useSessionEdit(): (
  call: (args: SessionEditArgs) => Promise<string | undefined>,
) => Promise<CommandReply | undefined> {
  const { client, sessionId } = usePageContext();
  return useCallback(
    (call) =>
      client.send(async (changeId) => {
        const reply = await call({ sessionId, changeId });
        return reply === undefined ? undefined : JSON.parse(reply);
      }),
    [client, sessionId],
  );
}

/**
 * The session that the nearest {@link PageClientProvider} serves.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function usePageSession(): Pick<PageContext, 'whole' | 'sessionId' | 'analysisLanguage'> {
  const { whole, sessionId, analysisLanguage } = usePageContext();
  return useMemo(
    () => ({ whole, sessionId, analysisLanguage }),
    [whole, sessionId, analysisLanguage],
  );
}

/**
 * How many command replies the client has applied while the caller has been mounted, re-rendering
 * the caller with each.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function useRepliesApplied(): number {
  const { client } = usePageContext();
  const [count, setCount] = useState(0);
  useEffect(() => client.subscribeReplies(() => setCount((was) => was + 1)), [client]);
  return count;
}
