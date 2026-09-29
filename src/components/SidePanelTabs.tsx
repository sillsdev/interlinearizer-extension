import { Tabs, TabsList, TabsTrigger } from 'platform-bible-react';
import type { LanguageStrings } from 'platform-bible-utils';

/** A list the side panel can show. */
export type SidePanelView = 'catalog' | 'concordance';

/** Localized string keys the switcher renders. */
export const SIDE_PANEL_TAB_STRING_KEYS = [
  '%interlinearizer_sidePanel_views%',
  '%interlinearizer_analysisCatalog_title%',
  '%interlinearizer_concordance_title%',
] as const satisfies `%${string}%`[];

/** Props for {@link SidePanelTabs}. */
type SidePanelTabsProps = Readonly<{
  /** The list on screen. */
  active: SidePanelView;
  /** Asks for another list; never called with the active one. */
  onSelect: (view: SidePanelView) => void;
  /** Resolved localizations covering at least {@link SIDE_PANEL_TAB_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>;

function isSidePanelView(value: string): value is SidePanelView {
  return value === 'catalog' || value === 'concordance';
}

/** Switches the side panel between its lists. */
export default function SidePanelTabs({ active, onSelect, localizedStrings }: SidePanelTabsProps) {
  return (
    <Tabs
      value={active}
      onValueChange={(value) => {
        /* v8 ignore next -- every trigger's value is a view */
        if (isSidePanelView(value)) onSelect(value);
      }}
    >
      <TabsList aria-label={localizedStrings['%interlinearizer_sidePanel_views%']}>
        <TabsTrigger data-testid="side-panel-tab-catalog" value="catalog">
          {localizedStrings['%interlinearizer_analysisCatalog_title%']}
        </TabsTrigger>
        <TabsTrigger data-testid="side-panel-tab-concordance" value="concordance">
          {localizedStrings['%interlinearizer_concordance_title%']}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
