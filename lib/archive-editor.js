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
    this.statusBarConnections = new Map();
    this.disposables = new CompositeDisposable(
      lumine.workspace.addOpener(
        (filePath = "") => {
          if (!isPathSupported(filePath)) return;
          let isFile;
          try {
            isFile = fs.statSync(filePath).isFile();
          } catch {
            // An absent file or remote URI is left to another opener.
            return;
          }
          if (isFile) return new ArchiveEditorView(filePath);
        },
        {
          canReusePendingItem: (item, filePath) =>
            item instanceof ArchiveEditorView &&
            isPathSupported(filePath) &&
            item.canReplaceArchive(),
          reusePendingItem: (item, filePath, _options, { signal }) =>
            item.replaceArchive(filePath, { signal }),
        },
      ),
    );
  },

  deactivate() {
    const owner = this.disposables;
    this.disposables = null;
    this.retireStatusBarConnections();
    owner?.dispose();
    for (const item of lumine.workspace.getPaneItems()) {
      if (item instanceof ArchiveEditorView) {
        item.destroy();
      }
    }
  },

  consumeStatusBar(service) {
    return service.observeWindows(
      (scopedStatusBar, context) => this.consumeWindowStatusBar(scopedStatusBar, context),
      { windows: "all" },
    );
  },

  consumeWindowStatusBar(statusBar, context) {
    const owner = this.disposables,
      connections = this.statusBarConnections;
    if (!owner || owner.disposed || !connections) return new Disposable();
    let record = connections.get(statusBar);
    if (!record) {
      record = { statusBar, context, view: null, leases: 0, subscription: null };
      connections.set(statusBar, record);
      record.subscription = context.editorContainer.onDidChangeActivePaneItem(() =>
        this.attachArchiveEditorStatusView(),
      );
    }
    record.leases++;
    const lease = new Disposable(() => {
      owner.remove(lease);
      if (
        this.disposables !== owner ||
        this.statusBarConnections !== connections ||
        connections.get(statusBar) !== record
      )
        return;
      if (--record.leases) return;
      connections.delete(statusBar);
      record.subscription.dispose();
      const view = record.view;
      record.view = null;
      if (this.statusBar === statusBar) this.statusBar = [...connections.keys()].at(-1) ?? null;
      this.archiveEditorStatusView = connections.get(this.statusBar)?.view ?? null;
      view?.destroy();
    });
    owner.add(lease);
    this.statusBar = statusBar;
    try {
      this.attachArchiveEditorStatusView();
    } catch (error) {
      lease.dispose();
      throw error;
    }
    return lease;
  },

  retireStatusBarConnections() {
    const records = [...(this.statusBarConnections?.values() ?? [])];
    for (const record of records) record.subscription.dispose();
    const views = records.map((record) => record.view);
    this.statusBarConnections = new Map();
    this.archiveEditorStatusView = null;
    this.statusBar = null;
    for (const view of views) view?.destroy();
  },

  attachArchiveEditorStatusView() {
    const owner = this.disposables,
      connections = this.statusBarConnections;
    if (!owner || owner.disposed || !connections) return;
    const ArchiveEditorStatusView = require("./status");
    for (const record of connections.values()) {
      if (
        record.view ||
        !(record.context.editorContainer.getActivePaneItem() instanceof ArchiveEditorView)
      )
        continue;
      let view,
        committed = false;
      try {
        view = new ArchiveEditorStatusView(record.statusBar, record.context);
        view.attach();
        if (
          this.disposables !== owner ||
          owner.disposed ||
          this.statusBarConnections !== connections ||
          connections.get(record.statusBar) !== record
        )
          return;
        record.view = view;
        committed = true;
      } finally {
        if (!committed) view?.destroy();
      }
    }
    if (this.disposables === owner && this.statusBarConnections === connections) {
      this.archiveEditorStatusView = connections.get(this.statusBar)?.view ?? null;
    }
  },

  deserialize(params = {}) {
    let isFile = false;
    try {
      isFile = fs.statSync(params.path)?.isFile();
    } catch {
      /* not statable; treat as absent */
    }
    if (isFile) {
      return new ArchiveEditorView(params.path, { viewState: params.viewState });
    } else {
      console.warn(
        `Can't build ArchiveEditorView for path "${params.path}"; file no longer exists`,
      );
    }
  },
};

function isPathSupported(filePath) {
  if (typeof filePath !== "string" || /^[a-z][a-z\d+.-]*:\/\//i.test(filePath)) return false;
  switch (path.extname(filePath).toLowerCase()) {
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
      return path.extname(path.basename(filePath).slice(0, -3)).toLowerCase() === ".tar";
    default:
      return false;
  }
}
