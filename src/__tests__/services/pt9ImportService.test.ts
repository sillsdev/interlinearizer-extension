/// <reference types="jest" />

import * as fs from 'node:fs';
import * as path from 'node:path';

import papiBackendMock from '@papi/backend';
import { importPt9Project } from '../../services/pt9ImportService';
import { resetQueuesForTesting } from '../../services/projectStorage';
import { createTestActivationContext, makeStubProject } from '../test-helpers';

/**
 * The backend-mock jest fns this suite drives: the PAPI boundary (project data providers,
 * localization, storage) around the real parsers, converter, and storage module.
 */
interface BackendMock {
  __mockProjectDataProvidersGet: jest.Mock;
  __mockGetLocalizedString: jest.Mock;
  __mockReadUserData: jest.Mock;
  __mockWriteUserData: jest.Mock;
  __mockDeleteUserData: jest.Mock;
  __mockLogger: { debug: jest.Mock; error: jest.Mock; info: jest.Mock; warn: jest.Mock };
}

function isBackendMock(m: unknown): m is BackendMock {
  return (
    !!m &&
    typeof m === 'object' &&
    '__mockProjectDataProvidersGet' in m &&
    '__mockGetLocalizedString' in m &&
    '__mockReadUserData' in m &&
    '__mockWriteUserData' in m
  );
}

if (!isBackendMock(papiBackendMock)) throw new Error('Expected mocked @papi/backend');
const {
  __mockProjectDataProvidersGet,
  __mockGetLocalizedString,
  __mockReadUserData,
  __mockWriteUserData,
  __mockDeleteUserData,
  __mockLogger,
} = papiBackendMock;

const token = createTestActivationContext().executionToken;

const IMPORT_TIME = '2026-08-21T15:00:00.000Z';

/** Reads one of the coherent PT9 fixtures the converter tests are built on. */
function readFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', 'test-data', name), 'utf-8');
}

/** The fixture set as the projectInterface serves it: project-relative path to text and hash. */
function fixtureFileSet(): Record<string, { text: string; sha256: string }> {
  return {
    'Interlinear_en/Interlinear_en_MAT.xml': {
      text: readFixture('Interlinear_en_MAT.xml'),
      sha256: 'hash-interlinear',
    },
    'Lexicon.xml': { text: readFixture('Lexicon.xml'), sha256: 'hash-lexicon' },
    'WordAnalyses.xml': { text: readFixture('WordAnalyses.xml'), sha256: 'hash-word-analyses' },
    'InterlinearSetup.xml': { text: readFixture('InterlinearSetup.xml'), sha256: 'hash-setup' },
  };
}

/** A USJ book whose verse texts match what the fixture interlinear data anchors against. */
const MAT_USJ = {
  content: [
    { type: 'book', code: 'MAT', content: [] },
    { type: 'chapter', number: '1', sid: 'MAT 1' },
    {
      type: 'para',
      marker: 'p',
      content: [
        { type: 'verse', sid: 'MAT 1:1', number: '1' },
        'hello aokaybe abe abc this is a footnote with a note تمان oj',
        { type: 'verse', sid: 'MAT 1:2', number: '2' },
        'oooo dearly',
        { type: 'verse', sid: 'MAT 1:9', number: '9' },
        'hello',
      ],
    },
  ],
};

/** Serves fake PDPs for the three projectInterfaces the service consumes. */
function mockPdps({
  files = fixtureFileSet(),
  usj = MAT_USJ,
  languageTag = 'en',
}: {
  files?: Record<string, { text: string; sha256: string }>;
  usj?: unknown;
  languageTag?: unknown;
} = {}): void {
  __mockProjectDataProvidersGet.mockImplementation((projectInterface: unknown) => {
    if (projectInterface === 'platformScripture.Pt9Interlinear')
      return Promise.resolve({ getPt9InterlinearFiles: jest.fn().mockResolvedValue(files) });
    if (projectInterface === 'platformScripture.USJ_Book')
      return Promise.resolve({ getBookUSJ: jest.fn().mockResolvedValue(usj) });
    return Promise.resolve({ getSetting: jest.fn().mockResolvedValue(languageTag) });
  });
}

/** The localized values the import resolves and stamps. */
const LOCALIZED: Record<string, string> = {
  '%interlinearizer_pt9Import_name%': 'Paratext 9 Interlinear',
  '%interlinearizer_pt9Import_description%': 'Imported from Paratext 9.',
};

/** Constructs the ENOENT error `papi.storage.readUserData` throws for a never-written key. */
function enoentError(): Error {
  return Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
}

/** The project record JSON written under a `project:` key, parsed; throws when none was written. */
function writtenProject(): ReturnType<typeof makeStubProject> {
  const call = __mockWriteUserData.mock.calls.find(
    (c: unknown[]) => typeof c[1] === 'string' && c[1].startsWith('project:'),
  );
  if (!call || typeof call[2] !== 'string') throw new Error('Expected a project write');
  return JSON.parse(call[2]);
}

