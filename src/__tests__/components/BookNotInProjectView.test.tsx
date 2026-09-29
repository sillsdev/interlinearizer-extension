/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import papi, { logger } from '@papi/frontend';
import { useLocalizedStrings, useProjectSetting } from '@papi/frontend/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlatformError } from 'platform-bible-utils';
import BookNotInProjectView from '../../components/BookNotInProjectView';
import { mockKeyAsValueLocalizedStrings } from './test-helpers';

const MANAGE_BOOKS = '%interlinearizer_bookNotInProject_manageBooks%';

const READ_ONLY = '%interlinearizer_bookNotInProject_readOnly%';

function mockProjectSettings({
  isPublished = false,
  isPublishedLoading = false,
  isEditable = true,
  isEditableLoading = false,
}: {
  isPublished?: boolean | PlatformError;
  isPublishedLoading?: boolean;
  isEditable?: boolean;
  isEditableLoading?: boolean;
} = {}): void {
  jest.mocked(useProjectSetting).mockImplementation((_project, key, defaultState) => {
    if (key === 'platform.isPublished')
      return [isPublished, jest.fn(), jest.fn(), isPublishedLoading];
    if (key === 'platform.isEditable') return [isEditable, jest.fn(), jest.fn(), isEditableLoading];
    return [defaultState, jest.fn(), jest.fn(), false];
  });
}

function renderView(isPowerMode: boolean) {
  return render(
    <BookNotInProjectView projectId="project-1" webViewId="web-view-1" isPowerMode={isPowerMode} />,
  );
}

describe('BookNotInProjectView', () => {
  beforeEach(() => {
    mockKeyAsValueLocalizedStrings();
    mockProjectSettings();
    jest.mocked(papi.commands.sendCommand).mockResolvedValue('manage-books-web-view');
    jest.mocked(papi.notifications.send).mockResolvedValue('notification-1');
  });

  describe('in Power mode', () => {
    it('titles the view with the missing-book heading', () => {
      renderView(true);

      expect(
        screen.getByRole('heading', { name: '%interlinearizer_bookNotInProject_title%' }),
      ).toBeInTheDocument();
    });

    it('names the Manage books button in the description', () => {
      mockKeyAsValueLocalizedStrings({
        '%interlinearizer_bookNotInProject_description%': 'Add it with {buttonLabel}.',
      });

      renderView(true);

      expect(screen.getByText(`Add it with ${MANAGE_BOOKS}.`)).toBeInTheDocument();
    });

    it('opens Manage Books to create the book this web view is on', async () => {
      renderView(true);

      await userEvent.click(screen.getByRole('button', { name: MANAGE_BOOKS }));

      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'platformScripture.openManageBooks',
        'web-view-1',
        'createMissingBook',
      );
    });

    it('notifies the user when Manage Books cannot be opened', async () => {
      jest.mocked(papi.commands.sendCommand).mockRejectedValue(new Error('no such command'));
      renderView(true);

      await userEvent.click(screen.getByRole('button', { name: MANAGE_BOOKS }));

      await waitFor(() =>
        expect(papi.notifications.send).toHaveBeenCalledWith({
          message: '%interlinearizer_error_openManageBooks%',
          severity: 'error',
        }),
      );
      expect(logger.warn).toHaveBeenCalled();
    });

    it('offers no read-only explanation for an editable project', () => {
      renderView(true);

      expect(screen.queryByRole('group')).not.toBeInTheDocument();
    });

    describe('for a read-only project', () => {
      beforeEach(() => mockProjectSettings({ isEditable: false }));

      it('disables the Manage books button', () => {
        renderView(true);

        expect(screen.getByRole('button', { name: MANAGE_BOOKS })).toBeDisabled();
      });

      it('explains why Manage books is disabled', () => {
        renderView(true);

        expect(screen.getByRole('group', { name: READ_ONLY })).toBeInTheDocument();
      });
    });
  });

  describe('in Simple mode', () => {
    it('tells the user to ask their administrator', () => {
      renderView(false);

      expect(
        screen.getByText('%interlinearizer_bookNotInProject_askAdministrator%'),
      ).toBeInTheDocument();
    });

    it('offers no Manage books button', () => {
      renderView(false);

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('for a resource', () => {
    beforeEach(() => mockProjectSettings({ isPublished: true }));

    it('says the resource lacks the book', () => {
      renderView(true);

      expect(screen.getByText('%interlinearizer_bookNotInResource%')).toBeInTheDocument();
    });

    it('offers no Manage books button', () => {
      renderView(true);

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('reads whether the source project is published', () => {
      renderView(true);

      expect(useProjectSetting).toHaveBeenCalledWith('project-1', 'platform.isPublished', false);
    });
  });

  describe('when the project type cannot be read', () => {
    beforeEach(() =>
      mockProjectSettings({ isPublished: { message: 'unavailable', platformErrorVersion: 1 } }),
    );

    it('says the book is unavailable', () => {
      renderView(true);

      expect(
        screen.getByText('%interlinearizer_bookNotInProject_unknownProjectType%'),
      ).toBeInTheDocument();
    });

    it('offers no Manage books button', () => {
      renderView(true);

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('logs the lookup failure', () => {
      renderView(true);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unavailable'));
    });
  });

  it('renders nothing while the localized strings load', () => {
    jest.mocked(useLocalizedStrings).mockReturnValue([{}, true]);

    const { container } = renderView(true);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while it is unknown whether the project is a resource', () => {
    mockProjectSettings({ isPublishedLoading: true });

    const { container } = renderView(true);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while it is unknown whether the project is editable', () => {
    mockProjectSettings({ isEditableLoading: true });

    const { container } = renderView(true);

    expect(container).toBeEmptyDOMElement();
  });
});
