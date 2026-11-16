import { useProjectSetting } from '@papi/frontend/react';
import { isPlatformError } from 'platform-bible-utils';

/**
 * The BCP 47 tag of the project's text, `'und'` when the project declares none or its tag cannot be
 * read.
 */
export default function useWritingSystem(projectId: string): string {
  const [languageTag] = useProjectSetting(projectId, 'platform.languageTag', '');
  return isPlatformError(languageTag) ? 'und' : languageTag || 'und';
}
