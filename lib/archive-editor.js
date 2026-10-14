const fs = require("fs");
const path = require("path");
const { CompositeDisposable, Disposable } = require("lumine");

let ArchiveEditorView;

function getArchiveEditorView() {
  return (ArchiveEditorView ||= require("./archive-editor-view"));
}

function isArchiveEditorView(item) {
  return ArchiveEditorView != null && item instanceof ArchiveEditorView;
}

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
      lumine.workspace.addPathOpener({
        id: "archive-view",
        label: "Archive View",
        canOpen: (filePath = "") => isPathSupported(filePath),
        open: (filePath) => {
          if (fs.statSync(filePath).isFile()) {
            const View = getArchiveEditorView();
            return new View(filePath);
          }
        },
        handlesItem: (item) => isArchiveEditorView(item),
        canReusePendingItem: (item, filePath) =>
          isArchiveEditorView(item) && isPathSupported(filePath) && item.canReplaceArchive(),
        reusePendingItem: (item, filePath, _options, { signal }) =>
          item.replaceArchive(filePath, { signal }),
      }),
    );
  },

  deactivate() {
    const owner = this.disposables;
    this.disposables = null;
    this.retireStatusBarConnections();
    owner?.dispose();
    for (const item of lumine.workspace.getPaneItems()) {
      if (isArchiveEditorView(item)) {
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
    for (const record of connections.values()) {
      if (record.view || !isArchiveEditorView(record.context.editorContainer.getActivePaneItem()))
        continue;
      const ArchiveEditorStatusView = require("./status");
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
      const View = getArchiveEditorView();
      return new View(params.path, { viewState: params.viewState });
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
