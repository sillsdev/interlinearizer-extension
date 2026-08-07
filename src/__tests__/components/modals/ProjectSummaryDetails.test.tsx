/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import { ProjectSummaryDetails } from '../../../components/modals/ProjectSummaryDetails';
import { makeProjectSummary } from '../../test-helpers';

const NAMED_PROJECT = makeProjectSummary({ analysisLanguages: ['en', 'fr'], name: 'Greek NT' });

const LABELS = {
  activeBadgeLabel: 'Active',
  modifiedPrefix: 'Modified',
  unnamedLabel: 'Unnamed',
};

describe('ProjectSummaryDetails', () => {
  it('renders the name, joined language tags, and modified date, with no badge when inactive', () => {
    // No className is passed, exercising the wrapper's empty-class fallback (both modals always pass
    // one, so this branch is only reachable here).
    render(<ProjectSummaryDetails {...LABELS} isActive={false} project={NAMED_PROJECT} />);

    expect(screen.getByText('Greek NT')).toBeInTheDocument();
    expect(screen.getByText('en, fr')).toBeInTheDocument();
    expect(
      screen.getByText(`Modified ${new Date(NAMED_PROJECT.updatedAt).toLocaleString()}`),
    ).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('falls back to the unnamed label and shows the active badge when active and unnamed', () => {
    const unnamed = makeProjectSummary({ analysisLanguages: ['en', 'fr'] });
    render(<ProjectSummaryDetails {...LABELS} isActive project={unnamed} />);

    expect(screen.getByText('Unnamed')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});
