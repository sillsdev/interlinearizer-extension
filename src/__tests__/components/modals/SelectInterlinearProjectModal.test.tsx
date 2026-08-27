/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import papi, { logger } from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import { useState } from 'react';
import { SelectInterlinearProjectModal } from '../../../components/modals/SelectInterlinearProjectModal';
import { getMockedPdpGet, makeProjectSummary } from '../../test-helpers';

const mockSendCommand = jest.mocked(papi.commands.sendCommand);

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_modal_select_title%': 'Select Interlinear Project',
  '%interlinearizer_modal_select_none%': 'No projects yet.',
  '%interlinearizer_modal_select_create_new%': 'Create New',
  '%interlinearizer_modal_select_cancel%': 'Cancel',
  '%interlinearizer_modal_select_name_unnamed%': 'Unnamed',
  '%interlinearizer_modal_select_info_button_label%': 'Project info',
  '%interlinearizer_modal_select_active_badge%': 'Active',
  '%interlinearizer_modal_select_modified_prefix%': 'Modified',
  '%interlinearizer_modal_select_importPt9%': 'Import from Paratext 9',
  '%interlinearizer_readonly_chip%': 'Read-only',
};

const STUB_PROJECT = makeProjectSummary();

const STUB_PROJECT_2 = makeProjectSummary({
  id: 'proj-uuid-2',
  createdAt: '2026-02-01T08:00:00.000Z',
  updatedAt: '2026-02-01T08:00:00.000Z',
  analysisLanguages: ['fr'],
  name: 'French glosses',
});

const defaultProps = {
  sourceProjectId: 'src-proj',
  onSelect: jest.fn(),
  onCreateNew: jest.fn(),
  onImportPt9: jest.fn(),
  onClose: jest.fn(),
  onViewInfo: jest.fn(),
};

