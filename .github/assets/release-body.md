## Interlinearizer

Interlinear glossing tools for Platform.Bible: gloss Scripture token by token, break words into
morphemes, link source and target phrases, and adjust segment boundaries.

This is a pre-release for testing and feedback. Expect rough edges, and expect the way analysis is
stored to keep changing between releases.

<!-- Maintainers: re-verify the Platform.Bible version below against each new build before
publishing. Check that the Interlinearizer tab actually renders, not just that the extension
activates in the log. -->

**Built against Platform.Bible v0.6.0-alpha** (paranext-core `main`). On the current public release,
v0.5.0, the extension loads but its window does not render — do not use v0.5.0 with this build.

### Installing

1. Download `interlinearizer_<version>.zip` from the **Assets** list below. Leave it zipped.
2. Copy it into Platform.Bible's extensions folder, which the app creates the first time it runs:
   - Windows: `%USERPROFILE%\.platform.bible\installed-extensions`
   - macOS: `~/.platform.bible/installed-extensions`
   - Linux ([Snap Store](https://snapcraft.io/platform-bible) install):
     `~/snap/platform-bible/common/app/installed-extensions`
3. Restart Platform.Bible.
4. Open a project from Home, then choose **Open Interlinearizer for this Project** from the Scripture
   Editor's **≡** menu.

Step-by-step instructions, first steps once it is open, and troubleshooting are in
[INSTALL.md](https://github.com/sillsdev/interlinearizer-extension/blob/main/INSTALL.md).

Please report problems at
[github.com/sillsdev/interlinearizer-extension/issues](https://github.com/sillsdev/interlinearizer-extension/issues).
