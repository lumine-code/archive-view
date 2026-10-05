const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("archive entry lifetime", () => {
  let view, archive, FileView, DirectoryView, temp, directories;
  const fixture = path.join(__dirname, "fixtures", "nested.tar");

  const firstFile = (entries) => {
    for (const entry of entries) {
      if (entry instanceof FileView) return entry;
      const child = firstFile(entry.entries || []);
      if (child) return child;
    }
  };
  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  };

  beforeEach(async () => {
    jasmine.useRealClock();
    directories = [];
    await lumine.packages.activatePackage("archive-view");
    archive = require("../lib/archive");
    FileView = require("../lib/file-view");
    DirectoryView = require("../lib/directory-view");
    temp = require("@lumine-code/fs-temp");
    view = await lumine.workspace.open(fixture);
    await conditionPromise(() => view.entries.length > 0);
  });

  afterEach(async () => {
    const file = view?.file;
    view?.destroy();
    if (file) await file.closed;
    await lumine.packages.deactivatePackage("archive-view");
    for (const directory of directories) {
      const target = path.resolve(directory);
      const parent = path.resolve(os.tmpdir());
      const same = (a, b) =>
        process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
      if (
        !same(path.dirname(target), parent) ||
        !path.basename(target).startsWith("lumine-archive-view-")
      ) {
        throw new Error("Unexpected extraction directory");
      }
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("ignores a late archive read from a retired nested entry", async () => {
    const entry = firstFile(view.entries);
    let finishRead;
    spyOn(archive, "readFile").and.callFake((_path, _entry, callback) => {
      finishRead = callback;
    });
    const mkdir = spyOn(temp, "mkdir");
    const open = spyOn(lumine.workspace, "open");
    const errors = spyOn(console, "error");
    const extraction = entry.openFile();
    view.entries[0].destroy();
    finishRead(new Error("Old archive failed"));
    expect(await extraction).toBe(false);
    expect(mkdir).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(entry.destroyed).toBe(true);
  });

  it("ignores an earlier action when a replacement begins before its read returns", async () => {
    const entry = firstFile(view.entries);
    let finishRead;
    spyOn(archive, "readFile").and.callFake((_path, _entry, callback) => {
      finishRead = callback;
    });
    const mkdir = spyOn(temp, "mkdir");
    const extraction = entry.openFile();
    const controller = new AbortController();
    const replacement = view.replaceArchive(
      path.join(__dirname, "fixtures", "multiple-entries.zip"),
      { signal: controller.signal },
    );
    controller.abort();
    await expectAsync(replacement).toBeRejectedWith(
      jasmine.objectContaining({ name: "AbortError" }),
    );
    finishRead(null, Buffer.from("old content"));
    expect(await extraction).toBe(false);
    expect(entry.destroyed).toBe(false);
    expect(mkdir).not.toHaveBeenCalled();
  });

  it("removes its temporary output instead of opening a retired entry after writing", async () => {
    const entry = firstFile(view.entries);
    spyOn(archive, "readFile").and.callFake((_path, _entry, callback) =>
      callback(null, Buffer.from("old")),
    );
    spyOn(temp, "mkdir").and.callFake((_prefix, callback) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lumine-archive-view-"));
      directories.push(directory);
      callback(null, directory);
    });
    const write = deferred();
    spyOn(fs.promises, "writeFile").and.returnValue(write.promise);
    const open = spyOn(lumine.workspace, "open");
    const errors = spyOn(console, "error");
    const extraction = entry.openFile();
    await conditionPromise(() => fs.promises.writeFile.calls.count() === 1);
    entry.destroy();
    write.reject(new Error("Late write failure"));
    expect(await extraction).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(fs.existsSync(directories[0])).toBe(false);
  });

  it("rejects direct actions on destroyed entries", async () => {
    const entry = firstFile(view.entries);
    const read = spyOn(archive, "readFile");
    entry.destroy();
    expect(await entry.openFile()).toBe(false);
    entry.select();
    expect(read).not.toHaveBeenCalled();
    expect(view.selectedFile).not.toBe(entry);
  });

  it("retargets descendant extraction and icon paths when the archive moves", async () => {
    const entry = firstFile(view.entries);
    const nextPath = path.join(path.dirname(fixture), "renamed.tar");
    const directory = view.entries[0];
    directory.setArchivePath(nextPath);
    expect(entry.archivePath).toBe(nextPath);
    expect(entry.name.dataset.path).toBe(path.join(nextPath, entry.entry.getPath()));
    expect(directory.entrySpan.dataset.path).toBe(path.join(nextPath, directory.entry.getPath()));
    directory.setArchivePath(fixture);
  });

  it("disposes a partially constructed directory and its completed children", () => {
    const make = (name, directory = false, children = []) => ({
      children,
      getName: () => name,
      getPath: () => name,
      isDirectory: () => directory,
    });
    const disposed = [];
    let count = 0;
    spyOn(lumine.icons, "applyTo").and.callFake(() => {
      if (++count === 3) throw new Error("Cannot construct third icon");
      const index = count;
      return { dispose: () => disposed.push(index) };
    });
    expect(
      () =>
        new DirectoryView(
          view,
          0,
          fixture,
          make("folder", true, [make("one.txt"), make("two.txt")]),
        ),
    ).toThrowError("Cannot construct third icon");
    expect(disposed.sort()).toEqual([1, 2]);
  });
});
