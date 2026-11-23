import type { MultiString, SenseRef } from 'interlinearizer';
import type { SenseCandidate, SenseQuery } from 'interlinearizer/lexicon';
import { BookAlert, BookOpen, TextSearch } from 'lucide-react';
import {
  Button,
  Checkbox,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioGroup,
  RadioGroupItem,
  Spinner,
} from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useLexiconSearch, useLinkedGloss, type LinkedGloss } from './LexiconSenses';
import LocalizedTooltip from './LocalizedTooltip';
import { ModalShell } from './modals/ModalShell';
import { multiStringTextByLanguage } from '../utils/multi-string';

/** Localized string keys a {@link CatalogSenseControl} renders. */
export const SENSE_CONTROL_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_senseLinked%',
  '%interlinearizer_analysisCatalog_senseGloss%',
  '%interlinearizer_analysisCatalog_senseDiffers%',
  '%interlinearizer_analysisCatalog_noGloss%',
  '%interlinearizer_analysisCatalog_senseAddLink%',
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
  '%interlinearizer_analysisCatalog_senseQueryFormContains%',
  '%interlinearizer_analysisCatalog_senseQueryFormExact%',
  '%interlinearizer_analysisCatalog_senseQueryGlossContains%',
  '%interlinearizer_analysisCatalog_senseQueryGlossExact%',
  '%interlinearizer_analysisCatalog_senseRefine%',
  '%interlinearizer_analysisCatalog_senseRefineTitle%',
  '%interlinearizer_analysisCatalog_senseRefineText%',
  '%interlinearizer_analysisCatalog_senseRefineField%',
  '%interlinearizer_analysisCatalog_senseRefineForm%',
  '%interlinearizer_analysisCatalog_senseRefineGloss%',
  '%interlinearizer_analysisCatalog_senseRefineExact%',
  '%interlinearizer_analysisCatalog_senseRefineSubmit%',
] as const satisfies `%${string}%`[];

/** What the popover is showing. */
type View = 'menu' | 'search' | 'confirmUnlink';

/** How a candidate search stands. */
type SearchOutcome =
  | { status: 'pending' }
  | { status: 'failed' }
  | { status: 'found'; candidates: readonly SenseCandidate[] };

/** The wording that says what a query matches, by the field it searches and whether it is exact. */
const QUERY_LABEL_KEYS = {
  form: {
    contains: '%interlinearizer_analysisCatalog_senseQueryFormContains%',
    exact: '%interlinearizer_analysisCatalog_senseQueryFormExact%',
  },
  gloss: {
    contains: '%interlinearizer_analysisCatalog_senseQueryGlossContains%',
    exact: '%interlinearizer_analysisCatalog_senseQueryGlossExact%',
  },
} as const satisfies Record<SenseQuery['field'], Record<'contains' | 'exact', string>>;

/** Says what `query` matches, so a search the user changed is not mistaken for the default one. */
function queryLabel(query: SenseQuery, localizedStrings: LanguageStrings): string {
  return formatReplacementString(
    localizedStrings[QUERY_LABEL_KEYS[query.field][query.exact ? 'exact' : 'contains']],
    { text: query.text, language: query.writingSystem ?? '' },
  );
}

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

/** The senses the lexicon has for `query`, listed to pick from. */
function SearchView({
  query,
  search,
  senseRef,
  analysisLanguage,
  localizedStrings,
  onPick,
  onRefine,
  onBack,
}: Readonly<{
  query: SenseQuery;
  search: (query: SenseQuery) => Promise<SenseCandidate[]>;
  /** The sense the form links to now, which the list marks. */
  senseRef?: SenseRef;
  analysisLanguage: string;
  localizedStrings: LanguageStrings;
  onPick: (candidate: SenseCandidate) => void;
  /** Asks to change what the search matches. */
  onRefine: () => void;
  /** Returns to the menu; without it, the view offers no way back. */
  onBack?: () => void;
}>) {
  // Kept with the query it answers, so the view reads as pending while a newer query is out.
  const [answer, setAnswer] = useState<{ query: SenseQuery; outcome: SearchOutcome }>();
  const outcome: SearchOutcome = answer?.query === query ? answer.outcome : { status: 'pending' };

  useEffect(() => {
    let abandoned = false;
    (async () => {
      try {
        const candidates = await search(query);
        if (!abandoned) setAnswer({ query, outcome: { status: 'found', candidates } });
      } catch {
        if (!abandoned) setAnswer({ query, outcome: { status: 'failed' } });
      }
    })();
    return () => {
      abandoned = true;
    };
  }, [query, search]);

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

  const refineLabel = localizedStrings['%interlinearizer_analysisCatalog_senseRefine%'];
  return (
    <>
      {onBack && (
        <Button className="tw:justify-start" size="sm" variant="ghost" onClick={onBack}>
          {localizedStrings['%interlinearizer_analysisCatalog_senseBack%']}
        </Button>
      )}
      <div className="tw:flex tw:items-center tw:gap-1">
        <p
          className="tw:min-w-0 tw:flex-1 tw:break-words tw:text-xs tw:text-muted-foreground"
          data-testid="catalog-sense-query"
        >
          {queryLabel(query, localizedStrings)}
        </p>
        <LocalizedTooltip label={refineLabel}>
          <Button
            aria-label={refineLabel}
            className="tw:shrink-0"
            data-testid="catalog-sense-refine"
            size="icon-xs"
            variant="ghost"
            onClick={onRefine}
          >
            <TextSearch aria-hidden="true" className="tw:size-3" />
          </Button>
        </LocalizedTooltip>
      </div>
      {body}
    </>
  );
}

