const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

describe("Archive opener extension casing", () => {
  let directory, paths, ArchiveEditorView;
  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "archive-view-case-"));
    paths = [];
    await lumine.packages.activatePackage("archive-view");
    ArchiveEditorView = require("../lib/archive-editor-view");
  });
  afterEach(async () => {
    for (const item of lumine.workspace.getPaneItems().slice()) item.destroy();
    await lumine.packages.deactivatePackage("archive-view");
    for (const file of paths) fs.unlinkSync(file);
    fs.rmdirSync(directory);
  });
  for (const [lower, upper, contents] of [
    [
      ".zip",
      ".ZIP",
      () => fs.readFileSync(path.join(__dirname, "fixtures", "multiple-entries.zip")),
    ],
    [
      ".tar.gz",
      ".TAR.GZ",
      () => zlib.gzipSync(fs.readFileSync(path.join(__dirname, "fixtures", "nested.tar"))),
    ],
  ]) {
    it(`opens real ${upper} data in the archive browser like ${lower}`, async () => {
      const bytes = contents();
      const original = path.join(directory, "lower" + lower),
        target = path.join(directory, "MiXeD" + upper);
      paths.push(original, target);
      fs.writeFileSync(original, bytes);
      fs.writeFileSync(target, bytes);
      const first = await lumine.workspace.open(original);
      expect(first instanceof ArchiveEditorView).toBe(true);
      await first.refresh();
      const second = await lumine.workspace.open(target);
      expect(second instanceof ArchiveEditorView).toBe(true);
      if (second instanceof ArchiveEditorView) {
        await second.refresh();
        expect(second.loaded).toBe(true);
        expect(second.getSummary()).toBe(first.getSummary());
        expect(second.getPath()).toBe(target);
      }
    });
  }
});
