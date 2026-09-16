/**
 * A backslash escapes only a brace; anywhere else it is ordinary text. A key holds no backslash, so
 * an escaped brace can never be mistaken for the end of a placeholder.
 */
const ESCAPE_OR_PLACEHOLDER = /\\([{}])|\{([^{}\\]*)\}/g;

/**
 * Fills each `{key}` in a template from `replacers`, leaving an unknown key as its own text. A
 * brace escaped as `\{` or `\}` is literal text and loses its backslash. Cheap enough to run for
 * every label on screen during a scroll.
 *
 * @returns The template's literal pieces interleaved with the replacements, in source order, each
 *   replacement left as its own value rather than coerced to a string.
 */
export function formatTemplateToArray<T>(
  template: string,
  replacers: Readonly<Record<string, T>>,
): (string | T)[] {
  const parts: (string | T)[] = [];
  let literalStart = 0;
  // Literal text accrues across escapes so that `\{a\}` stays one piece rather than three.
  let literal = '';

  ESCAPE_OR_PLACEHOLDER.lastIndex = 0;
  let match = ESCAPE_OR_PLACEHOLDER.exec(template);
  while (match) {
    literal += template.slice(literalStart, match.index);
    const [, escapedBrace, key] = match;
    if (escapedBrace !== undefined) {
      literal += escapedBrace;
      /* v8 ignore next -- the alternation matches one group or the other, never neither */
    } else if (key !== undefined) {
      if (literal !== '') parts.push(literal);
      literal = '';
      parts.push(key in replacers ? replacers[key] : key);
    }
    literalStart = match.index + match[0].length;
    match = ESCAPE_OR_PLACEHOLDER.exec(template);
  }

  literal += template.slice(literalStart);
  if (literal !== '') parts.push(literal);
  return parts;
}

/** Same substitution as {@link formatTemplateToArray}, with every part coerced to a string. */
export function formatTemplate(
  template: string,
  replacers: Readonly<Record<string, string | number>>,
): string {
  return formatTemplateToArray(template, replacers).join('');
}
