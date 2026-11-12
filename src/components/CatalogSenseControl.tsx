import type { MultiString, SenseRef } from 'interlinearizer';
import type { SenseCandidate } from 'interlinearizer/lexicon';
import { BookAlert, BookOpen } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger, Spinner } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { useLexiconSearch, useLinkedGloss, type LinkedGloss } from './LexiconSenses';
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

/** How a candidate search stands. */
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

/** The senses the lexicon has for `form`, listed to pick from. */
function SearchView({
  form,
  search,
  senseRef,
  analysisLanguage,
  localizedStrings,
  onPick,
  onBack,
}: Readonly<{
  form: string;
  search: (form: string) => Promise<SenseCandidate[]>;
  /** The sense the form links to now, which the list marks. */
  senseRef?: SenseRef;
  analysisLanguage: string;
  localizedStrings: LanguageStrings;
  onPick: (candidate: SenseCandidate) => void;
  onBack: () => void;
}>) {
  const [outcome, setOutcome] = useState<SearchOutcome>({ status: 'pending' });

  useEffect(() => {
    let abandoned = false;
    (async () => {
      try {
        const candidates = await search(form);
        if (!abandoned) setOutcome({ status: 'found', candidates });
      } catch {
        if (!abandoned) setOutcome({ status: 'failed' });
      }
    })();
    return () => {
      abandoned = true;
    };
  }, [form, search]);

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
 * The control for one analysis or morpheme's lexicon link, set beside the form it links: an icon
 * that shows whether the form is linked, and opens the actions that link, change, or drop the link
 * and that take the sense's gloss as the typed gloss. Where there is nothing to do, a linked form
 * shows only the mark, and an unlinked one shows nothing.
 *
 * The link is looked up from `form` as it stands, so a form with no text cannot be linked.
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
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('menu');

  const linked = senseRef !== undefined;
  const canLink = !readOnly && search !== undefined && form !== '';
  const canUnlink = !readOnly && linked && link.lexiconAnswered;
  const canAdopt =
    !readOnly && linked && link.senseGloss !== '' && (link.fromLexicon || link.differs);

  if (!linked && !canLink) return undefined;

  const label = linked
    ? linkLabel(link, localizedStrings)
    : localizedStrings['%interlinearizer_analysisCatalog_senseAddLink%'];
  if (!canLink && !canUnlink && !canAdopt)
    return <StaticMark className={className} label={label} link={link} style={style} />;

  const Icon = linked ? linkIcon(link) : BookOpen;
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setView('menu');
  };
  const close = () => handleOpenChange(false);

  let content: ReactNode;
  if (view === 'search' && search)
    content = (
      <SearchView
        analysisLanguage={analysisLanguage}
        form={form}
        localizedStrings={localizedStrings}
        search={search}
        senseRef={senseRef}
        onBack={() => setView('menu')}
        onPick={(candidate) => {
          onLink(candidate);
          close();
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
            close();
          }}
        >
          {localizedStrings['%interlinearizer_analysisCatalog_senseKeepGloss%']}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onUnlink();
            close();
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
        {canLink && (
          <Button
            className="tw:justify-start"
            size="sm"
            variant="ghost"
            onClick={() => setView('search')}
          >
            {
              localizedStrings[
                linked
                  ? '%interlinearizer_analysisCatalog_senseChangeAction%'
                  : '%interlinearizer_analysisCatalog_senseLinkAction%'
              ]
            }
          </Button>
        )}
        {canAdopt && (
          <Button
            className="tw:justify-start"
            size="sm"
            variant="ghost"
            onClick={() => {
              onAdopt(link.senseGloss);
              close();
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
              close();
            }}
          >
            {localizedStrings['%interlinearizer_analysisCatalog_senseUnlink%']}
          </Button>
        )}
      </>
    );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
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
          className="tw:flex tw:w-72 tw:flex-col tw:gap-1 tw:p-2"
          data-testid="catalog-sense-popover"
        >
          {content}
        </PopoverContent>
      )}
    </Popover>
  );
}
