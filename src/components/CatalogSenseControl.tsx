import type { MultiString, SenseRef } from 'interlinearizer';
import type { SenseCandidate } from 'interlinearizer/lexicon';
import { BookAlert, BookOpen } from 'lucide-react';
import {
  Button,
  DisabledActionTooltip,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
} from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  useEntrySenses,
  useLexiconSearch,
  useLinkedGloss,
  type LinkedGloss,
} from './LexiconSenses';
import LocalizedTooltip from './LocalizedTooltip';
import { multiStringTextByLanguage } from '../utils/multi-string';

/** Localized string keys a {@link CatalogSenseControl} renders. */
export const SENSE_CONTROL_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_senseLinked%',
  '%interlinearizer_analysisCatalog_senseGloss%',
  '%interlinearizer_analysisCatalog_senseDiffers%',
  '%interlinearizer_analysisCatalog_noGloss%',
  '%interlinearizer_analysisCatalog_senseAddLink%',
  '%interlinearizer_analysisCatalog_senseLinkAction%',
  '%interlinearizer_analysisCatalog_senseChangeAction%',
  '%interlinearizer_analysisCatalog_senseNoOther%',
  '%interlinearizer_analysisCatalog_senseAdoptGloss%',
  '%interlinearizer_analysisCatalog_senseUnlink%',
  '%interlinearizer_analysisCatalog_senseLexiconGloss%',
  '%interlinearizer_analysisCatalog_senseNoMatch%',
  '%interlinearizer_analysisCatalog_senseSearchFailed%',
  '%interlinearizer_analysisCatalog_senseBack%',
  '%interlinearizer_analysisCatalog_senseCurrent%',
  '%interlinearizer_analysisCatalog_senseKeepPrompt%',
  '%interlinearizer_analysisCatalog_senseKeepGloss%',
  '%interlinearizer_analysisCatalog_senseRemoveGloss%',
  '%interlinearizer_analysisCatalog_senseCancel%',
] as const satisfies `%${string}%`[];

/** What the popover is showing. */
type View = 'menu' | 'search' | 'confirmUnlink';

/** Fetches the senses to pick from, `undefined` meaning there are none. */
type FindCandidates = () => Promise<SenseCandidate[] | undefined>;

/** How fetching the candidates stands. */
type SearchOutcome =
  | { status: 'pending' }
  | { status: 'failed' }
  | { status: 'found'; candidates: readonly SenseCandidate[] };

/** What the control says about `link`: what the sense's gloss is, or that the link exists. */
function linkLabel(link: LinkedGloss, localizedStrings: LanguageStrings): string {
  if (link.differs)
    return formatReplacementString(
      localizedStrings['%interlinearizer_analysisCatalog_senseDiffers%'],
      { gloss: link.senseGloss },
    );
  if (link.fromLexicon) return localizedStrings['%interlinearizer_analysisCatalog_senseGloss%'];
  return localizedStrings['%interlinearizer_analysisCatalog_senseLinked%'];
}

/** The icon for a link, which flags a typed gloss that differs from the sense's. */
function linkIcon(link: LinkedGloss) {
  return link.differs ? BookAlert : BookOpen;
}

/**
 * Reads the text a {@link MultiString} holds, in `language` where it has any and otherwise in
 * whichever writing system does.
 */
function anyText(value: MultiString | undefined, language: string): string {
  return (
    multiStringTextByLanguage(value, language) ||
    Object.values(value ?? {}).find((text) => text.trim() !== '') ||
    ''
  );
}

/** Whether two refs name the same sense. */
function sameSense(a: SenseRef | undefined, b: SenseRef): boolean {
  return (
    a !== undefined &&
    a.authority === b.authority &&
    a.projectId === b.projectId &&
    a.senseId === b.senseId
  );
}

/** A link that offers nothing to do, showing the link's state as a mark. */
function StaticMark({
  link,
  label,
  style,
  className,
}: Readonly<{ link: LinkedGloss; label: string; style?: CSSProperties; className?: string }>) {
  const Icon = linkIcon(link);
  return (
    <LocalizedTooltip label={label}>
      <span
        className={`tw:flex tw:shrink-0 tw:items-center tw:justify-center tw:text-foreground${className ? ` ${className}` : ''}`}
        data-differs={String(link.differs)}
        data-from-lexicon={String(link.fromLexicon)}
        data-testid="catalog-sense-link"
        style={style}
      >
        <Icon aria-hidden="true" className="tw:size-3" />
        <span className="tw:sr-only">{` ${label}`}</span>
      </span>
    </LocalizedTooltip>
  );
}

