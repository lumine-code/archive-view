const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Archive pending item reuse", () => {
  let workspace, pane, archive, ArchiveEditorView, view, directory;
  let firstPath, secondPath, thirdPath, zipPath, watchers, watchBehavior;

  function deferred() {
    let resolve, reject;
    const promise = new Promise((fulfill, fail) => {
      resolve = fulfill;
      reject = fail;
    });
    // A staged observation can be disposed before its owner starts awaiting it.
    promise.catch(() => {});
    return { promise, resolve, reject };
  }

  function fileEntry(name) {
    return {
      path: name,
      getName: () => name,
      getPath: () => name,
      isDirectory: () => false,
    };
  }

  function watch(filePath) {
    if (watchBehavior?.path === filePath && watchBehavior.error) throw watchBehavior.error;
    const { Disposable } = require("lumine");
    const readyGate = watchBehavior?.path === filePath ? watchBehavior.readyGate : null;
    const closed = deferred();
    const changes = new Set();
    const invalidations = new Set();
    const errors = new Set();
    const handle = {
      path: filePath,
      ready: readyGate?.promise || Promise.resolve(),
      closed: closed.promise,
      isDisposed: false,
      onDidChange(callback) {
        changes.add(callback);
        return new Disposable(() => changes.delete(callback));
      },
      onDidInvalidate(callback) {
        invalidations.add(callback);
        return new Disposable(() => invalidations.delete(callback));
      },
      onDidError(callback) {
        errors.add(callback);
        return new Disposable(() => errors.delete(callback));
      },
      change() {
        for (const callback of [...changes]) callback([{ action: "updated", path: filePath }]);
      },
      invalidate() {
        for (const callback of [...invalidations])
          callback({ path: filePath, reason: "recovered" });
      },
      dispose: jasmine.createSpy("close archive observation").and.callFake(() => {
        handle.isDisposed = true;
        const error = new Error("Observation was disposed");
        error.name = "AbortError";
        readyGate?.reject(error);
        closed.resolve();
      }),
    };
    watchers.push(handle);
    return handle;
  }

  beforeEach(async () => {
    jasmine.useRealClock();
    workspace = lumine.workspace;
    lumine.config.set("core.allowPendingPaneItems", true);
    lumine.config.set("core.closeDeletedFileTabs", false);
    watchers = [];
    watchBehavior = null;
    spyOn(lumine.fileWatchClient, "watchFile").and.callFake(watch);
    await lumine.packages.activatePackage("archive-view");
    // Activation can swap the package's module generation between specs.
    ArchiveEditorView = require("../lib/archive-editor-view");
    archive = require("../lib/archive");
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "archive-pending-reuse-"));
    firstPath = path.join(__dirname, "fixtures", "nested.tar");
    secondPath = path.join(directory, "nested2.tar");
    thirdPath = path.join(directory, "nested3.tar");
    zipPath = path.join(directory, "different.zip");
    fs.copyFileSync(firstPath, secondPath);
    fs.copyFileSync(firstPath, thirdPath);
    fs.copyFileSync(path.join(__dirname, "fixtures", "multiple-entries.zip"), zipPath);
    view = await workspace.open(firstPath, { pending: true });
    pane = workspace.paneForItem(view);
    await view.refresh();
    await conditionPromise(() => view.entries.length > 0);
  });

  afterEach(async () => {
    for (const item of workspace.getPaneItems()) {
      if (item instanceof ArchiveEditorView && !item.destroyed) item.destroy();
    }
    await Promise.all(
      watchers.filter((handle) => handle.isDisposed).map((handle) => handle.closed),
    );
    for (const filePath of [secondPath, thirdPath, zipPath]) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    if (directory) fs.rmdirSync(directory);
  });

  function controlListings() {
    const listings = [];
    spyOn(archive, "list").and.callFake((filePath, options, callback) => {
      listings.push({ filePath, options, callback });
    });
    return listings;
  }

  async function startOpen(filePath, listings, options = {}) {
    const result = workspace.open(filePath, { pending: true, pane, ...options });
    const outcome = result.then(
      (item) => ({ item }),
      (error) => ({ error }),
    );
    await conditionPromise(() => listings.some((listing) => listing.filePath === filePath));
    return {
      result,
      outcome,
      listing: listings.findLast((listing) => listing.filePath === filePath),
    };
  }

  function snapshot() {
    return {
      path: view.getPath(),
      uri: view.getURI(),
      title: view.getTitle(),
      summary: view.getSummary(),
      state: view.getFileState(),
      file: view.file,
      entries: [...view.entries],
      contents: view.refs.tree.innerHTML,
      selection: view.selectedFile,
      scrollTop: view.element.scrollTop,
    };
  }

  function expectUnchanged(previous) {
    expect(view.getPath()).toBe(previous.path);
    expect(view.getURI()).toBe(previous.uri);
    expect(view.getTitle()).toBe(previous.title);
    expect(view.getSummary()).toBe(previous.summary);
    expect(view.getFileState()).toBe(previous.state);
    expect(view.file).toBe(previous.file);
    expect(view.entries).toEqual(previous.entries);
    expect(view.refs.tree.innerHTML).toBe(previous.contents);
    expect(view.selectedFile).toBe(previous.selection);
    expect(view.element.scrollTop).toBe(previous.scrollTop);
    expect(previous.file.isDisposed).toBe(false);
    expect(view.destroyed).toBeFalsy();
  }

  it("reuses the outer view and tree while committing the new archive's metadata and entries", async () => {
    jasmine.attachToDOM(lumine.views.getView(workspace));
    const element = view.element;
    const tree = view.refs.tree;
    const oldEntries = [...view.entries];
    const oldFile = view.file;
    const changes = [];
    const paths = [];
    const titles = [];
    const opened = jasmine.createSpy("archive opened");
    const subscription = workspace.onDidChangePaneItemURI((event) => changes.push(event));
    const openedSubscription = workspace.onDidOpen(opened);
    const pathSubscription = view.onDidChangePath((filePath) => paths.push(filePath));
    const titleSubscription = view.onDidChangeTitle(() => titles.push(view.getTitle()));
    lumine.commands.dispatch(element, "core:move-down");
    expect(view.selectedFile).not.toBeNull();
    tree.style.minHeight = "1200px";
    element.style.height = "100px";
    element.scrollTop = 75;
    expect(element.scrollTop).toBeGreaterThan(0);

    const reused = await workspace.open(zipPath, { pending: true, pane });

    expect(reused).toBe(view);
    expect(view.element).toBe(element);
    expect(view.refs.tree).toBe(tree);
    expect(view.entries).not.toEqual(oldEntries);
    expect(oldEntries.every((entry) => entry.element.parentNode === null)).toBe(true);
    expect(view.getPath()).toBe(zipPath);
    expect(view.getURI()).toBe(zipPath);
    expect(view.getTitle()).toBe("different.zip");
    expect(view.getFileState()).toBe("unmodified");
    expect(view.getSummary()).toBe("704 bytes with 4 files and 1 folder");
    expect(view.selectedFile).toBeNull();
    expect(tree.querySelector(".selected")).toBeNull();
    expect(element.scrollTop).toBe(0);
    expect(view.file.path).toBe(zipPath);
    expect(view.file).not.toBe(oldFile);
    await oldFile.closed;
    expect(oldFile.isDisposed).toBe(true);
    expect(pane.getPendingItem()).toBe(view);
    expect(paths).toEqual([zipPath]);
    expect(titles).toEqual(["different.zip"]);
    expect(changes).toEqual([{ item: view, pane, oldURI: firstPath, newURI: zipPath }]);
    expect(opened).toHaveBeenCalledWith({
      uri: zipPath,
      pane,
      item: view,
      index: pane.getItems().indexOf(view),
    });
    expect(workspace.destroyedItemURIs).toContain(firstPath);
    subscription.dispose();
    openedSubscription.dispose();
    pathSubscription.dispose();
    titleSubscription.dispose();
  });

  it("allows the previous archive URI to be reopened from closed-item history", async () => {
    await workspace.open(zipPath, { pending: true, pane });
    const reopened = await workspace.reopenItem();
    expect(reopened).not.toBe(view);
    expect(reopened instanceof ArchiveEditorView).toBe(true);
    expect(reopened.getPath()).toBe(firstPath);
    await reopened.refresh();
    expect(reopened.element.querySelectorAll(".file").length).toBe(3);
  });

  it("keeps the old document visible until the staged watcher and listing are both ready", async () => {
    const listings = controlListings();
    const previous = snapshot();
    const readyGate = deferred();
    watchBehavior = { path: secondPath, readyGate };
    const opened = workspace.open(secondPath, { pending: true, pane });
    const outcome = opened.then(
      (item) => ({ item }),
      (error) => ({ error }),
    );
    await conditionPromise(() => watchers.some((handle) => handle.path === secondPath));
    const preparedListing = listings.find((listing) => listing.filePath === secondPath);
    preparedListing?.callback(null, [fileEntry("new.txt")]);
    await flushMicrotasks();
    expectUnchanged(previous);
    readyGate.resolve();
    if (!preparedListing) {
      await conditionPromise(() => listings.some((listing) => listing.filePath === secondPath));
      listings
        .find((listing) => listing.filePath === secondPath)
        .callback(null, [fileEntry("new.txt")]);
    }
    expect((await outcome).item).toBe(view);
    expect(view.getPath()).toBe(secondPath);
    expect(view.refs.tree.textContent).toBe("new.txt");
    expect(view.getSummary()).toContain("1 file and 0 folders");
  });

  it("lets C win over B while retaining the same preview when B completes late", async () => {
    const listings = controlListings();
    const element = view.element;
    const tree = view.refs.tree;
    const b = await startOpen(secondPath, listings);
    const c = await startOpen(thirdPath, listings);
    c.listing.callback(null, [fileEntry("current.txt")]);
    expect((await c.outcome).item).toBe(view);
    b.listing.callback(null, [fileEntry("stale.txt")]);
    expect((await b.outcome).item).toBeUndefined();
    expect(view.getPath()).toBe(thirdPath);
    expect(view.element).toBe(element);
    expect(view.refs.tree).toBe(tree);
    expect(tree.textContent).toBe("current.txt");
    expect(
      watchers.filter((handle) => handle.path === secondPath).every((handle) => handle.isDisposed),
    ).toBe(true);
    expect(pane.getPendingItem()).toBe(view);
  });

  it("does not let an older same-path refresh overwrite a newer completed refresh", async () => {
    const listings = controlListings();
    const older = view.refresh();
    const newer = view.refresh();
    await conditionPromise(() => listings.length === 2);
    listings[1].callback(null, [fileEntry("current.txt")]);
    expect(await newer).toBe(true);
    listings[0].callback(null, [fileEntry("stale.txt")]);
    expect(await older).toBe(false);
    expect(view.refs.tree.textContent).toBe("current.txt");
    expect(view.getPath()).toBe(firstPath);
  });

  it("keeps an old watcher refresh from superseding an explicit replacement", async () => {
    const listings = controlListings();
    const oldFile = view.file;
    const replacement = await startOpen(secondPath, listings);
    oldFile.change();
    oldFile.invalidate();
    await flushMicrotasks();
    expect(listings.filter((listing) => listing.filePath === firstPath).length).toBe(0);
    replacement.listing.callback(null, [fileEntry("new.txt")]);
    expect((await replacement.outcome).item).toBe(view);
    expect(view.getPath()).toBe(secondPath);
    expect(view.refs.tree.textContent).toBe("new.txt");
  });

  it("retries the staged listing when the replacement archive changes before commit", async () => {
    const previous = snapshot();
    const listings = controlListings();
    const replacement = await startOpen(secondPath, listings);
    watchers.find((handle) => handle.path === secondPath).change();
    replacement.listing.callback(null, [fileEntry("outdated.txt")]);
    await conditionPromise(
      () => listings.filter((listing) => listing.filePath === secondPath).length === 2,
    );
    expectUnchanged(previous);
    listings
      .findLast((listing) => listing.filePath === secondPath)
      .callback(null, [fileEntry("updated.txt")]);
    expect((await replacement.outcome).item).toBe(view);
    expect(view.refs.tree.textContent).toBe("updated.txt");
    expect(view.getPath()).toBe(secondPath);
  });

  it("retains the previous tree, watcher, selection and metadata when listing fails", async () => {
    lumine.commands.dispatch(view.element, "core:move-down");
    const previous = snapshot();
    const listings = controlListings();
    const replacement = await startOpen(secondPath, listings);
    replacement.listing.callback(new Error("Archive is corrupt"));
    expect((await replacement.outcome).error.message).toContain("Archive is corrupt");
    expectUnchanged(previous);
    expect(pane.getPendingItem()).toBe(view);
    expect(
      watchers.filter((handle) => handle.path === secondPath).every((handle) => handle.isDisposed),
    ).toBe(true);
    expect(workspace.destroyedItemURIs).not.toContain(firstPath);
  });

  it("retains the previous archive when the requested file is missing", async () => {
    const previous = snapshot();
    const result = await workspace
      .open(path.join(directory, "missing.tar"), { pending: true, pane })
      .catch((error) => error);
    expect(result instanceof Error).toBe(true);
    expectUnchanged(previous);
  });

  it("retains the previous archive when creating its replacement watcher fails", async () => {
    const previous = snapshot();
    watchBehavior = { path: secondPath, error: new Error("Watcher creation failed") };
    const result = await workspace
      .open(secondPath, { pending: true, pane })
      .catch((error) => error);
    expect(result.message).toContain("Watcher creation failed");
    expectUnchanged(previous);
  });

  it("releases a rejected staged watcher and preserves the current archive", async () => {
    const previous = snapshot();
    const readyGate = deferred();
    watchBehavior = { path: secondPath, readyGate };
    const result = workspace.open(secondPath, { pending: true, pane }).catch((error) => error);
    await conditionPromise(() => watchers.some((handle) => handle.path === secondPath));
    readyGate.reject(new Error("Watcher could not become ready"));
    expect((await result).message).toContain("Watcher could not become ready");
    expectUnchanged(previous);
    const stagedFile = watchers.find((handle) => handle.path === secondPath);
    await stagedFile.closed;
    expect(stagedFile.isDisposed).toBe(true);
  });

  it("cleans staged entries when constructing a later entry fails", async () => {
    const previous = snapshot();
    const listings = controlListings();
    const applyTo = lumine.icons.applyTo.bind(lumine.icons);
    const iconDisposed = jasmine.createSpy("dispose staged icon");
    let stagedIcons = 0;
    spyOn(lumine.icons, "applyTo").and.callFake((element, target, options) => {
      if (target.context === "archive-view" && target.path.startsWith(secondPath)) {
        if (++stagedIcons === 2) throw new Error("Cannot construct the next icon");
        return { dispose: iconDisposed };
      }
      return applyTo(element, target, options);
    });
    const replacement = await startOpen(secondPath, listings);
    replacement.listing.callback(null, [fileEntry("prepared.txt"), fileEntry("broken.txt")]);
    expect((await replacement.outcome).error.message).toContain("Cannot construct the next icon");
    expect(iconDisposed).toHaveBeenCalledTimes(1);
    expectUnchanged(previous);
    expect(
      watchers.filter((handle) => handle.path === secondPath).every((handle) => handle.isDisposed),
    ).toBe(true);
  });

  it("rejects direct cancellation and ignores the cancelled listing", async () => {
    const previous = snapshot();
    const listings = controlListings();
    const controller = new AbortController();
    const result = view
      .replaceArchive(secondPath, { signal: controller.signal })
      .catch((error) => error);
    await conditionPromise(() => listings.some((listing) => listing.filePath === secondPath));
    controller.abort();
    expect((await result).name).toBe("AbortError");
    listings
      .find((listing) => listing.filePath === secondPath)
      .callback(null, [fileEntry("stale.txt")]);
    expectUnchanged(previous);
  });

  it("rejects an already-cancelled replacement before creating resources", async () => {
    const listings = controlListings();
    const previous = snapshot();
    const observationCount = watchers.length;
    const controller = new AbortController();
    controller.abort();
    const result = await view
      .replaceArchive(secondPath, { signal: controller.signal })
      .catch((error) => error);
    expect(result.name).toBe("AbortError");
    expect(listings.length).toBe(0);
    expect(watchers.length).toBe(observationCount);
    expectUnchanged(previous);
  });

  for (const action of ["promotion", "move", "close", "destruction"]) {
    it(`cancels replacement on ${action} and ignores its late listing`, async () => {
      const listings = controlListings();
      const replacement = await startOpen(secondPath, listings);
      if (action === "promotion") {
        expect(await workspace.open(firstPath, { pane })).toBe(view);
      } else if (action === "move") {
        pane.moveItemToPane(view, pane.splitRight());
      } else if (action === "close") {
        await pane.destroyItem(view);
      } else {
        view.destroy();
      }
      expect((await replacement.outcome).item).toBeUndefined();
      replacement.listing.callback(null, [fileEntry("stale.txt")]);
      if (action === "promotion" || action === "move") {
        expect(view.getPath()).toBe(firstPath);
        expect(view.refs.tree.textContent).not.toContain("stale.txt");
        expect(view.destroyed).toBeFalsy();
      } else {
        expect(view.destroyed).toBe(true);
        expect(workspace.getPaneItems()).not.toContain(view);
      }
      expect(
        watchers
          .filter((handle) => handle.path === secondPath)
          .every((handle) => handle.isDisposed),
      ).toBe(true);
    });
  }

  it("does not reuse when opening a permanent archive or a split", async () => {
    const splitItem = await workspace.open(secondPath, { pending: true, pane, split: "right" });
    expect(splitItem).not.toBe(view);
    expect(workspace.paneForItem(splitItem)).not.toBe(pane);
    expect(view.getPath()).toBe(firstPath);
    const permanentItem = await workspace.open(zipPath, { pane });
    expect(permanentItem).not.toBe(view);
    expect(permanentItem instanceof ArchiveEditorView).toBe(true);
    expect(pane.getPendingItem()).toBeNull();
  });

  it("constructs a separate item for a background archive addition", async () => {
    const background = await workspace.open(secondPath, {
      pending: true,
      pane,
      activateItem: false,
    });
    expect(background).not.toBe(view);
    expect(background instanceof ArchiveEditorView).toBe(true);
    expect(background.getPath()).toBe(secondPath);
  });

  it("declines replacing a non-archive item and a view in a file operation", async () => {
    view.fileOperationDepth++;
    expect(view.canReplaceArchive()).toBe(false);
    expect(await view.replaceArchive(secondPath)).toBe(false);
    view.fileOperationDepth--;
    expect(view.canReplaceArchive()).toBe(true);
    const textEditor = await workspace.open(undefined, { pane, pending: true });
    const archiveItem = await workspace.open(secondPath, { pane, pending: true });
    expect(archiveItem).not.toBe(textEditor);
    expect(archiveItem instanceof ArchiveEditorView).toBe(true);
  });

  it("keeps the old archive if the target disappears while constructing its tree", async () => {
    const previous = snapshot();
    spyOn(archive, "list").and.callFake((_path, _options, callback) =>
      callback(null, [fileEntry("new.txt")]),
    );
    const apply = lumine.icons.applyTo.bind(lumine.icons);
    let deleted = false;
    spyOn(lumine.icons, "applyTo").and.callFake((element, target, options) => {
      const binding = apply(element, target, options);
      if (!deleted && target.path.startsWith(secondPath + path.sep)) {
        deleted = true;
        fs.unlinkSync(secondPath);
      }
      return binding;
    });
    const error = await workspace
      .open(secondPath, { pending: true, pane })
      .catch((failure) => failure);
    expect(error.code).toBe("ENOENT");
    expect(deleted).toBe(true);
    expectUnchanged(previous);
    expect(
      watchers.filter((handle) => handle.path === secondPath).every((handle) => handle.isDisposed),
    ).toBe(true);
  });

  it("retries a revision changed during tree construction before publishing it", async () => {
    let readCount = 0;
    spyOn(archive, "list").and.callFake((_path, _options, callback) =>
      callback(null, [fileEntry(`read-${++readCount}.txt`)]),
    );
    const apply = lumine.icons.applyTo.bind(lumine.icons);
    let changed = false;
    spyOn(lumine.icons, "applyTo").and.callFake((element, target, options) => {
      const binding = apply(element, target, options);
      if (!changed && target.path.startsWith(secondPath + path.sep)) {
        changed = true;
        fs.appendFileSync(secondPath, Buffer.alloc(1024));
      }
      return binding;
    });
    expect(await workspace.open(secondPath, { pending: true, pane })).toBe(view);
    expect(readCount).toBe(2);
    expect(view.refs.tree.textContent).toContain("read-2.txt");
    expect(view.refs.tree.textContent).not.toContain("read-1.txt");
    expect(view.getSummary()).toBe("7 KB with 1 file and 0 folders");
  });

  it("leaves remote archive URIs to the remaining openers", async () => {
    const remoteURI = "https://archive.example/document.zip";
    const remote = { getURI: () => remoteURI, element: document.createElement("div") };
    const replace = spyOn(view, "replaceArchive").and.callThrough();
    const registration = workspace.addOpener((uri) => (uri === remoteURI ? remote : undefined));
    try {
      expect(await workspace.open(remoteURI, { pending: true, pane })).toBe(remote);
      expect(replace).not.toHaveBeenCalled();
    } finally {
      registration.dispose();
    }
  });
});
