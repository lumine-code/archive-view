const { CompositeDisposable } = require("lumine");

const ArchiveEditorView = require("./archive-editor-view");

module.exports = class ArchiveEditorStatusView {
  constructor(statusBar, context = {}) {
    this.window = context.window ?? lumine.workspace.getMainWindow();
    this.container = context.editorContainer ?? this.window.getEditorContainer();
    this.statusBar = statusBar;
    this.disposables = new CompositeDisposable(
      this.container.onDidChangeActivePaneItem(() => this.subscribeToActiveArchive()),
    );

    this.element = this.window.getDocument().createElement("status-bar-tile");
    this.element.classList.add("archive-status", "is-read-only");
  }

  attach() {
    if (this.statusBarTile) return;
    // View-info band, see the priority convention in the status-bar package README.
    this.statusBarTile = this.statusBar.addLeftTile({ item: this, priority: 530 });
    this.subscribeToActiveArchive();
  }

  subscribeToActiveArchive() {
    this.summarySubscription?.dispose();
    this.summarySubscription = null;

    const editor = this.container.getActivePaneItem();
    if (editor instanceof ArchiveEditorView) {
      this.summarySubscription = editor.onDidChangeSummary(() => this.updateSummary());
    }
    this.updateSummary();
  }

  updateSummary() {
    const editor = this.container.getActivePaneItem();
    const summary = editor instanceof ArchiveEditorView ? editor.getSummary() : "";
    this.element.textContent = summary;
    this.element.style.display = summary ? "" : "none";
  }

  destroy() {
    this.summarySubscription?.dispose();
    this.summarySubscription = null;
    this.statusBarTile?.destroy();
    this.statusBarTile = null;
    this.disposables.dispose();
  }
};
