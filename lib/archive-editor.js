const fs = require("fs");
const path = require("path");
const { CompositeDisposable, Disposable } = require("lumine");

const ArchiveEditorView = require("./archive-editor-view");
const etch = require("@lumine-code/etch");

// Etch holds its scheduler per copy of the library, and this package resolves
// its own copy — so the assignment the editor makes on core's copy never
// reaches it. Point it at the view registry before anything renders, or this
// package's DOM writes land on an animation frame of their own alongside the
// editor's and force a synchronous reflow.
etch.setScheduler(lumine.views);

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "archive-view",
      tips: [
        "You can open a .zip, .tar, .jar, or .whl archive from the tree view and browse its contents in a tab.",
      ],
    };
  },

  activate() {
    this.archiveEditorStatusView = null;
    this.disposables = new CompositeDisposable(
      lumine.workspace.addOpener((filePath = "") => {
        // Check that filePath exists before opening, in case a remote URI was given
        if (!isPathSupported(filePath)) return;
        let isFile = false;
        try {
          isFile = fs.statSync(filePath)?.isFile();
        } catch {
          /* not statable; treat as absent */
        }
        if (isFile) {
          return new ArchiveEditorView(filePath);
        }
      }),
      lumine.workspace
        .getCenter()
        .onDidChangeActivePaneItem(() => this.attachArchiveEditorStatusView()),
    );
  },

  deactivate() {
    this.archiveEditorStatusView?.destroy();
    this.archiveEditorStatusView = null;
    this.statusBar = null;
    this.disposables.dispose();
    for (const item of lumine.workspace.getPaneItems()) {
      if (item instanceof ArchiveEditorView) {
        item.destroy();
      }
    }
  },

  consumeStatusBar(statusBar) {
    this.statusBar = statusBar;
    this.attachArchiveEditorStatusView();
    return new Disposable(() => {
      if (this.statusBar !== statusBar) return;
      this.archiveEditorStatusView?.destroy();
      this.archiveEditorStatusView = null;
      this.statusBar = null;
    });
  },

  attachArchiveEditorStatusView() {
    if (this.archiveEditorStatusView || this.statusBar == null) return;
    if (!(lumine.workspace.getCenter().getActivePaneItem() instanceof ArchiveEditorView)) return;

    const ArchiveEditorStatusView = require("./status");
    this.archiveEditorStatusView = new ArchiveEditorStatusView(this.statusBar);
    this.archiveEditorStatusView.attach();
  },

  deserialize(params = {}) {
    let isFile = false;
    try {
      isFile = fs.statSync(params.path)?.isFile();
    } catch {
      /* not statable; treat as absent */
    }
    if (isFile) {
      return new ArchiveEditorView(params.path);
    } else {
      console.warn(
        `Can't build ArchiveEditorView for path "${params.path}"; file no longer exists`,
      );
    }
  },
};

function isPathSupported(filePath) {
  switch (path.extname(filePath)) {
    case ".egg":
    case ".epub":
    case ".jar":
    case ".love":
    case ".nupkg":
    case ".tar":
    case ".tgz":
    case ".war":
    case ".whl":
    case ".xpi":
    case ".zip":
      return true;
    case ".gz":
      return path.extname(path.basename(filePath, ".gz")) === ".tar";
    default:
      return false;
  }
}
