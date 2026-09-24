## Interlinearizer

Interlinear glossing tools for Platform.Bible: gloss Scripture token by token, break words into
morphemes, link source and target phrases, and adjust segment boundaries.

This is a pre-release for testing and feedback. Expect rough edges, and expect the way analysis is
stored to keep changing between releases.

> **Windows, macOS, and Linux.** The Linux build is a 64-bit Intel/AMD (`amd64`) snap. Please install
> the application from the assets below rather than from the Snap Store or the public Platform.Bible
> releases page — the extension loads there but its window comes up blank. Attaching the application
> build here is temporary: once Paratext 10 has publicly available releases of its own, these steps
> will send you there for it instead.

### Installing

Both files you need are in the **Assets** list below.

1. Download the Paratext 10 installer for your platform. This is the application build this release
   is meant to be used with.
   - **Windows** — `Paratext-10-Setup-<Studio version>.exe` (around 220 MB). Run it.
   - **macOS** — `Paratext-10-<Studio version>-universal.dmg` (around 460 MB). Open it and drag
     **Paratext 10** into **Applications**.
   - **Linux** — `paratext-10-studio_<Studio version>_amd64.snap` (around 260 MB). From the folder
     you downloaded it to, install it and connect it to its settings folder:

     ```bash
     sudo snap install --dangerous ./paratext-10-studio_<Studio version>_amd64.snap
     sudo snap connect paratext-10-studio:dot-paratext-10-studio
     ```

     Both lines need root. `--dangerous` installs a snap from a file rather than from the Snap
     Store: it skips the verification snapd normally does, so nothing vouches for where the file
     came from beyond the fact that you downloaded it from this page. The application still runs
     under the confinement and interface permissions the snap declares — this is not a grant of
     unlimited access to your system. The second line is not optional — it is what gives the
     application access to `~/.paratext-10-studio`, where it keeps its settings and your projects.

2. Start Paratext 10 once, then close it. This creates the folder used in step 4.
3. Download `interlinearizer_<version>.zip` and leave it zipped.
4. Copy it into the extensions folder:
   - **Windows** — `%USERPROFILE%\.paratext-10-studio\installed-extensions`. Paste that path straight
     into the File Explorer address bar.
   - **macOS** — `~/.paratext-10-studio/installed-extensions`. In Finder, choose **Go → Go to
     Folder…** and paste that path.
   - **Linux** — `~/snap/paratext-10-studio/common/app/installed-extensions`. It sits inside the
     snap's own folder because that is where a confined snap can unpack and run extensions from.
5. Restart Paratext 10. In the Scripture Editor that opens, choose **Open Interlinearizer for
   this Project** from its **≡** menu, then pick your project when the picker appears.

Meant to be used with Paratext 10 `<Studio version>`. Install both files from the same
release — mixing an Interlinearizer zip with a different version of the application is the usual
cause of a blank Interlinearizer window.

Step-by-step instructions, first steps once it is open, and troubleshooting are in
[INSTALL.md](https://github.com/sillsdev/interlinearizer-extension/blob/v<version>/INSTALL.md).

Please report problems at
[github.com/sillsdev/interlinearizer-extension/issues](https://github.com/sillsdev/interlinearizer-extension/issues).
