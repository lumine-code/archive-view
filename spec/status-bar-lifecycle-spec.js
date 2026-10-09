const path = require("node:path");

describe("Archive status service connection ownership", () => {
  let main, view, bars, providers, hub, consumer, StatusBarView;
  const tiles = (bar) =>
    bar
      .getLeftTiles()
      .filter((tile) => tile.getItem()?.element?.classList?.contains("archive-status"));
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("status-bar");
    StatusBarView = lumine.packages.getActivePackage("status-bar").mainModule.statusBar.constructor;
    ({ mainModule: main } = await lumine.packages.activatePackage("archive-view"));
    view = await lumine.workspace.open(path.join(__dirname, "fixtures", "nested.tar"));
    await view.refresh();
    if (main.retireStatusBarConnections) main.retireStatusBarConnections();
    else main.archiveEditorStatusView?.destroy();
    main.archiveEditorStatusView = null;
    main.statusBar = null;
    bars = [];
    providers = [];
    hub = new lumine.packages.serviceHub.constructor();
    consumer = hub.consume("status-bar", "^1.0.0", (bar) => main.consumeStatusBar(bar));
  });
  afterEach(async () => {
    consumer.dispose();
    providers.forEach((provider) => provider.dispose());
    await lumine.packages.deactivatePackage("archive-view");
    for (const bar of bars) {
      for (const tile of bar.getLeftTiles().slice()) tile.destroy();
      bar.destroy();
    }
  });
  function provide(bar) {
    if (!bar) {
      bar = new StatusBarView();
      bars.push(bar);
      jasmine.attachToDOM(bar.element);
    }
    const provider = hub.provide("status-bar", "1.0.0", bar);
    providers.push(provider);
    return { bar, provider };
  }
  it("renders on distinct active bars and releases only the retired provider edge", () => {
    const first = provide(),
      second = provide();
    expect(tiles(first.bar).length).toBe(1);
    expect(tiles(second.bar).length).toBe(1);
    first.provider.dispose();
    expect(tiles(first.bar).length).toBe(0);
    expect(tiles(second.bar).length).toBe(1);
    expect(tiles(second.bar)[0]?.getItem().element.textContent).toBe(view.getSummary());
  });
  it("keeps a shared status payload until its final lease ends", () => {
    const first = provide(),
      second = provide(first.bar);
    expect(tiles(first.bar).length).toBe(1);
    first.provider.dispose();
    expect(tiles(first.bar).length).toBe(1);
    second.provider.dispose();
    expect(tiles(first.bar).length).toBe(0);
  });
  it("updates each owned summary and retires every tile on package deactivation", async () => {
    const first = provide(),
      second = provide();
    view.setSummary("Changed archive summary");
    for (const bar of [first.bar, second.bar])
      expect(tiles(bar)[0]?.getItem().element.textContent).toBe("Changed archive summary");
    await lumine.packages.deactivatePackage("archive-view");
    expect(tiles(first.bar).length).toBe(0);
    expect(tiles(second.bar).length).toBe(0);
  });
  it("retires a tile returned after deactivation during status allocation", () => {
    const bar = new StatusBarView();
    bars.push(bar);
    const addTile = bar.addLeftTile.bind(bar);
    spyOn(bar, "addLeftTile").and.callFake((options) => {
      const tile = addTile(options);
      main.deactivate();
      return tile;
    });
    provide(bar);
    expect(tiles(bar).length).toBe(0);
  });
  it("keeps a reacquired generation alive when an old manual lease ends", async () => {
    const bar = new StatusBarView();
    bars.push(bar);
    const old = main.consumeStatusBar(bar);
    await lumine.packages.deactivatePackage("archive-view");
    ({ mainModule: main } = await lumine.packages.activatePackage("archive-view"));
    view = await lumine.workspace.open(path.join(__dirname, "fixtures", "nested.tar"));
    await view.refresh();
    main.retireStatusBarConnections();
    provide(bar);
    old.dispose();
    expect(tiles(bar).length).toBe(1);
  });
});
