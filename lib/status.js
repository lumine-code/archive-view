const { CompositeDisposable } = require("lumine");

const ArchiveEditorView = require("./archive-editor-view");

module.exports = class ArchiveEditorStatusView {
  constructor(statusBar) {
    this.statusBar = statusBar;
    this.disposables = new CompositeDisposable(
      lumine.workspace.getCenter().onDidChangeActivePaneItem(() => this.subscribeToActiveArchive()),
    );

    this.element = document.createElement("status-bar-tile");
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

    const editor = lumine.workspace.getCenter().getActivePaneItem();
    if (editor instanceof ArchiveEditorView) {
      this.summarySubscription = editor.onDidChangeSummary(() => this.updateSummary());
    }
    this.updateSummary();
  }

  updateSummary() {
    const editor = lumine.workspace.getCenter().getActivePaneItem();
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
