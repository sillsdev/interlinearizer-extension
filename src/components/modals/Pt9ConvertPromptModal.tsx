import { useLocalizedStrings } from '@papi/frontend/react';
import { Button, Spinner } from 'platform-bible-react';
import { ModalShell } from './ModalShell';

/** Localized string keys requested for this modal's rendered text. */
const PT9_CONVERT_PROMPT_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_pt9ImportModal_title%',
  '%interlinearizer_pt9ConvertPrompt_message%',
  '%interlinearizer_pt9ConvertPrompt_yes%',
  '%interlinearizer_pt9ConvertPrompt_no%',
  '%interlinearizer_pt9ConvertPrompt_checking%',
];

/**
 * Transient status shown when the first-open data probe stays unanswered long enough to need an
 * indication. Not dismissable: the probe always settles, and this dialog leaves with it.
 */
export function Pt9CheckingModal() {
  const [localizedStrings] = useLocalizedStrings(PT9_CONVERT_PROMPT_STRING_KEYS);

  return (
    <ModalShell
      titleTestId="pt9-checking-modal-title"
      title={localizedStrings['%interlinearizer_pt9ImportModal_title%']}
      width="tw:w-96"
    >
      <div className="tw:flex tw:items-center tw:gap-2" data-testid="pt9-checking">
        <Spinner className="tw:size-4" />
        <span className="tw:text-sm tw:text-muted-foreground">
          {localizedStrings['%interlinearizer_pt9ConvertPrompt_checking%']}
        </span>
      </div>
    </ModalShell>
  );
}

/**
 * First-open offer to convert the source project's Paratext 9 interlinear data. Yes runs the
 * import, whose result becomes the only project created; No continues into the empty draft exactly
 * as an open does today. Dismissing the dialog (Escape or a click outside) means No.
 */
export function Pt9ConvertPromptModal({
  onYes,
  onNo,
}: Readonly<{ onYes: () => void; onNo: () => void }>) {
  const [localizedStrings] = useLocalizedStrings(PT9_CONVERT_PROMPT_STRING_KEYS);

  return (
    <ModalShell
      titleTestId="pt9-convert-prompt-title"
      title={localizedStrings['%interlinearizer_pt9ImportModal_title%']}
      width="tw:w-96"
      onClose={onNo}
    >
      <p className="tw:mb-4" data-testid="pt9-convert-prompt-message">
        {localizedStrings['%interlinearizer_pt9ConvertPrompt_message%']}
      </p>
      <div className="tw:flex tw:justify-end tw:gap-2">
        <Button variant="outline" onClick={onNo}>
          {localizedStrings['%interlinearizer_pt9ConvertPrompt_no%']}
        </Button>
        <Button onClick={onYes}>
          {localizedStrings['%interlinearizer_pt9ConvertPrompt_yes%']}
        </Button>
      </div>
    </ModalShell>
  );
}
