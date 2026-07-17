/** @file Unit tests for the shared ProjectSummaryDetails row-detail block. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import { ProjectSummaryDetails } from '../../../components/modals/ProjectSummaryDetails';
import type { InterlinearProjectSummary } from '../../../types/interlinear-project-summary';

const NAMED_PROJECT: InterlinearProjectSummary = {
  id: 'proj-uuid',
  createdAt: '2026-01-15T10:30:00.000Z',
  updatedAt: '2026-01-15T10:30:00.000Z',
  sourceProjectId: 'src-proj',
  analysisLanguages: ['en', 'fr'],
  name: 'Greek NT',
};

const LABELS = {
  activeBadgeLabel: 'Active',
  modifiedPrefix: 'Modified',
  unnamedLabel: 'Unnamed',
};

describe('ProjectSummaryDetails', () => {
  it('renders the name, joined language tags, and modified date, with no badge when inactive', () => {
    // No className is passed, exercising the wrapper's empty-class fallback (both modals always pass
    // one, so this branch is only reachable here).
    render(<ProjectSummaryDetails project={NAMED_PROJECT} isActive={false} {...LABELS} />);

    expect(screen.getByText('Greek NT')).toBeInTheDocument();
    expect(screen.getByText('en, fr')).toBeInTheDocument();
    expect(
      screen.getByText(`Modified ${new Date(NAMED_PROJECT.updatedAt).toLocaleString()}`),
    ).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('falls back to the unnamed label and shows the active badge when active and unnamed', () => {
    const unnamed: InterlinearProjectSummary = { ...NAMED_PROJECT, name: undefined };
    render(<ProjectSummaryDetails project={unnamed} isActive {...LABELS} />);

    expect(screen.getByText('Unnamed')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});