describe('SelectInterlinearProjectModal', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
    mockSendCommand.mockResolvedValue('[]');
    jest.mocked(papi.notifications.send).mockResolvedValue('mock-notification-id');
  });

  it('renders the modal heading when strings are loaded', async () => {
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /select interlinear project/i }),
      ).toBeInTheDocument(),
    );
  });

  it('shows empty-state message when no projects are returned', async () => {
    mockSendCommand.mockResolvedValue('[]');
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('No projects yet.')).toBeInTheDocument());
  });

  it('shows a project row for each returned project', async () => {
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT, STUB_PROJECT_2]));
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('French glosses')).toBeInTheDocument());
    expect(screen.getByText('Unnamed')).toBeInTheDocument();
  });

  it('badges the active project and marks its row aria-current', async () => {
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT, STUB_PROJECT_2]));
    render(<SelectInterlinearProjectModal {...defaultProps} activeProjectId={STUB_PROJECT_2.id} />);
    await waitFor(() => expect(screen.getByText('French glosses')).toBeInTheDocument());

    expect(screen.getByText('Active')).toBeInTheDocument();
    // The active badge appears on the active project's row, not the other one.
    expect(screen.getByRole('button', { name: /french glosses/i })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('button', { name: /unnamed/i })).not.toHaveAttribute('aria-current');
  });

  it('shows no active badge when no project matches activeProjectId', async () => {
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT, STUB_PROJECT_2]));
    render(<SelectInterlinearProjectModal {...defaultProps} activeProjectId="not-in-list" />);
    await waitFor(() => expect(screen.getByText('French glosses')).toBeInTheDocument());

    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('shows the analysis writing system code in each row', async () => {
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT]));
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('en')).toBeInTheDocument());
  });

  it("orders projects most-recently-modified first and shows each row's modified date", async () => {
    // STUB_PROJECT is older (Jan 15) than STUB_PROJECT_2 (Feb 1); returned oldest-first so the
    // component must reorder to put the newer project on top. The sort edge cases (equal and
    // corrupted timestamps) and the date format itself are covered by the formatter's own unit
    // tests; here we only confirm the modal wires the helpers in.
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT, STUB_PROJECT_2]));
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('French glosses')).toBeInTheDocument());

    const rows = screen.getAllByRole('button', { name: /french glosses|unnamed/i });
    expect(rows[0]).toHaveAccessibleName(/french glosses/i);
    expect(rows[1]).toHaveAccessibleName(/unnamed/i);

    expect(
      screen.getByText(`Modified ${new Date(STUB_PROJECT.updatedAt).toLocaleString()}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Modified ${new Date(STUB_PROJECT_2.updatedAt).toLocaleString()}`),
    ).toBeInTheDocument();
  });

  it('calls onSelect with the project when a project row is clicked', async () => {
    const onSelect = jest.fn();
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT]));
    render(<SelectInterlinearProjectModal {...defaultProps} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByText('Unnamed')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /unnamed/i }));

    expect(onSelect).toHaveBeenCalledWith(STUB_PROJECT);
  });

  it('calls onCreateNew when Create New is clicked', async () => {
    const onCreateNew = jest.fn();
    render(<SelectInterlinearProjectModal {...defaultProps} onCreateNew={onCreateNew} />);

    await userEvent.click(screen.getByRole('button', { name: /create new/i }));

    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = jest.fn();
    render(<SelectInterlinearProjectModal {...defaultProps} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onViewInfo with the project when the info button is clicked', async () => {
    const onViewInfo = jest.fn();
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT]));
    render(<SelectInterlinearProjectModal {...defaultProps} onViewInfo={onViewInfo} />);
    await waitFor(() => expect(screen.getByText('Unnamed')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /project info/i }));

    expect(onViewInfo).toHaveBeenCalledWith(STUB_PROJECT);
  });

  it('shows the empty-state message when getProjectsForSource command throws, and sends an error notification', async () => {
    mockSendCommand.mockRejectedValue(new Error('network error'));
    render(<SelectInterlinearProjectModal {...defaultProps} />);

    await waitFor(() =>
      expect(papi.notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      ),
    );
    expect(screen.getByText('No projects yet.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('shows the empty-state message when getProjectsForSource returns malformed JSON', async () => {
    mockSendCommand.mockResolvedValue('not valid json {{{');
    render(<SelectInterlinearProjectModal {...defaultProps} />);

    await waitFor(() =>
      expect(papi.notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      ),
    );
    expect(screen.getByText('No projects yet.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('silently drops non-object entries and only renders valid projects', async () => {
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT, 'bad', 42, undefined]));
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Unnamed')).toBeInTheDocument());
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('bad')).not.toBeInTheDocument();
    expect(screen.queryByText('42')).not.toBeInTheDocument();
  });

  it('silently drops entries with a non-string description field', async () => {
    const badDescription = { ...STUB_PROJECT, description: 123 };
    mockSendCommand.mockResolvedValue(JSON.stringify([badDescription, STUB_PROJECT_2]));
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('French glosses')).toBeInTheDocument());
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('silently drops entries with a non-string targetProjectId field', async () => {
    const badTarget = { ...STUB_PROJECT, targetProjectId: 99 };
    mockSendCommand.mockResolvedValue(JSON.stringify([badTarget, STUB_PROJECT_2]));
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('French glosses')).toBeInTheDocument());
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('shows the empty-state message when getProjectsForSource returns a non-array', async () => {
    mockSendCommand.mockResolvedValue(JSON.stringify({ not: 'an array' }));
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('No projects yet.')).toBeInTheDocument());
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('disables Cancel and Create New while the project list is loading', async () => {
    let resolveLoad: (v: string) => void = () => {};
    mockSendCommand.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    render(<SelectInterlinearProjectModal {...defaultProps} />);

    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /create new/i })).toBeDisabled();

    resolveLoad('[]');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^cancel$/i })).not.toBeDisabled(),
    );
  });

  it('disables Cancel and Create New while a chosen project is being opened', async () => {
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT]));
    render(<SelectInterlinearProjectModal {...defaultProps} isOpening />);
    await waitFor(() => expect(screen.getByText('Unnamed')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /create new/i })).toBeDisabled();
  });

  it('ignores clicks on a project row and its info button while a chosen project is being opened', async () => {
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT]));
    render(<SelectInterlinearProjectModal {...defaultProps} isOpening />);
    await waitFor(() => expect(screen.getByText('Unnamed')).toBeInTheDocument());

    const row = screen.getByRole('button', { name: /unnamed/i });
    const info = screen.getByRole('button', { name: /project info/i });
    expect(row).toBeDisabled();
    expect(info).toBeDisabled();

    await userEvent.click(row);
    await userEvent.click(info);

    expect(defaultProps.onSelect).not.toHaveBeenCalled();
    expect(defaultProps.onViewInfo).not.toHaveBeenCalled();
  });

  it('ignores Escape while a chosen project is being opened, since the open completes regardless', async () => {
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT]));
    render(<SelectInterlinearProjectModal {...defaultProps} isOpening />);
    await waitFor(() => expect(screen.getByText('Unnamed')).toBeInTheDocument());

    await userEvent.keyboard('{Escape}');

    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape once no open is in flight', async () => {
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT]));
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Unnamed')).toBeInTheDocument());

    await userEvent.keyboard('{Escape}');

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape while the project list is still loading, since the fetch has nothing to abandon', async () => {
    // Hold the load in-flight so Escape lands while the modal is still waiting on the list.
    let resolveLoad: (v: string) => void = () => {};
    mockSendCommand.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled());

    await userEvent.keyboard('{Escape}');

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);

    // Settle the held load so its state update lands inside the test rather than after teardown.
    resolveLoad('[]');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^cancel$/i })).not.toBeDisabled(),
    );
  });

  it('stays silent when the project-list load fails after the modal has been dismissed', async () => {
    // Dismissal unmounts the modal in the real tree, so the host below mirrors that: a load that
    // fails afterwards must not raise an error notification over a list nobody is waiting on.
    let rejectLoad: (reason: unknown) => void = () => {};
    mockSendCommand.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject;
        }),
    );
    function Host() {
      const [isOpen, setIsOpen] = useState(true);
      return isOpen ? (
        <SelectInterlinearProjectModal {...defaultProps} onClose={() => setIsOpen(false)} />
      ) : undefined;
    }
    render(<Host />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled());

    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument(),
    );

    rejectLoad(new Error('failed after dismissal'));
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(logger.error).not.toHaveBeenCalled();
    expect(papi.notifications.send).not.toHaveBeenCalled();
  });

  it('clears the project list immediately when a new load begins', async () => {
    mockSendCommand.mockResolvedValue(JSON.stringify([STUB_PROJECT]));
    const { rerender } = render(<SelectInterlinearProjectModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Unnamed')).toBeInTheDocument());

    // Hold the second load in-flight so we can assert the list cleared before it resolves.
    let resolveSecond: (v: string) => void = () => {};
    mockSendCommand.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
    );

    rerender(<SelectInterlinearProjectModal {...defaultProps} sourceProjectId="src-proj-2" />);

    await waitFor(() => expect(screen.queryByText('Unnamed')).not.toBeInTheDocument());
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();

    resolveSecond('[]');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^cancel$/i })).not.toBeDisabled(),
    );
  });

  it('ignores a response that arrives after a newer load has started', async () => {
    let resolveFirst: (v: string) => void = () => {};
    mockSendCommand
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(JSON.stringify([STUB_PROJECT_2]));

    const { rerender } = render(<SelectInterlinearProjectModal {...defaultProps} />);

    // Start a second load by changing sourceProjectId before the first resolves.
    rerender(<SelectInterlinearProjectModal {...defaultProps} sourceProjectId="src-proj-2" />);
    await waitFor(() => expect(screen.getByText('French glosses')).toBeInTheDocument());

    // Now deliver the stale first response — it must not replace the current list.
    resolveFirst(JSON.stringify([STUB_PROJECT]));

    await waitFor(() => expect(screen.queryByText('Unnamed')).not.toBeInTheDocument());
    expect(screen.getByText('French glosses')).toBeInTheDocument();
  });
});

