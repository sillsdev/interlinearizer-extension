import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';
import { ModalShell } from './ModalShell';

/** Localized string keys requested for this modal's rendered text. */
const PT9_READ_ONLY_INTRO_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_pt9ReadOnlyIntro_title%',
  '%interlinearizer_pt9ReadOnlyIntro_origin%',
  '%interlinearizer_pt9ReadOnlyIntro_howToEdit%',
  '%interlinearizer_pt9ReadOnlyIntro_copy%',
  '%interlinearizer_pt9ReadOnlyIntro_view%',
];

/**
 * Explains why a Paratext 9 import is read-only and that copying it is how to edit it. Dismissing
 * the dialog (Escape or a click outside) means View read-only.
 */
export function Pt9ReadOnlyIntroModal({
  onCopy,
  onViewReadOnly,
}: Readonly<{ onCopy: () => void; onViewReadOnly: () => void }>) {
  const [localizedStrings] = useLocalizedStrings(PT9_READ_ONLY_INTRO_STRING_KEYS);

  return (
    <ModalShell
      titleTestId="pt9-read-only-intro-title"
      title={localizedStrings['%interlinearizer_pt9ReadOnlyIntro_title%']}
      width="tw:w-96"
      onClose={onViewReadOnly}
    >
      <p className="tw:mb-2" data-testid="pt9-read-only-intro-origin">
        {localizedStrings['%interlinearizer_pt9ReadOnlyIntro_origin%']}
      </p>
      <p className="tw:mb-4" data-testid="pt9-read-only-intro-how-to-edit">
        {localizedStrings['%interlinearizer_pt9ReadOnlyIntro_howToEdit%']}
      </p>
      <div className="tw:modal-actions">
        <Button variant="secondary" onClick={onViewReadOnly}>
          {localizedStrings['%interlinearizer_pt9ReadOnlyIntro_view%']}
        </Button>
        <Button onClick={onCopy}>
          {localizedStrings['%interlinearizer_pt9ReadOnlyIntro_copy%']}
        </Button>
      </div>
    </ModalShell>
  );
}
