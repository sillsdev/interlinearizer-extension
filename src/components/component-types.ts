/**
 * Props shared by components that display and edit token glosses.
 *
 * @field glosses - Map from `Token.id` to current gloss text.
 * @field onGlossChange - Called with the token id and new value when a gloss is edited.
 */
export type GlossHandlers = {
  glosses: Record<string, string>;
  onGlossChange: (tokenId: string, value: string) => void;
};
