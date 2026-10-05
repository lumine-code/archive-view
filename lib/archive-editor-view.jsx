/** @jsx etch.dom */
const fs = require("fs");
const path = require("path");
const { CompositeDisposable, Disposable, Emitter, watchFile } = require("lumine");
const etch = require("@lumine-code/etch");

const archive = require("./archive");
const { formatCount, formatFileSize } = require("./format-summary");
const FileView = require("./file-view");
const DirectoryView = require("./directory-view");

module.exports = class ArchiveEditorView {
  constructor(archivePath) {
    this.disposables = new CompositeDisposable();
    this.emitter = new Emitter();
    this.path = archivePath;
    this.fileState = fs.existsSync(this.path) ? "unmodified" : "removed";
    this.fileOperationDepth = 0;
    this.fileSubscriptions = new CompositeDisposable();
    this.observedDiskFingerprint = this.diskFingerprint();
    this.resourceVersion = 0;
    this.requestGeneration = 0;
    this.currentRequest = null;
    this.loaded = false;
    this.destroyed = false;
    this.entries = [];
    this.selectedFile = null;
    this.summary = "";
    etch.initialize(this);

    this.watchFile();
    this.disposables.add(
      lumine.workspace.registerFileDocument({
        owner: this,
        getPath: () => this.path,
        setPath: (nextPath) => this.setPath(nextPath),
        beginFileOperation: () => {
          this.fileOperationDepth++;
          this.needsFileRefresh = true;
          this.cancelRequest();
        },
        endFileOperation: () => {
          this.fileOperationDepth--;
          this.reconcileFile();
        },
      }),
    );

    const focusHandler = () => this.focusSelectedFile();
    const clickHandler = (event) => {
      if (event.target.closest(".list-item")) return;
      this.clearSelection();
      this.element.focus();
    };

    this.element.addEventListener("focus", focusHandler);
    this.element.addEventListener("click", clickHandler);
    this.disposables.add(
      new Disposable(() => {
        this.element.removeEventListener("focus", focusHandler);
        this.element.removeEventListener("click", clickHandler);
      }),
      lumine.commands.add(this.element, {
        "core:confirm": () => this.selectedFile?.openFile(),
        "core:move-down": () => {
          if (this.selectedFile) {
            this.selectedFile.parentView.selectFileAfterIndex(this.selectedFile.indexInParentView);
          } else {
            this.selectFileAfterIndex(-1);
          }
        },
        "core:move-up": () => {
          if (this.selectedFile) {
            this.selectedFile.parentView.selectFileBeforeIndex(this.selectedFile.indexInParentView);
          } else {
            this.selectFileBeforeIndex(this.entries.length);
          }
        },
      }),
    );
    this.refresh();
  }

  update() {}

  createFileWatcher(filePath) {
    const file = watchFile(filePath);
    const watcher = { file, subscriptions: new CompositeDisposable(file), changed: false };
    const reconcile = () => {
      if (this.file === file) this.reconcileFile(true);
      else watcher.changed = true;
    };
    try {
      watcher.subscriptions.add(
        file.onDidChange(reconcile),
        file.onDidInvalidate(reconcile),
        file.onDidError((error) => {
          if (this.file === file) console.error("Unable to watch archive", error);
          else watcher.error = error;
        }),
      );
      // Staging can fail before a caller reaches the ready await.
      watcher.ready = Promise.resolve(file.ready);
      watcher.ready.catch(() => {});
      return watcher;
    } catch (error) {
      watcher.subscriptions.dispose();
      throw error;
    }
  }

  installFileWatcher(watcher) {
    const oldSubscriptions = this.fileSubscriptions;
    this.file = watcher.file;
    this.fileSubscriptions = watcher.subscriptions;
    this.watcherReady = watcher.ready;
    oldSubscriptions.dispose();
    watcher.ready.then(
      () => {
        if (this.file === watcher.file) this.reconcileFile(watcher.changed);
      },
      () => {},
    );
  }

  watchFile() {
    this.installFileWatcher(this.createFileWatcher(this.path));
  }

  setPath(nextPath) {
    if (nextPath === this.path) return;
    const watcher = this.createFileWatcher(nextPath);
    const oldURI = this.getURI();
    this.cancelRequest();
    this.resourceVersion++;
    this.path = nextPath;
    this.observedDiskFingerprint = this.diskFingerprint();
    this.installFileWatcher(watcher);
    for (const entry of this.entries) entry.setArchivePath(nextPath);
    this.emitter.emit("did-change-path", nextPath);
    this.emitter.emit("did-change-uri", { oldURI, newURI: nextPath });
    this.emitter.emit("did-change-title");
    this.refresh();
  }

  onDidChangePath(callback) {
    return this.emitter.on("did-change-path", callback);
  }

  onDidChangeURI(callback) {
    return this.emitter.on("did-change-uri", callback);
  }

  diskFingerprint() {
    try {
      return this.fingerprintForStats(fs.statSync(this.path));
    } catch {
      return null;
    }
  }

  fingerprintForStats(stats) {
    return `${stats.mtimeMs}:${stats.size}`;
  }

  matchesFileRevision(filePath, stats) {
    const current = fs.statSync(filePath);
    if (!current.isFile()) throw new Error("Archive path is not a file");
    return this.fingerprintForStats(current) === this.fingerprintForStats(stats);
  }

  reconcileFile(force = false) {
    if (this.destroyed) return;
    if (this.fileOperationDepth) {
      this.needsFileRefresh = true;
      return;
    }
    if (this.currentRequest?.kind === "replace" && !this.currentRequest.controller.signal.aborted) {
      this.currentRequest.deferredRefreshFile = this.file;
      return;
    }
    const exists = fs.existsSync(this.path);
    const fingerprint = exists ? this.diskFingerprint() : null;
    force ||= this.needsFileRefresh;
    this.needsFileRefresh = false;
    if (!force && fingerprint === this.observedDiskFingerprint) return;
    this.observedDiskFingerprint = fingerprint;
    this.setFileState(exists ? "unmodified" : "removed");
    if (exists) return this.refresh();
  }

  render() {
    return (
      <div className="archive-editor" tabIndex="-1">
        <div className="archive-container">
          <div
            ref="loadingMessage"
            className="padded icon icon-hourglass text-info"
          >{`Loading archive\u2026`}</div>
          <div ref="errorMessage" className="padded icon icon-alert text-error" />
          <div className="inset-panel">
            <ol ref="tree" className="archive-tree padded list-tree has-collapsable-children" />
          </div>
        </div>
      </div>
    );
  }

  copy() {
    return new ArchiveEditorView(this.path);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resourceVersion++;
    this.cancelRequest();
    this.fileSubscriptions.dispose();
    this.clearSelection();
    this.disposeEntries(this.entries);
    this.entries = [];
    this.disposables.dispose();
    this.emitter.emit("did-destroy");
    this.emitter.dispose();
    etch.destroy(this);
  }

  isDestroyed() {
    return this.destroyed;
  }

  onDidDestroy(callback) {
    return this.emitter.on("did-destroy", callback);
  }

  onDidChangeTitle(callback) {
    return this.emitter.on("did-change-title", callback);
  }

  getFileState() {
    return this.fileState;
  }

  onDidChangeFileState(callback) {
    return this.emitter.on("did-change-file-state", callback);
  }

  setFileState(fileState) {
    if (fileState === this.fileState) return;
    this.fileState = fileState;
    this.emitter.emit("did-change-file-state", fileState);
  }

  serialize() {
    return {
      deserializer: this.constructor.name,
      path: this.path,
    };
  }

  getPath() {
    return this.path;
  }

  getTitle() {
    return this.path ? path.basename(this.path) : "untitled";
  }

  getURI() {
    return this.path;
  }

  canReplaceArchive() {
    return !this.destroyed && this.fileState === "unmodified" && this.fileOperationDepth === 0;
  }

  cancelRequest() {
    this.currentRequest?.controller.abort();
  }

  beginRequest(kind, signal) {
    const previous = this.currentRequest;
    this.cancelRequest();
    const request = {
      kind,
      generation: ++this.requestGeneration,
      controller: new AbortController(),
      deferredRefreshFile:
        previous?.deferredRefreshFile || (previous?.kind === "refresh" ? this.file : null),
    };
    const abort = () => request.controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    request.dispose = () => signal?.removeEventListener("abort", abort);
    this.currentRequest = request;
    if (signal?.aborted || this.destroyed) abort();
    return request;
  }

  assertRequest(request) {
    if (
      this.destroyed ||
      this.fileOperationDepth ||
      request !== this.currentRequest ||
      request.generation !== this.requestGeneration ||
      request.controller.signal.aborted
    ) {
      throw new DOMException("Archive load was cancelled", "AbortError");
    }
  }

  waitForRequest(value, request) {
    this.assertRequest(request);
    return new Promise((resolve, reject) => {
      const signal = request.controller.signal;
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(new DOMException("Archive load was cancelled", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(value).then(
        (result) => {
          signal.removeEventListener("abort", abort);
          resolve(result);
        },
        (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
    });
  }

  finishRequest(request) {
    request.dispose();
    request.controller.abort();
    if (this.currentRequest === request) this.currentRequest = null;
  }

  readArchiveEntries(filePath) {
    return new Promise((resolve, reject) => {
      // The pinned archive library exposes no cancellation handle. A cancelled
      // request stops awaiting this promise and never touches the view later.
      archive.list(filePath, { tree: true }, (error, entries) => {
        if (error) reject(error instanceof Error ? error : new Error(String(error)));
        else resolve(entries);
      });
    });
  }

  async stageArchive(filePath, request, watcher) {
    while (true) {
      if (watcher) watcher.changed = false;
      const [entries, stats] = await this.waitForRequest(
        Promise.all([
          this.readArchiveEntries(filePath),
          fs.promises.stat(filePath),
          watcher ? watcher.ready : this.watcherReady,
        ]),
        request,
      );
      this.assertRequest(request);
      if (watcher?.error) throw watcher.error;
      if (!stats.isFile()) throw new Error("Archive path is not a file");
      if (watcher?.changed) continue;
      const tree = this.stageTreeEntries(entries, filePath);
      try {
        this.assertRequest(request);
        if (watcher?.error) throw watcher.error;
        if (watcher?.changed || !this.matchesFileRevision(filePath, stats)) {
          this.disposeEntries(tree.entries);
          continue;
        }
        tree.summary = this.summaryForEntries(tree.entries, stats.size);
        return { tree, stats };
      } catch (error) {
        this.disposeEntries(tree.entries);
        throw error;
      }
    }
  }

  async replaceArchive(filePath, { signal } = {}) {
    if (!this.canReplaceArchive()) return false;
    const request = this.beginRequest("replace", signal);
    this.resourceVersion++;
    let watcher,
      staged,
      committed = false;
    try {
      this.assertRequest(request);
      watcher = this.createFileWatcher(filePath);
      do {
        if (staged) {
          this.disposeEntries(staged.tree.entries);
          staged = null;
        }
        staged = await this.stageArchive(filePath, request, watcher);
        this.assertRequest(request);
      } while (!this.matchesFileRevision(filePath, staged.stats));
      if (!this.canReplaceArchive())
        throw new DOMException("Archive load was cancelled", "AbortError");
      const oldURI = this.getURI();
      this.path = filePath;
      this.observedDiskFingerprint = this.fingerprintForStats(staged.stats);
      this.installFileWatcher(watcher);
      this.commitTreeEntries(staged.tree, { resetScroll: true });
      committed = true;
      this.setFileState("unmodified");
      if (oldURI !== filePath) {
        this.emitter.emit("did-change-path", filePath);
        this.emitter.emit("did-change-uri", { oldURI, newURI: filePath });
      }
      this.emitter.emit("did-change-title");
      return true;
    } catch (error) {
      if (error.name !== "AbortError" && !request.controller.signal.aborted && !this.destroyed) {
        lumine.notifications.addError("Unable to open archive", {
          description: error.message,
          dismissable: true,
        });
      }
      throw error;
    } finally {
      if (!committed) {
        if (staged) this.disposeEntries(staged.tree.entries);
        watcher?.subscriptions.dispose();
      }
      const reconcile =
        this.currentRequest === request && request.deferredRefreshFile === this.file;
      this.finishRequest(request);
      if (reconcile && !this.destroyed) await this.reconcileFile(true);
    }
  }

  async refresh() {
    if (this.destroyed) return false;
    if (this.fileOperationDepth) {
      this.needsFileRefresh = true;
      return false;
    }
    if (this.currentRequest?.kind === "replace" && !this.currentRequest.controller.signal.aborted) {
      this.currentRequest.deferredRefreshFile = this.file;
      return false;
    }
    const request = this.beginRequest("refresh");
    let staged,
      committed = false;
    if (!this.loaded) {
      this.refs.tree.style.display = "none";
      this.refs.loadingMessage.style.display = "";
      this.refs.errorMessage.style.display = "none";
    }
    try {
      do {
        if (staged) {
          this.disposeEntries(staged.tree.entries);
          staged = null;
        }
        staged = await this.stageArchive(this.path, request);
        this.assertRequest(request);
      } while (!this.matchesFileRevision(this.path, staged.stats));
      this.observedDiskFingerprint = this.fingerprintForStats(staged.stats);
      this.commitTreeEntries(staged.tree);
      committed = true;
      this.setFileState("unmodified");
      return true;
    } catch (error) {
      if (error.name !== "AbortError" && this.currentRequest === request && !this.destroyed) {
        const detail = error.message ? `: ${error.message}` : "";
        this.refs.errorMessage.textContent = `Reading the archive file failed${detail}`;
        this.refs.errorMessage.style.display = "";
        this.refs.loadingMessage.style.display = "none";
      }
      return false;
    } finally {
      if (staged && !committed) this.disposeEntries(staged.tree.entries);
      this.finishRequest(request);
    }
  }

  stageTreeEntries(entries, archivePath) {
    const views = [];
    const fragment = document.createDocumentFragment();
    try {
      for (const [index, entry] of entries.entries()) {
        const EntryView = entry.isDirectory() ? DirectoryView : FileView;
        const view = new EntryView(this, index, archivePath, entry);
        views.push(view);
        fragment.appendChild(view.element);
      }
      return { entries: views, fragment };
    } catch (error) {
      this.disposeEntries(views);
      throw error;
    }
  }

  disposeEntries(entries) {
    for (const entry of entries) {
      try {
        entry.destroy();
      } catch (error) {
        console.error("Unable to dispose archive entry", error);
      }
    }
  }

  commitTreeEntries(tree, { resetScroll = false } = {}) {
    const hadFocus = this.element.contains(document.activeElement);
    const oldEntries = this.entries;
    this.resourceVersion++;
    this.clearSelection();
    this.entries = tree.entries;
    this.refs.tree.replaceChildren(tree.fragment);
    this.loaded = true;
    this.refs.tree.style.display = "";
    this.refs.loadingMessage.style.display = "none";
    this.refs.errorMessage.style.display = "none";
    if (resetScroll) {
      this.element.scrollTop = 0;
      this.refs.tree.scrollTop = 0;
    }
    this.disposeEntries(oldEntries);
    this.setSummary(tree.summary);
    if (hadFocus) this.element.focus();
  }

  createTreeEntries(entries) {
    const tree = this.stageTreeEntries(entries, this.path);
    tree.summary = this.summaryForEntries(tree.entries);
    this.commitTreeEntries(tree);
  }

  updateSummary() {
    this.setSummary(this.summaryForEntries(this.entries));
  }

  summaryForEntries(entries, fileSize) {
    const fileCount = entries.filter((entry) => entry instanceof FileView).length;
    const fileLabel = fileCount === 1 ? "1 file" : `${formatCount(fileCount)} files`;

    const directoryCount = entries.filter((entry) => entry instanceof DirectoryView).length;
    const directoryLabel =
      directoryCount === 1 ? "1 folder" : `${formatCount(directoryCount)} folders`;

    if (fileSize == null) {
      try {
        fileSize = fs.statSync(this.path)?.size;
      } catch {
        // The summary can still render when the archive path is unavailable.
      }
    }
    if (fileSize == null) fileSize = -1;
    return `${formatFileSize(fileSize)} with ${fileLabel} and ${directoryLabel}`;
  }

  getSummary() {
    return this.summary;
  }

  setSummary(summary) {
    if (summary === this.summary) return;
    this.summary = summary;
    this.emitter.emit("did-change-summary", summary);
  }

  onDidChangeSummary(callback) {
    return this.emitter.on("did-change-summary", callback);
  }

  focusSelectedFile() {
    if (!this.selectedFile) return false;
    this.selectedFile.element.focus();
    return true;
  }

  selectFile(file) {
    this.clearSelection();
    this.selectedFile = file;
    file.element.classList.add("selected");
    file.element.focus();
  }

  clearSelection() {
    if (!this.selectedFile) return;
    this.selectedFile.element.classList.remove("selected");
    this.selectedFile = null;
  }

  selectFileBeforeIndex(index) {
    for (let i = index - 1; i >= 0; i--) {
      const previousEntry = this.entries[i];
      if (previousEntry instanceof FileView) {
        previousEntry.select();
        break;
      } else {
        if (previousEntry.selectLastFile()) {
          break;
        }
      }
    }
  }

  selectFileAfterIndex(index) {
    for (let i = index + 1; i < this.entries.length; i++) {
      const nextEntry = this.entries[i];
      if (nextEntry instanceof FileView) {
        nextEntry.select();
        break;
      } else {
        if (nextEntry.selectFirstFile()) {
          break;
        }
      }
    }
  }

  focus() {
    if (!this.focusSelectedFile()) this.element.focus();
  }
};
