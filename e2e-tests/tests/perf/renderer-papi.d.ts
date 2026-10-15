/** The slice of the renderer's global `papi` the performance harness drives. */
interface RendererPapi {
  commands: { sendCommand(command: string, ...args: unknown[]): Promise<unknown> };
  projectLookup: {
    getMetadataForAllProjects(): Promise<{ id: string; name?: string }[]>;
  };
  projectDataProviders: {
    get(
      projectInterface: string,
      projectId: string,
    ): Promise<{
      getSetting(key: string): Promise<unknown>;
      getBookUSJ(verseRef: {
        book: string;
        chapterNum: number;
        verseNum: number;
      }): Promise<unknown>;
    }>;
  };
  scrollGroups: {
    setScrRef(
      scrollGroupId: number | undefined,
      scrRef: { book: string; chapterNum: number; verseNum: number },
    ): Promise<boolean>;
  };
  webViews: {
    openWebView(
      webViewType: string,
      layout?: unknown,
      options?: Record<string, unknown>,
    ): Promise<string | undefined>;
  };
}

interface Window {
  papi: RendererPapi;
}