/** One sense the search turned up, to pick. */
function CandidateButton({
  candidate,
  current,
  analysisLanguage,
  localizedStrings,
  onPick,
}: Readonly<{
  candidate: SenseCandidate;
  /** Whether the candidate is the sense the form links to already. */
  current: boolean;
  analysisLanguage: string;
  localizedStrings: LanguageStrings;
  onPick: () => void;
}>) {
  const gloss =
    anyText(candidate.gloss, analysisLanguage) ||
    localizedStrings['%interlinearizer_analysisCatalog_noGloss%'];
  const detail = [
    anyText(candidate.lexemeForm, analysisLanguage),
    candidate.senseLabel ?? '',
    anyText(candidate.definition, analysisLanguage),
  ].filter((part) => part !== '');
  return (
    <Button
      aria-current={current ? 'true' : undefined}
      className="tw:h-auto tw:flex-col tw:items-start tw:gap-0 tw:py-1 tw:text-start"
      data-testid="catalog-sense-candidate"
      variant="ghost"
      onClick={onPick}
    >
      <span className="tw:flex tw:items-baseline tw:gap-1.5">
        <span className="tw:font-medium">{gloss}</span>
        {current && (
          <span className="tw:text-xs tw:text-muted-foreground">
            {localizedStrings['%interlinearizer_analysisCatalog_senseCurrent%']}
          </span>
        )}
      </span>
      {detail.length > 0 && (
        <span className="tw:text-xs tw:font-normal tw:text-muted-foreground">
          {detail.join(' · ')}
        </span>
      )}
    </Button>
  );
}

/**
 * Fetches the senses to pick from through `find`. The outcome shows only an answer from the current
 * `find`, fetched since the last `retry`. Until such an answer arrives, the outcome reads pending.
 * Without `find`, the outcome stays pending.
 *
 * @returns The outcome, and `retry`, which fetches again.
 */
function useCandidates(find: FindCandidates | undefined): {
  outcome: SearchOutcome;
  retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{
    find: FindCandidates;
    attempt: number;
    outcome: SearchOutcome;
  }>();

  useEffect(() => {
    if (!find) return undefined;
    let abandoned = false;
    (async () => {
      let outcome: SearchOutcome;
      try {
        outcome = { status: 'found', candidates: (await find()) ?? [] };
      } catch {
        outcome = { status: 'failed' };
      }
      if (!abandoned) setAnswer({ find, attempt, outcome });
    })();
    return () => {
      abandoned = true;
    };
  }, [find, attempt]);

  const current = find !== undefined && answer?.find === find && answer.attempt === attempt;
  return {
    outcome: current ? answer.outcome : { status: 'pending' },
    retry: () => setAttempt((previous) => previous + 1),
  };
}

/** Lists the fetched senses to pick from. */
function SearchView({
  outcome,
  senseRef,
  analysisLanguage,
  localizedStrings,
  onPick,
  onBack,
}: Readonly<{
  outcome: SearchOutcome;
  /** The sense the form links to now, which the list marks. */
  senseRef?: SenseRef;
  analysisLanguage: string;
  localizedStrings: LanguageStrings;
  onPick: (candidate: SenseCandidate) => void;
  onBack: () => void;
}>) {
  let body: ReactNode;
  if (outcome.status === 'pending') body = <Spinner className="tw:size-4" />;
  else if (outcome.status === 'failed')
    body = (
      <p className="tw:text-sm" data-testid="catalog-sense-search-failed">
        {localizedStrings['%interlinearizer_analysisCatalog_senseSearchFailed%']}
      </p>
    );
  else if (outcome.candidates.length === 0)
    body = (
      <p className="tw:text-sm" data-testid="catalog-sense-no-match">
        {localizedStrings['%interlinearizer_analysisCatalog_senseNoMatch%']}
      </p>
    );
  else
    body = (
      <div className="tw:flex tw:flex-col tw:gap-0.5">
        {outcome.candidates.map((candidate) => (
          <CandidateButton
            analysisLanguage={analysisLanguage}
            candidate={candidate}
            current={sameSense(senseRef, candidate.senseRef)}
            key={`${candidate.senseRef.authority}/${candidate.senseRef.projectId ?? ''}/${candidate.senseRef.senseId}`}
            localizedStrings={localizedStrings}
            onPick={() => onPick(candidate)}
          />
        ))}
      </div>
    );

  return (
    <>
      <Button className="tw:justify-start" size="sm" variant="ghost" onClick={onBack}>
        {localizedStrings['%interlinearizer_analysisCatalog_senseBack%']}
      </Button>
      {body}
    </>
  );
}

