const path = require("node:path");

describe("Archive keyboard navigation through collapsed branches", () => {
  let view;
  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
      spyOn(lumine.shell, method).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    spyOn(lumine.clipboard, "write");
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("archive-view");
    view = await lumine.workspace.open(path.join(__dirname, "fixtures", "nested.tar"));
    await view.refresh();
    expect(view.loaded).toBe(true);
    expect(view.entries.map((entry) => entry.entry.getName())).toEqual(["d1", "da"]);
  });
  afterEach(async () => {
    view?.destroy();
    if (lumine.packages.isPackageLoaded("archive-view"))
      await lumine.packages.unloadPackage("archive-view");
    await lumine.fileWatchClient.settlePendingTeardown();
  });
  function collapse(name) {
    const directory = view.entries.find((entry) => entry.entry.getName() === name);
    directory.element.querySelector(":scope > .list-item").click();
    expect(directory.element.classList.contains("collapsed")).toBe(true);
  }
  it("skips a collapsed first branch when moving down", async () => {
    collapse("d1");
    await lumine.commands.dispatch(view.element, "core:move-down");
    expect(view.selectedFile?.entry.getName()).toBe("fa.txt");
    expect(view.selectedFile?.element.closest(".collapsed")).toBeNull();
  });
  it("skips a collapsed final branch when moving up", async () => {
    collapse("da");
    await lumine.commands.dispatch(view.element, "core:move-up");
    expect(view.selectedFile?.entry.getName()).toBe("f2.txt");
    expect(view.selectedFile?.element.closest(".collapsed")).toBeNull();
  });
  it("leaves the folded subtree when its previously selected file moves down", async () => {
    await lumine.commands.dispatch(view.element, "core:move-down");
    expect(view.selectedFile?.entry.getName()).toBe("f1.txt");
    collapse("d1");
    await lumine.commands.dispatch(view.element, "core:move-down");
    expect(view.selectedFile?.entry.getName()).toBe("fa.txt");
    expect(view.selectedFile?.element.closest(".collapsed")).toBeNull();
  });
  it("keeps ordinary expanded traversal in document order", async () => {
    await lumine.commands.dispatch(view.element, "core:move-down");
    expect(view.selectedFile?.entry.getName()).toBe("f1.txt");
    await lumine.commands.dispatch(view.selectedFile.element, "core:move-down");
    expect(view.selectedFile?.entry.getName()).toBe("f2.txt");
    await lumine.commands.dispatch(view.selectedFile.element, "core:move-up");
    expect(view.selectedFile?.entry.getName()).toBe("f1.txt");
  });
});
