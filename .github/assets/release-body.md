## Interlinearizer

Interlinear glossing tools for Platform.Bible: gloss Scripture token by token, break words into
morphemes, link source and target phrases, and adjust segment boundaries.

This is a pre-release for testing and feedback. Expect rough edges, and expect the way analysis is
stored to keep changing between releases.

<!-- Maintainers: re-verify the application build below against each new build before publishing.
Check that the Interlinearizer tab actually renders, not just that the extension activates in the
log. Re-attach the matching application zip to each release, and update the version in the Assets
line below when it changes. -->

> **Windows only for now.** The application build this extension needs is currently available for
> Windows alone. A Linux build has been requested and should follow; there is no macOS build. Please
> do not use Platform.Bible from the Snap Store or the public releases page — the extension loads
> there but its window comes up blank.

### Installing

Both files you need are in the **Assets** list below.

1. Download `Paratext.10.Studio.Setup.<version>-Windows.zip` (around 240 MB), extract it, and run the
   installer inside. This is the application build this release is meant to be used with.
2. Start Paratext 10 Studio once, then close it. This creates the folder used in the next step.
3. Download `interlinearizer_<version>.zip` and leave it zipped.
4. Copy it into `%USERPROFILE%\.platform.bible\installed-extensions` — paste that path straight into
   the File Explorer address bar. The folder is named `.platform.bible` because the extension API
   belongs to Platform.Bible, the framework the application is built on; that is the right folder.
5. Restart Paratext 10 Studio, open a project from Home, then choose **Open Interlinearizer for this
   Project** from the Scripture Editor's **≡** menu.

Install both files from the same release. Mixing an Interlinearizer zip with a different version of
the application is the usual cause of a blank Interlinearizer window.

Step-by-step instructions, first steps once it is open, and troubleshooting are in
[INSTALL.md](https://github.com/sillsdev/interlinearizer-extension/blob/main/INSTALL.md).

Please report problems at
[github.com/sillsdev/interlinearizer-extension/issues](https://github.com/sillsdev/interlinearizer-extension/issues).
