/**
 * Fills each `{key}` in a template from `replacers`, leaving an unknown key as its own text. Cheap
 * enough to run for every label on screen during a scroll.
 *
 * @returns The template's literal pieces interleaved with the replacements, in source order, each
 *   replacement left as its own value rather than coerced to a string.
 */
export function formatTemplateToArray<T>(
  template: string,
  replacers: Readonly<Record<string, T>>,
): (string | T)[] {
  return template.split(/\{([^{}]*)\}/).flatMap((piece, index) => {
    if (index % 2 === 1) return [piece in replacers ? replacers[piece] : piece];
    return piece === '' ? [] : [piece];
  });
}

/** Same substitution as {@link formatTemplateToArray}, with every part coerced to a string. */
export function formatTemplate(
  template: string,
  replacers: Readonly<Record<string, string | number>>,
): string {
  return formatTemplateToArray(template, replacers).join('');
}
