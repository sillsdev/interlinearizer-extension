# Installing and running the Interlinearizer

This guide is for people who want to **use** the Interlinearizer. No development tools are needed —
you download two files, install one application, and copy the other file into a folder.

If you want to build the extension from source instead, see the [README](README.md).

> **Windows and Linux.** There is no macOS build. The Linux build is a 64-bit Intel/AMD (`amd64`)
> snap; there is no ARM build. On either platform, please install the application from the release
> rather than from the Snap Store or the public Platform.Bible releases page — those versions load
> the extension but show a blank window.

## 1. Install Paratext 10 Studio

The Interlinearizer runs inside **Paratext 10 Studio**, the application built on Platform.Bible. The
build you need is attached to each Interlinearizer release, so there is nothing to hunt for
elsewhere — and it is the build that release is meant to be used with.

> **Carrying the application build in the release is temporary.** Once Paratext 10 Studio has
> publicly available releases of its own, these instructions will send you there for the application
> instead of attaching a copy of it to every Interlinearizer release.

1. Open the
   [Interlinearizer releases page](https://github.com/sillsdev/interlinearizer-extension/releases)
   and find the newest release.
2. From its **Assets** list, download the build for your platform:
   - **Windows** — `Paratext.10.Studio.Setup.<Studio version>-Windows.zip` (around 240 MB)
   - **Linux** — `Paratext.10.Studio.Setup.<Studio version>-Linux.zip` (around 280 MB)

### On Windows

Extract the zip and run the `Paratext 10 Studio Setup` installer inside it.

### On Linux

Extract the zip. Inside is a single `paratext-10-studio_<Studio version>_amd64-<build>.snap` file.
Install it, then connect it to its own settings folder:

```bash
sudo snap install --dangerous paratext-10-studio_<Studio version>_amd64-<build>.snap
sudo snap connect paratext-10-studio:dot-paratext-10-studio
```

Both lines need root, and both are worth understanding before you run them.

`--dangerous` is what installs a snap from a file rather than from the Snap Store. The file is
unsigned: nothing verifies where it came from beyond the fact that you downloaded it yourself, and it
is installed with full system privileges. So take it from the releases page linked above rather than
from anyone who passes you a copy, and check that its name matches the release you are installing.

The `snap connect` line is not optional. It grants the application access to `~/.paratext-10-studio`,
where it keeps its settings and your projects. A snap installed from the Snap Store would be granted
this automatically; one installed from a file has to be connected by hand.

Start the application from your desktop's application menu, or with:

```bash
snap run paratext-10-studio
```

### Both platforms

Start Paratext 10 Studio once to confirm it runs, then close it again. That first run creates the
folder you will need in step 3.

> **Keep the pair together.** Each Interlinearizer build is meant to be used with the application
> build published alongside it. Mixing an Interlinearizer zip with a different version of the
> application is the usual cause of a blank Interlinearizer window.

## 2. Download the Interlinearizer

From that same release's **Assets** list, download `interlinearizer_<version>.zip`.

**Leave the file zipped.** Paratext 10 Studio unpacks it for you; an extracted folder is not what it
looks for here.

## 3. Copy the zip into the extensions folder

### On Windows

Paste this into the File Explorer address bar:

```text
%USERPROFILE%\.paratext-10-studio\installed-extensions
```

### On Linux

Copy the zip into:

```bash
~/snap/paratext-10-studio/common/app/installed-extensions
```

The extensions folder sits inside the snap's own folder rather than next to the settings in
`~/.paratext-10-studio`, because that is the location a confined snap can unpack and run extensions
from.

### Both platforms

Put the downloaded zip in that folder; nothing else needs to go there. Paratext 10 Studio creates the
folder itself the first time it runs, which is why step 1 asks you to start it once.

## 4. Restart Paratext 10 Studio

The application reads the extensions folder when it starts, so close it fully and open it again.

## 5. Open the Interlinearizer

In Simple mode — the default — Paratext 10 Studio opens with a Scripture Editor already on screen,
before you have loaded any project. You can go straight from there to the Interlinearizer, and pick
your project on the way:

1. In the Scripture Editor, click the **≡** (Project) menu button in its toolbar.
2. Choose **Open Interlinearizer for this Project**.
3. A project picker appears. Choose the project you want to gloss.

The Interlinearizer opens in a new tab, showing the text of the book you are currently on.

> If you have already loaded a project into the Scripture Editor — from the **Home** tab, say — no
> picker appears. The Interlinearizer opens for that project directly.

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
restart Paratext 10 Studio. Your saved interlinear projects are stored separately and are not
affected.

If a release also carries a new application build, install that too — see the note in step 1 about
keeping the pair together. On Linux, installing a newer snap over the old one keeps your settings;
run the `snap connect` line again if `snap connections paratext-10-studio` shows the
`dot-paratext-10-studio` slot as unconnected.

## Uninstalling

Delete `interlinearizer_<version>.zip` from the extensions folder and restart Paratext 10 Studio.

To remove the application itself on Linux, run `sudo snap remove paratext-10-studio`.

## If something goes wrong

- **The Interlinearizer menu item is missing.** It lives in the Scripture Editor's **≡** menu, not in
  the main application menu — make sure you are on a Scripture Editor tab and not on Home. If it is
  still missing, the extension did not load: re-check that the zip is in the extensions folder named
  in step 3, that it is still a `.zip` (not extracted, not renamed), and that you restarted the
  application.
- **The Interlinearizer tab opens but stays blank.** This usually means the extension and the
  application come from different releases. Reinstall both from the same release.
- **The Interlinearizer opens but the text is empty.** Navigate to a book and chapter that exists in
  the project you opened.
- **On Linux, the application will not start or loses its settings.** Check that its settings folder
  is connected — `snap connections paratext-10-studio` should list `dot-paratext-10-studio` as
  connected rather than as a dash. If it shows a dash, run the `snap connect` line from step 1.
- **Anything else.** Please report it at
  [github.com/sillsdev/interlinearizer-extension/issues](https://github.com/sillsdev/interlinearizer-extension/issues),
  including your Paratext 10 Studio version and the Interlinearizer version from the zip file name.
