/** @file Unit tests for components/ScriptureNavControls.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalizedStrings, useRecentScriptureRefs } from '@papi/frontend/react';
import ScriptureNavControls from '../../../components/controls/ScriptureNavControls';
import { defaultScrRef } from '../../test-helpers';

describe('ScriptureNavControls', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([{}, false]);
    jest.mocked(useRecentScriptureRefs).mockReturnValue({
      recentScriptureRefs: [],
      addRecentScriptureRef: jest.fn(),
    });
  });

  it('shows the book chapter control', () => {
    render(
      <ScriptureNavControls
        scrRef={defaultScrRef}
        handleSubmit={() => {}}
        scrollGroupId={undefined}
        onChangeScrollGroupId={() => {}}
      />,
    );

    expect(screen.getByTestId('book-chapter-control')).toBeInTheDocument();
  });

  it('calls handleSubmit and addRecentScriptureRef when the verse picker submits', async () => {
    const mockHandleSubmit = jest.fn();
    const mockAddRecentRef = jest.fn();
    jest.mocked(useRecentScriptureRefs).mockReturnValue({
      recentScriptureRefs: [],
      addRecentScriptureRef: mockAddRecentRef,
    });
    render(
      <ScriptureNavControls
        scrRef={defaultScrRef}
        handleSubmit={mockHandleSubmit}
        scrollGroupId={undefined}
        onChangeScrollGroupId={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /submit reference/i }));

    expect(mockHandleSubmit).toHaveBeenCalledWith(defaultScrRef);
    expect(mockAddRecentRef).toHaveBeenCalledWith(defaultScrRef);
  });
});
