const path = require("node:path");

describe("archive decoder loading", () => {
  let archive, ArchiveEditorView, view;
  const fixture = path.join(__dirname, "fixtures", "nested.tar");

  function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  }

  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("archive-view");
    archive = require("../lib/archive");
    ArchiveEditorView = require("../lib/archive-editor-view");
  });

  afterEach(async () => {
    view?.destroy();
    view = null;
    await lumine.packages.deactivatePackage("archive-view");
    await lumine.fileWatchClient.settlePendingTeardown();
  });

  it("shares the native import and the CommonJS decoder identity", async () => {
    const first = archive.load();
    const second = archive.load();
    expect(second).toBe(first);
    expect(await first).toBe(require("@lumine-code/ls-archive"));
  });

  it("does not start listing when a view closes during decoder loading", async () => {
    const pending = deferred();
    const decoder = { list: jasmine.createSpy("list archive") };
    const loading = spyOn(archive, "load").and.returnValue(pending.promise);
    view = new ArchiveEditorView(fixture);
    await conditionPromise(() => loading.calls.count() > 0);
    view.destroy();
    pending.resolve(decoder);
    await pending.promise;
    await flushMicrotasks();
    expect(decoder.list).not.toHaveBeenCalled();
  });

  it("shows a decoder failure and allows a later refresh to retry", async () => {
    const actualLoad = archive.load.bind(archive);
    spyOn(archive, "load").and.returnValues(
      Promise.reject(new Error("Cannot load archive decoder")),
      actualLoad(),
    );
    view = new ArchiveEditorView(fixture);
    await conditionPromise(() => view.currentRequest === null);
    expect(view.loaded).toBe(false);
    expect(view.refs.errorMessage.textContent).toContain("Cannot load archive decoder");
    expect(await view.refresh()).toBe(true);
    expect(view.entries.length).toBeGreaterThan(0);
  });

  it("does not read an entry retired while its decoder is loading", async () => {
    view = new ArchiveEditorView(fixture);
    await conditionPromise(() => view.loaded);
    const firstFile = (entries) => {
      for (const entry of entries) {
        if (!entry.entries) return entry;
        const file = firstFile(entry.entries);
        if (file) return file;
      }
    };
    const entry = firstFile(view.entries);
    const pending = deferred();
    const decoder = { readFile: jasmine.createSpy("read archive entry") };
    spyOn(archive, "load").and.returnValue(pending.promise);
    const errors = spyOn(console, "error");
    const extraction = entry.openFile();
    entry.destroy();
    pending.resolve(decoder);
    expect(await extraction).toBe(false);
    expect(decoder.readFile).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });
});
