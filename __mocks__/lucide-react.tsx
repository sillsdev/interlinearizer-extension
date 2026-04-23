/**
 * @file Jest mock for lucide-react. The real package ships ESM which Jest cannot parse without
 * extra transform configuration. Each icon is stubbed as a no-op component so tests that render
 * components importing lucide-react don't fail on the import.
 */

import type { SVGProps } from 'react';

const Icon = (_props: SVGProps<SVGSVGElement>) => null;

export const ChevronLeft = Icon;
export const ChevronRight = Icon;