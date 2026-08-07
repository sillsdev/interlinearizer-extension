# Installing and running the Interlinearizer

This guide is for people who want to **use** the Interlinearizer. No development tools are needed —
you download two files, run one installer, and copy the other file into a folder.

If you want to build the extension from source instead, see the [README](README.md).

> **Windows only for now.** The application build that this extension needs is currently available
> for Windows alone. A Linux build has been requested and should follow; there is no macOS build. If
> you are not on Windows, please hold off rather than installing Platform.Bible from the Snap Store
> or the public releases page — those versions load the extension but show a blank window.

## 1. Install Paratext 10 Studio

The Interlinearizer runs inside **Paratext 10 Studio**, the application built on Platform.Bible. The
build you need is attached to each Interlinearizer release, so there is nothing to hunt for
elsewhere — and it is the build that release is meant to be used with.

1. Open the
   [Interlinearizer releases page](https://github.com/sillsdev/interlinearizer-extension/releases)
   and find the newest release.
2. From its **Assets** list, download
   `Paratext.10.Studio.Setup.<version>-Windows.zip` (around 240 MB).
3. Extract the zip and run the `Paratext 10 Studio Setup` installer inside it.

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

Paste this into the File Explorer address bar:

```text
%USERPROFILE%\.platform.bible\installed-extensions
```

Put the downloaded zip in that folder; nothing else needs to go there.

The folder is named `.platform.bible` rather than anything mentioning Paratext 10 Studio because the
extension API belongs to Platform.Bible, the framework the application is built on. That is expected
— it is the right folder.

Paratext 10 Studio creates this folder itself the first time it runs, which is why step 1 asks you to
start it once.

## 4. Restart Paratext 10 Studio

The application reads the extensions folder when it starts, so close it fully and open it again.

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
restart Paratext 10 Studio. Your saved interlinear projects are stored separately and are not
affected.

If a release also carries a new application build, install that too — see the note in step 1 about
keeping the pair together.

## Uninstalling

Delete `interlinearizer_<version>.zip` from the extensions folder and restart Paratext 10 Studio.

## If something goes wrong

- **The Interlinearizer menu item is missing.** It lives in the Scripture Editor's **≡** menu, not in
  the main application menu — make sure you are on a Scripture Editor tab and not on Home. If it is
  still missing, the extension did not load: re-check that the zip is in
  `%USERPROFILE%\.platform.bible\installed-extensions`, that it is still a `.zip` (not extracted, not
  renamed), and that you restarted the application.
- **The Interlinearizer tab opens but stays blank.** This usually means the extension and the
  application come from different releases. Reinstall both from the same release.
- **The Interlinearizer opens but the text is empty.** Navigate to a book and chapter that exists in
  the project you opened.
- **Anything else.** Please report it at
  [github.com/sillsdev/interlinearizer-extension/issues](https://github.com/sillsdev/interlinearizer-extension/issues),
  including your Paratext 10 Studio version and the Interlinearizer version from the zip file name.
