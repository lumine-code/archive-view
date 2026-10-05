const path = require("path");

describe("ArchiveEditor", () => {
  const tarPath = path.join(__dirname, "fixtures", "nested.tar");
  let ArchiveEditor, ArchiveEditorView;

  // Don't log during specs
  beforeEach(async () => {
    spyOn(console, "warn");
    const pack = await lumine.packages.activatePackage("archive-view");
    ArchiveEditor = pack.mainModule;
    ArchiveEditorView = require("../lib/archive-editor-view");
  });

  describe(".deserialize", () => {
    it("returns undefined if no file exists at the given path", () => {
      const editor1 = new ArchiveEditorView(tarPath);
      const state = editor1.serialize();
      editor1.destroy();

      const editor2 = ArchiveEditor.deserialize(state);
      expect(editor2).toBeDefined();
      editor2.destroy();

      state.path = "bogus";
      expect(ArchiveEditor.deserialize(state)).toBeUndefined();
    });
  });

  describe(".deactivate()", () => {
    it("removes all ArchiveEditorViews from the workspace and does not open any new ones", async () => {
      const getArchiveEditorViews = () => {
        return lumine.workspace.getPaneItems().filter((item) => item instanceof ArchiveEditorView);
      };
      await lumine.workspace.open(path.join(__dirname, "fixtures", "nested.tar"));
      await lumine.workspace.open(path.join(__dirname, "fixtures", "invalid.zip"));
      await lumine.workspace.open();
      expect(getArchiveEditorViews().length).toBe(2);

      await lumine.packages.deactivatePackage("archive-view");
      expect(getArchiveEditorViews().length).toBe(0);

      await lumine.workspace.open(path.join(__dirname, "fixtures", "nested.tar"));
      expect(getArchiveEditorViews().length).toBe(0);
    });
  });
});