/**
 * Asks what a sense search should match: which text, whether in an entry's form or in a sense's
 * gloss, and whether whole or in part. It opens on the search the popover shows. Glosses are
 * searched in `analysisLanguage` alone.
 */
function SenseQueryDialog({
  query,
  analysisLanguage,
  localizedStrings,
  onSubmit,
  onClose,
}: Readonly<{
  query: SenseQuery;
  analysisLanguage: string;
  localizedStrings: LanguageStrings;
  onSubmit: (query: SenseQuery) => void;
  onClose: () => void;
}>) {
  const [text, setText] = useState(query.text);
  const [field, setField] = useState(query.field);
  const [exact, setExact] = useState(query.exact);
  const id = useId();
  const trimmed = text.trim();

  return (
    <ModalShell
      title={localizedStrings['%interlinearizer_analysisCatalog_senseRefineTitle%']}
      titleTestId="catalog-sense-refine-title"
      width="tw:w-80"
      onClose={onClose}
    >
      <form
        className="tw:flex tw:flex-col tw:gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            text: trimmed,
            field,
            exact,
            ...(field === 'gloss' && { writingSystem: analysisLanguage }),
          });
        }}
      >
        <div className="tw:flex tw:flex-col tw:gap-1">
          <Label htmlFor={`${id}-text`}>
            {localizedStrings['%interlinearizer_analysisCatalog_senseRefineText%']}
          </Label>
          <Input id={`${id}-text`} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <RadioGroup
          aria-label={localizedStrings['%interlinearizer_analysisCatalog_senseRefineField%']}
          className="tw:flex tw:gap-4"
          value={field}
          onValueChange={(value) => setField(value === 'gloss' ? 'gloss' : 'form')}
        >
          <div className="tw:flex tw:items-center tw:gap-2 tw:text-sm">
            <RadioGroupItem id={`${id}-form`} value="form" />
            <Label htmlFor={`${id}-form`}>
              {localizedStrings['%interlinearizer_analysisCatalog_senseRefineForm%']}
            </Label>
          </div>
          <div className="tw:flex tw:items-center tw:gap-2 tw:text-sm">
            <RadioGroupItem id={`${id}-gloss`} value="gloss" />
            <Label htmlFor={`${id}-gloss`}>
              {formatReplacementString(
                localizedStrings['%interlinearizer_analysisCatalog_senseRefineGloss%'],
                { language: analysisLanguage },
              )}
            </Label>
          </div>
        </RadioGroup>
        <div className="tw:flex tw:items-center tw:gap-2 tw:text-sm">
          <Checkbox
            checked={exact}
            id={`${id}-exact`}
            onCheckedChange={(checked) => setExact(checked === true)}
          />
          <Label htmlFor={`${id}-exact`}>
            {localizedStrings['%interlinearizer_analysisCatalog_senseRefineExact%']}
          </Label>
        </div>
        <div className="tw:modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            {localizedStrings['%interlinearizer_analysisCatalog_senseCancel%']}
          </Button>
          <Button disabled={trimmed === ''} type="submit">
            {localizedStrings['%interlinearizer_analysisCatalog_senseRefineSubmit%']}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

/**
 * The control for the lexicon link of one analysis or morpheme, set beside its form. Its icon shows
 * whether the form is linked. On a linked form, the icon opens actions that change or drop the
 * link, and that adopt the sense's gloss as the typed gloss. On an unlinked form, the icon opens
 * the sense search at once, because linking is the only action. Where there is nothing to do, a
 * linked form shows only the mark, and an unlinked one shows nothing.
 *
 * The search first looks for entries whose form contains `form`, so a form with no text cannot be
 * linked. The user can then change the text, search glosses instead, or ask for an exact match.
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
  const [editedQuery, setEditedQuery] = useState<SenseQuery>();
  const [refining, setRefining] = useState(false);
  const formQuery = useMemo<SenseQuery>(
    () => ({ text: form, field: 'form', exact: false }),
    [form],
  );
  const query = editedQuery ?? formQuery;

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
  const showMenu = () => {
    setView('menu');
    setEditedQuery(undefined);
    setRefining(false);
  };
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) showMenu();
  };
  const close = () => handleOpenChange(false);

  let content: ReactNode;
  if ((view === 'search' || !linked) && search)
    content = (
      <>
        <SearchView
          analysisLanguage={analysisLanguage}
          localizedStrings={localizedStrings}
          query={query}
          search={search}
          senseRef={senseRef}
          onBack={linked ? showMenu : undefined}
          onPick={(candidate) => {
            onLink(candidate);
            close();
          }}
          onRefine={() => setRefining(true)}
        />
        {refining && (
          <SenseQueryDialog
            analysisLanguage={analysisLanguage}
            localizedStrings={localizedStrings}
            query={query}
            onClose={() => setRefining(false)}
            onSubmit={(next) => {
              setEditedQuery(next);
              setRefining(false);
            }}
          />
        )}
      </>
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
            {localizedStrings['%interlinearizer_analysisCatalog_senseChangeAction%']}
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
          // The search dialog lies outside the popover, so focus leaves the popover when the dialog
          // opens. The popover stays open regardless, to show what the dialog's search finds.
          onInteractOutside={(event) => {
            if (refining) event.preventDefault();
          }}
        >
          {content}
        </PopoverContent>
      )}
    </Popover>
  );
}