/**
 * The contents of the control's popover: the actions on the link, the senses to pick from, or the
 * question of what to keep on unlinking.
 *
 * The candidates are fetched as the popover opens. The change of sense is disabled when the linked
 * sense's entry has no other sense.
 */
function PopoverBody({
  find,
  senseRef,
  link,
  canPick,
  canUnlink,
  canAdopt,
  analysisLanguage,
  localizedStrings,
  onLink,
  onUnlink,
  onAdopt,
  onClose,
}: Readonly<{
  /** Fetches the senses to link to, or to change the link to. */
  find: FindCandidates | undefined;
  senseRef?: SenseRef;
  link: LinkedGloss;
  /** Whether the action that links, or changes the link, is offered. */
  canPick: boolean;
  canUnlink: boolean;
  canAdopt: boolean;
  analysisLanguage: string;
  localizedStrings: LanguageStrings;
  onLink: (candidate: SenseCandidate) => void;
  onUnlink: (keepGloss?: string) => void;
  onAdopt: (senseGloss: string) => void;
  onClose: () => void;
}>) {
  const [view, setView] = useState<View>('menu');
  const { outcome, retry } = useCandidates(find);

  const linked = senseRef !== undefined;
  const noOther =
    linked &&
    outcome.status === 'found' &&
    outcome.candidates.every((candidate) => sameSense(senseRef, candidate.senseRef));

  let content: ReactNode;
  if (view === 'search' && canPick)
    content = (
      <SearchView
        analysisLanguage={analysisLanguage}
        localizedStrings={localizedStrings}
        outcome={outcome}
        senseRef={senseRef}
        onBack={() => setView('menu')}
        onPick={(candidate) => {
          onLink(candidate);
          onClose();
        }}
      />
    );
  else if (view === 'confirmUnlink')
    content = (
      <>
        <p className="tw:text-sm" data-testid="catalog-sense-keep-prompt">
          {formatReplacementString(
            localizedStrings['%interlinearizer_analysisCatalog_senseKeepPrompt%'],
            { gloss: link.senseGloss },
          )}
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onUnlink(link.senseGloss);
            onClose();
          }}
        >
          {localizedStrings['%interlinearizer_analysisCatalog_senseKeepGloss%']}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onUnlink();
            onClose();
          }}
        >
          {localizedStrings['%interlinearizer_analysisCatalog_senseRemoveGloss%']}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setView('menu')}>
          {localizedStrings['%interlinearizer_analysisCatalog_senseCancel%']}
        </Button>
      </>
    );
  else
    content = (
      <>
        {linked && link.senseGloss !== '' && (
          <p className="tw:text-sm" data-testid="catalog-sense-menu-gloss">
            {formatReplacementString(
              localizedStrings['%interlinearizer_analysisCatalog_senseLexiconGloss%'],
              { gloss: link.senseGloss },
            )}
          </p>
        )}
        {canPick && (
          <DisabledActionTooltip
            className="tw:flex tw:flex-col"
            disabled={noOther}
            tooltipText={localizedStrings['%interlinearizer_analysisCatalog_senseNoOther%']}
          >
            <Button
              className="tw:justify-start"
              disabled={noOther}
              size="sm"
              variant="ghost"
              onClick={() => {
                if (outcome.status === 'failed') retry();
                setView('search');
              }}
            >
              {
                localizedStrings[
                  linked
                    ? '%interlinearizer_analysisCatalog_senseChangeAction%'
                    : '%interlinearizer_analysisCatalog_senseLinkAction%'
                ]
              }
            </Button>
          </DisabledActionTooltip>
        )}
        {canAdopt && (
          <Button
            className="tw:justify-start"
            size="sm"
            variant="ghost"
            onClick={() => {
              onAdopt(link.senseGloss);
              onClose();
            }}
          >
            {localizedStrings['%interlinearizer_analysisCatalog_senseAdoptGloss%']}
          </Button>
        )}
        {canUnlink && (
          <Button
            className="tw:justify-start"
            size="sm"
            variant="ghost"
            onClick={() => {
              if (link.fromLexicon) {
                setView('confirmUnlink');
                return;
              }
              onUnlink();
              onClose();
            }}
          >
            {localizedStrings['%interlinearizer_analysisCatalog_senseUnlink%']}
          </Button>
        )}
      </>
    );

  return content;
}