describe('SelectInterlinearProjectModal Paratext 9 import entry', () => {
  const mockPdpGet = getMockedPdpGet(papi);

  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
    jest.mocked(papi.notifications.send).mockResolvedValue('mock-notification-id');
  });

  it('offers the import button when the probe finds files and fires onImportPt9', async () => {
    mockSendCommand.mockResolvedValue('[]');
    mockPdpGet.mockResolvedValue({
      getPt9InterlinearManifest: async () => ({ 'Lexicon.xml': 'aaaa1111' }),
    });
    const onImportPt9 = jest.fn();
    render(<SelectInterlinearProjectModal {...defaultProps} onImportPt9={onImportPt9} />);

    const button = await screen.findByTestId('import-pt9-button');
    await userEvent.click(button);

    expect(onImportPt9).toHaveBeenCalledTimes(1);
  });

  it('never offers the import button when the probe finds nothing', async () => {
    mockSendCommand.mockResolvedValue('[]');
    mockPdpGet.mockResolvedValue({ getPt9InterlinearManifest: async () => ({}) });
    render(<SelectInterlinearProjectModal {...defaultProps} />);

    await waitFor(() => expect(mockPdpGet).toHaveBeenCalled());
    expect(screen.queryByTestId('import-pt9-button')).not.toBeInTheDocument();
  });

  it('chips the import row read-only and skips the probe once an import exists', async () => {
    const imported = {
      ...makeProjectSummary(),
      id: 'import-id',
      name: 'Paratext 9 Interlinear',
      pt9Import: {
        fileHashes: { 'Lexicon.xml': 'aaaa1111' },
        importedAt: '2026-08-01T00:00:00.000Z',
      },
    };
    mockSendCommand.mockResolvedValue(JSON.stringify([imported]));
    render(<SelectInterlinearProjectModal {...defaultProps} />);

    expect(await screen.findByTestId('readonly-chip')).toHaveTextContent('Read-only');
    expect(screen.queryByTestId('import-pt9-button')).not.toBeInTheDocument();
    expect(mockPdpGet).not.toHaveBeenCalled();
  });
});
