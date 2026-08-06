# Installing and running the Interlinearizer

This guide is for people who want to **use** the Interlinearizer in Platform.Bible. No development
tools are needed — you download two files and copy one of them into a folder.

If you want to build the extension from source instead, see the [README](README.md).

## 1. Install Platform.Bible

**Linux:** Platform.Bible is distributed as a snap, so it needs `snapd`. That comes preinstalled on
Ubuntu 18.04 and later, most Ubuntu flavors, KDE Neon, Manjaro, Solus, and Zorin OS. On other
distributions — Debian, Fedora, Arch, Linux Mint, Pop!\_OS, openSUSE and others — install it first
using [snapd's per-distribution instructions](https://snapcraft.io/docs/installing-snapd). Then get
Platform.Bible from the Snap Store:

[![Get it from the Snap Store](https://snapcraft.io/en/dark/install.svg)](https://snapcraft.io/platform-bible)

**Windows and macOS:** download the installer from the
[Platform.Bible releases page](https://github.com/paranext/paranext-core/releases) and run it:

| Platform | File                                     |
| -------- | ---------------------------------------- |
| Windows  | `Platform.Bible.Setup.<version>.exe`     |
| macOS    | `Platform.Bible-<version>-universal.dmg` |

(The releases page also carries a `platform-bible_<version>_amd64.snap` file, but on Linux the Snap
Store install above is simpler and keeps itself up to date.)

Start Platform.Bible once to confirm it runs, then close it again.

> **Version note.** The 0.0.1 build is made against Platform.Bible's development branch
> (v0.6.0-alpha). On v0.5.0 — the version the Snap Store currently gives you — the extension loads
> but its window comes up blank. Check the release notes for the version a given build needs.

## 2. Download the Interlinearizer

Open the
[Interlinearizer releases page](https://github.com/sillsdev/interlinearizer-extension/releases),
find the newest release, and download `interlinearizer_<version>.zip` from its **Assets** list.

**Leave the file zipped.** Platform.Bible unpacks it for you; an extracted folder is not what it
looks for here.

## 3. Copy the zip into Platform.Bible's extensions folder

| Platform | Folder                                                  |
| -------- | ------------------------------------------------------- |
| Windows  | `%USERPROFILE%\.platform.bible\installed-extensions`    |
| macOS    | `~/.platform.bible/installed-extensions`                |
| Linux    | `~/snap/platform-bible/common/app/installed-extensions` |

Platform.Bible creates this folder itself the first time it runs, which is why step 1 asks you to
start it once. Put the downloaded zip in it; nothing else needs to go there.

On Windows you can paste `%USERPROFILE%\.platform.bible\installed-extensions` straight into the File
Explorer address bar. On macOS use Finder's **Go → Go to Folder…** and paste
`~/.platform.bible/installed-extensions`. On Linux, the snap keeps its folder under `~/snap/`, not
under `~/.platform.bible/`:

```bash
cp ~/Downloads/interlinearizer_*.zip ~/snap/platform-bible/common/app/installed-extensions/
```

## 4. Restart Platform.Bible

Platform.Bible reads the extensions folder when it starts, so close it fully and open it again.

## 5. Open the Interlinearizer

1. Open a project: click the **Home** button in the toolbar, find your project in the list, and click
   **Open**. The project opens in a Scripture Editor tab.
2. In that Scripture Editor tab, click the **≡** (Project) menu button in its toolbar.
3. Choose **Open Interlinearizer for this Project**.

The Interlinearizer opens in a new tab, showing the text of the book you are currently on.

> If you pick the menu item without a project loaded in the editor, a project picker appears first —
> choose the project you want there.

## First steps once it is open

- **Add a gloss** by clicking the box under a word and typing. Suggestions from glosses you have
  already entered appear as you type; press Enter or click one to accept it.
- **Change what is shown** with the ⚙ **View options** button — continuous scroll, morpheme
  breakdowns, free translation, verse gutter, and suggestions can each be turned on and off.
- **Save your work** from the **Project** menu at the top of the Interlinearizer tab. Your edits are
  continuously kept in a working draft, and **Save** / **Save As…** write that draft to a named
  interlinear project. **Select Interlinear Project…** switches between projects for the same source
  text, and **New Interlinear Project…** starts a fresh one.

## Updating to a newer version

Delete the old `interlinearizer_<version>.zip` from the extensions folder, copy the new one in, and
restart Platform.Bible. Your saved interlinear projects are stored separately and are not affected.

## Uninstalling

Delete `interlinearizer_<version>.zip` from the extensions folder and restart Platform.Bible.

## If something goes wrong

- **The Interlinearizer menu item is missing.** It lives in the Scripture Editor's **≡** menu, not in
  the main application menu — make sure you are on a Scripture Editor tab and not on Home. If it is
  still missing, the extension did not load: re-check that the zip is in the folder listed above,
  that it is still a `.zip` (not extracted, not renamed), and that you restarted the application. On
  Linux the snap looks only under `~/snap/platform-bible/common/app/installed-extensions` — a zip
  placed in `~/.platform.bible/installed-extensions` is silently ignored, even though that folder
  exists and holds your projects.
- **The Interlinearizer opens but the text is empty.** Navigate to a book and chapter that exists in
  the project you opened.
- **Anything else.** Please report it at
  [github.com/sillsdev/interlinearizer-extension/issues](https://github.com/sillsdev/interlinearizer-extension/issues),
  including your Platform.Bible version and the Interlinearizer version from the zip file name.
