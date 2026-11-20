/**
 * The tab that holds each project, and the duplicate tabs of each project.
 *
 * The holder is the first tab served while no other tab holds the project. Opening the project
 * again brings the holder to front. A second tab that a layout restores is a duplicate. A duplicate
 * shows only a notice that points at the holder. When the holder closes, a duplicate takes the
 * project over.
 */
export class WebViewHolders {
  private readonly holders = new Map<string, string>();

  private readonly duplicates = new Map<string, Set<string>>();

  /** The tab that holds `projectId`, if any does. */
  holderOf(projectId: string): string | undefined {
    return this.holders.get(projectId);
  }

  /**
   * Gives `projectId` to the tab `webViewId` that is being served, unless another tab holds it. A
   * tab turned away is kept as a duplicate of the project.
   *
   * @returns The tab that holds the project when that is another tab, or `undefined` when
   *   `webViewId` holds it.
   */
  claim(projectId: string, webViewId: string): string | undefined {
    if (this.hold(projectId, webViewId)) {
      this.duplicates.get(projectId)?.delete(webViewId);
      return undefined;
    }
    const duplicates = this.duplicates.get(projectId) ?? new Set<string>();
    this.duplicates.set(projectId, duplicates.add(webViewId));
    return this.holders.get(projectId);
  }

  /**
   * Gives `projectId` to the open tab `webViewId`, unless another tab holds the project. Unlike
   * {@link WebViewHolders.claim}, a tab turned away is not kept as a duplicate.
   *
   * @returns Whether `webViewId` holds the project.
   */
  hold(projectId: string, webViewId: string): boolean {
    const holder = this.holders.get(projectId);
    if (holder !== undefined && holder !== webViewId) return false;
    this.holders.set(projectId, webViewId);
    return true;
  }

  /**
   * Forgets the closed tab `webViewId`, as the holder of `projectId` or as one of its duplicates.
   * The returned successor stays a duplicate until it is served and claims the project.
   *
   * @returns `undefined` when the tab did not hold the project. Otherwise, the duplicate that
   *   should take the project over, if any.
   */
  release(projectId: string, webViewId: string): { successor: string | undefined } | undefined {
    const duplicates = this.duplicates.get(projectId);
    duplicates?.delete(webViewId);
    if (this.holders.get(projectId) !== webViewId) return undefined;
    this.holders.delete(projectId);
    const [successor] = duplicates ?? [];
    return { successor };
  }

  /** Forgets every holder and duplicate. */
  clear(): void {
    this.holders.clear();
    this.duplicates.clear();
  }
}
