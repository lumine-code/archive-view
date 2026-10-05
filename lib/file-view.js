const { CompositeDisposable, Disposable } = require("lumine");
const path = require("path");
const fs = require("fs");
const os = require("os");
const temp = require("@lumine-code/fs-temp");

const archive = require("./archive");
const TEMP_PREFIX = "lumine-archive-view-";

module.exports = class FileView {
  constructor(parentView, indexInParentView, archivePath, entry) {
    this.disposables = new CompositeDisposable();
    this.parentView = parentView;
    this.indexInParentView = indexInParentView;
    this.archivePath = archivePath;
    this.entry = entry;
    this.destroyed = false;

    this.element = document.createElement("li");
    this.element.classList.add("list-item", "entry");
    this.element.tabIndex = -1;

    try {
      this.name = document.createElement("span");
      this.name.textContent = this.entry.getName();
      // An entry inside an archive is not on disk, so `virtual` keeps the
      // built-in provider from stat'ing a path that can never resolve.
      this.bindIcon();
      this.element.appendChild(this.name);

      const clickHandler = () => {
        this.openFile();
      };
      this.element.addEventListener("click", clickHandler);
      this.disposables.add(
        new Disposable(() => {
          this.element.removeEventListener("click", clickHandler);
        }),
      );
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  bindIcon() {
    this.iconDisposable?.dispose();
    this.iconDisposable = lumine.icons.applyTo(
      this.name,
      {
        path: path.join(this.archivePath, this.entry.getPath()),
        context: "archive-view",
        hints: { directory: false, virtual: true },
      },
      { classes: ["file"], name: this.entry.getName() },
    );
  }

  setArchivePath(nextPath) {
    if (this.destroyed || nextPath === this.archivePath) return;
    this.archivePath = nextPath;
    this.bindIcon();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.iconDisposable?.dispose();
    this.iconDisposable = null;
    this.disposables.dispose();
    this.element.remove();
  }

  logError(message, error) {
    console.error(message, error?.stack ?? error);
  }

  async openFile() {
    let root = this.parentView;
    while (root.parentView) root = root.parentView;
    const version = root.resourceVersion;
    const archivePath = this.archivePath;
    const current = () =>
      !this.destroyed &&
      !root.destroyed &&
      root.resourceVersion === version &&
      root.getPath() === archivePath;
    if (!current()) return false;
    let tempDirectory;
    let opened = false;
    let failureContext = `Error reading from ${archivePath}`;
    const invoke = (method, ...args) =>
      new Promise((resolve, reject) => {
        method(...args, (error, value) => (error ? reject(error) : resolve(value)));
      });
    try {
      const contents = await invoke(archive.readFile, archivePath, this.entry.getPath());
      if (!current()) return false;
      failureContext = "Error creating extraction directory";
      tempDirectory = await invoke(temp.mkdir, TEMP_PREFIX);
      if (!current()) return false;
      const archiveDirectory = path.join(tempDirectory, path.basename(archivePath));
      failureContext = `Error creating archive directory ${archiveDirectory}`;
      await fs.promises.mkdir(archiveDirectory, { recursive: true });
      if (!current()) return false;
      const filePath = path.join(archiveDirectory, this.entry.getName());
      failureContext = `Error writing to ${filePath}`;
      await fs.promises.writeFile(filePath, contents);
      if (!current()) return false;
      failureContext = `Error opening ${filePath}`;
      opened = Boolean(await lumine.workspace.open(filePath));
      return opened;
    } catch (error) {
      if (current()) this.logError(failureContext, error);
      return false;
    } finally {
      if (!opened) await this.cleanupTempDirectory(tempDirectory);
    }
  }

  cleanupTempDirectory(directory) {
    if (!directory) return Promise.resolve();
    const target = path.resolve(directory);
    const parent = path.resolve(os.tmpdir());
    const equalPath = (a, b) =>
      process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
    if (!equalPath(path.dirname(target), parent) || !path.basename(target).startsWith(TEMP_PREFIX))
      return Promise.resolve();
    return fs.promises
      .rm(target, { recursive: true, force: true, maxRetries: 3 })
      .catch((error) => {
        this.logError(`Error cleaning cancelled extraction ${target}`, error);
      });
  }

  select() {
    if (this.destroyed) return;
    this.parentView.selectFile(this);
  }
};
