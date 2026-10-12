const path = require("node:path");

describe("archive presentation windows", () => {
  let item;
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("status-bar");
    await lumine.packages.activatePackage("archive-view");
    item = await lumine.workspace.open(path.join(__dirname, "fixtures/nested.tar"));
    await item.refresh();
  });
  afterEach(async () => {
    await lumine.workspace.discardEditorWindows();
  });

  it("keeps its live tree and local summary after detaching and reattaching", async () => {
    const element = item.element;
    const entries = item.entries;
    const extra = await lumine.workspace.detachPane(lumine.workspace.paneForItem(item));
    expect(item.element).toBe(element);
    expect(item.entries).toBe(entries);
    expect(element.ownerDocument).toBe(extra.getDocument());
    expect(extra.getElement().querySelector(".archive-status").textContent).toBe(item.getSummary());
    expect(
      lumine.workspace.getMainWindow().getElement().querySelector(".archive-status").style.display,
    ).toBe("none");
    await item.refresh();
    expect(item.element).toBe(element);
    expect(item.entries[0].element.ownerDocument).toBe(extra.getDocument());
    const state = item.serialize();
    expect(state.viewState).toEqual(item.captureViewState());
    await lumine.workspace.attachWindow(extra);
    expect(element.ownerDocument).toBe(document);
  });
});