describe('importPt9Project', () => {
  beforeEach(() => {
    resetQueuesForTesting();
    __mockReadUserData.mockRejectedValue(enoentError());
    __mockWriteUserData.mockResolvedValue(undefined);
    __mockDeleteUserData.mockResolvedValue(undefined);
    __mockGetLocalizedString.mockImplementation(({ localizeKey }: { localizeKey: string }) =>
      Promise.resolve(LOCALIZED[localizeKey] ?? localizeKey),
    );
    mockPdps();
    jest.useFakeTimers().setSystemTime(new Date(IMPORT_TIME));
    jest.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000001');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('imports the fixture set end to end and persists the frozen project', async () => {
    const result = await importPt9Project(token, 'src-project');

    expect(result.outcome).toBe('imported');
    expect(result.projectId).toBe('00000000-0000-0000-0000-000000000001');
    const [language] = result.report?.languages ?? [];
    expect(language.tag).toBe('en');
    expect(language.books[0]).toMatchObject({
      bookId: 'MAT',
      bookFound: true,
      versesTotal: 36,
      clustersConverted: 24,
    });

    const project = writtenProject();
    expect(project).toMatchObject({
      name: 'Paratext 9 Interlinear',
      description: 'Imported from Paratext 9.',
      sourceProjectId: 'src-project',
      analysisLanguages: ['en'],
      pt9Import: {
        importedAt: IMPORT_TIME,
        fileHashes: {
          'Interlinear_en/Interlinear_en_MAT.xml': 'hash-interlinear',
          'Lexicon.xml': 'hash-lexicon',
          'WordAnalyses.xml': 'hash-word-analyses',
          'InterlinearSetup.xml': 'hash-setup',
        },
      },
    });
    expect(project.analysis.tokenAnalyses).toHaveLength(18);
  });

  it('replaces the existing import on sync, keeping its id', async () => {
    const existing = {
      ...makeStubProject('import-id'),
      pt9Import: { fileHashes: { 'Lexicon.xml': 'old' }, importedAt: '2026-08-01T00:00:00.000Z' },
    };
    __mockReadUserData.mockImplementation((_t: unknown, key: unknown) => {
      if (key === 'projectIds') return Promise.resolve(JSON.stringify(['import-id']));
      if (key === 'project:import-id') return Promise.resolve(JSON.stringify(existing));
      return Promise.reject(enoentError());
    });

    const result = await importPt9Project(token, 'src-project');

    expect(result).toMatchObject({ outcome: 'imported', projectId: 'import-id' });
  });

  it('skips a book the project has no USJ for and reports it missing', async () => {
    // eslint-disable-next-line no-null/no-null -- null defeats the option's MAT_USJ default, which undefined would trigger
    mockPdps({ usj: null });

    const result = await importPt9Project(token, 'src-project');

    expect(result.outcome).toBe('imported');
    expect(result.report?.languages[0].books[0].bookFound).toBe(false);
    expect(__mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no USJ for book MAT'));
  });

  it('aborts without writing when the source has no interlinear data and no import exists', async () => {
    mockPdps({ files: {} });

    await expect(importPt9Project(token, 'src-project')).rejects.toThrow(
      'no Paratext 9 interlinear data to import',
    );
    expect(__mockWriteUserData).not.toHaveBeenCalled();
  });

  it('keeps the stored import untouched when the source files have disappeared', async () => {
    mockPdps({ files: {} });
    const existing = {
      ...makeStubProject('import-id'),
      pt9Import: { fileHashes: { 'Lexicon.xml': 'old' }, importedAt: '2026-08-01T00:00:00.000Z' },
    };
    __mockReadUserData.mockImplementation((_t: unknown, key: unknown) => {
      if (key === 'projectIds') return Promise.resolve(JSON.stringify(['import-id']));
      if (key === 'project:import-id') return Promise.resolve(JSON.stringify(existing));
      return Promise.reject(enoentError());
    });

    const result = await importPt9Project(token, 'src-project');

    expect(result).toStrictEqual({ outcome: 'staleKept', projectId: 'import-id' });
    expect(__mockWriteUserData).not.toHaveBeenCalled();
    expect(__mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('keeping the stored import'),
    );
  });

  it('falls back to the und writing system when the language tag setting is unavailable', async () => {
    mockPdps({ languageTag: '' });

    await importPt9Project(token, 'src-project');

    const project = writtenProject();
    const bare = project.analysis.tokenAnalyses.find(
      (a) => a.producer === 'pt9-import:word-analyses',
    );
    expect(bare?.morphemes?.[0].writingSystem).toBe('und');
  });

  it('propagates a parse failure without writing', async () => {
    const files = fixtureFileSet();
    files['Lexicon.xml'] = { text: '<Lexicon', sha256: 'hash-broken' };
    mockPdps({ files });

    await expect(importPt9Project(token, 'src-project')).rejects.toThrow();
    expect(__mockWriteUserData).not.toHaveBeenCalled();
  });
});
