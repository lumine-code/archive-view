const { spawnSync } = require("node:child_process");

describe("Archive View lightweight startup", () => {
  it("keeps the archive views, status UI and Etch unloaded until an archive opens", () => {
    const script = `
const assert = require("node:assert/strict");
const Module = require("node:module");
class Disposable {
  constructor(dispose = () => {}) { this.dispose = dispose; }
}
class CompositeDisposable {
  constructor(...items) { this.items = new Set(items); }
  add(item) { this.items.add(item); }
  remove(item) { this.items.delete(item); }
  dispose() { this.disposed = true; for (const item of this.items) item.dispose(); }
}
const originalLoad = Module._load;
Module._load = function(specifier, ...args) {
  if (specifier === "lumine") return { CompositeDisposable, Disposable };
  if (specifier === "@lumine-code/etch") throw new Error("Etch loaded before opening an archive");
  return originalLoad.call(this, specifier, ...args);
};
let opener;
let activeChanged;
const ordinaryItem = {};
const context = { editorContainer: {
  getActivePaneItem: () => ordinaryItem,
  onDidChangeActivePaneItem(callback) { activeChanged = callback; return new Disposable(); }
} };
global.lumine = { workspace: {
  addPathOpener(value) { opener = value; return new Disposable(); },
  getPaneItems: () => [ordinaryItem]
} };
const main = require(${JSON.stringify(require.resolve("../lib/archive-editor"))});
main.activate();
const connection = main.consumeStatusBar({
  observeWindows(create) { return create({}, context); }
});
activeChanged();
assert.equal(opener.handlesItem(ordinaryItem), false);
assert.equal(opener.canReusePendingItem(ordinaryItem, "test.zip"), false);
assert.equal(opener.canOpen("test.zip"), true);
assert.equal(opener.canOpen("test.txt"), false);
connection.dispose();
main.deactivate();
for (const filename of ${JSON.stringify(["../lib/archive-editor-view.jsx", "../lib/status.js", "../lib/archive.js"].map((file) => require.resolve(file)))}) {
  assert.equal(require.cache[filename], undefined, filename + " loaded before opening an archive");
}
`;
    const result = spawnSync(process.execPath, ["-e", script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    });
    expect(result.status)
      .withContext(result.stderr || result.error?.message)
      .toBe(0);
  });
});