/**
 * The control for the lexicon link of one analysis or morpheme, set beside its form. Its icon shows
 * whether the form is linked. The icon opens actions that link, change, or drop the link, and that
 * adopt the sense's gloss as the typed gloss. Where there is nothing to do, a linked form shows
 * only the mark, and an unlinked one shows nothing.
 *
 * An unlinked form links to a sense that a search by `form` turns up, so a form with no text cannot
 * be linked. A linked form changes to another sense of the linked sense's entry. Linking it to
 * another entry means unlinking it first.
 */
export default function CatalogSenseControl({
  form,
  gloss,
  senseRef,
  analysisLanguage,
  readOnly,
  onLink,
  onUnlink,
  onAdopt,
  localizedStrings,
  style,
  className,
}: Readonly<{
  /** The word or morpheme form the control sits beside; '' is never linkable. */
  form: string;
  /** The typed gloss in `analysisLanguage`, '' when there is none. */
  gloss: string;
  senseRef?: SenseRef;
  /** BCP 47 tag the glosses are compared and shown in. */
  analysisLanguage: string;
  readOnly: boolean;
  /** Links the form to the picked candidate, replacing any link. */
  onLink: (candidate: SenseCandidate) => void;
  /** Drops the link; `keepGloss` is the sense gloss to keep as the typed gloss. */
  onUnlink: (keepGloss?: string) => void;
  /** Writes the sense's gloss as the typed gloss. */
  onAdopt: (senseGloss: string) => void;
  /** Resolved localizations covering at least {@link SENSE_CONTROL_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
  /** Inline style for the control's element, such as its grid placement. */
  style?: CSSProperties;
  className?: string;
}>): ReactElement | undefined {
  const link = useLinkedGloss(gloss, senseRef, analysisLanguage);
  const search = useLexiconSearch();
  const listEntrySenses = useEntrySenses();
  const [open, setOpen] = useState(false);
  // eslint-disable-next-line no-null/no-null
  const menuRef = useRef<HTMLDivElement>(null);

  const linked = senseRef !== undefined;
  const canLink = !readOnly && !linked && search !== undefined && form !== '';
  const canChange = !readOnly && link.senseFound;
  const canUnlink = !readOnly && linked && link.lexiconAnswered;
  const canAdopt =
    !readOnly && linked && link.senseGloss !== '' && (link.fromLexicon || link.differs);

  const findToLink = useMemo(
    () => (canLink && search ? () => search(form) : undefined),
    [canLink, search, form],
  );
  const findToChange = useMemo(
    () => (canChange && senseRef ? () => listEntrySenses(senseRef) : undefined),
    [canChange, senseRef, listEntrySenses],
  );

  if (!linked && !canLink) return undefined;

  const label = linked
    ? linkLabel(link, localizedStrings)
    : localizedStrings['%interlinearizer_analysisCatalog_senseAddLink%'];
  if (!canLink && !canChange && !canUnlink && !canAdopt)
    return <StaticMark className={className} label={label} link={link} style={style} />;

  const Icon = linked ? linkIcon(link) : BookOpen;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <LocalizedTooltip label={label}>
        <PopoverTrigger asChild>
          <Button
            aria-label={label}
            className={`tw:shrink-0 tw:justify-self-center ${linked ? 'tw:text-foreground' : 'tw:text-muted-foreground/50'}${className ? ` ${className}` : ''}`}
            data-testid="catalog-sense-control"
            size="icon-xs"
            style={style}
            variant="ghost"
          >
            <Icon aria-hidden="true" className="tw:size-3" />
          </Button>
        </PopoverTrigger>
      </LocalizedTooltip>
      {open && (
        <PopoverContent
          align="start"
          className="tw:w-72 tw:p-2"
          data-testid="catalog-sense-popover"
          onOpenAutoFocus={(event) => {
            // Opening focuses the menu rather than its first action. A disabled action's
            // explanation shows on focus, and would otherwise cover the menu whenever that action
            // is disabled.
            event.preventDefault();
            menuRef.current?.focus();
          }}
        >
          <div
            className="tw:flex tw:flex-col tw:gap-1 tw:outline-none"
            data-testid="catalog-sense-menu"
            ref={menuRef}
            tabIndex={-1}
          >
            <PopoverBody
              analysisLanguage={analysisLanguage}
              canAdopt={canAdopt}
              canPick={canLink || canChange}
              canUnlink={canUnlink}
              find={linked ? findToChange : findToLink}
              link={link}
              localizedStrings={localizedStrings}
              senseRef={senseRef}
              onAdopt={onAdopt}
              onClose={() => setOpen(false)}
              onLink={onLink}
              onUnlink={onUnlink}
            />
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}
