# archive-view

Browse the files and folders inside archive files.

## Features

- **Archive browsing**: opens archives as a tree of their contents inside an editor tab.
- **Broad format support**: handles `.egg`, `.epub`, `.jar`, `.love`, `.nupkg`, `.tar`, `.tar.gz`, `.tgz`, `.war`, `.whl`, `.xpi`, and `.zip` files.
- **Extract and open**: selecting a file extracts it to a temporary file and opens it in a new editor.
- **File icons**: shows a file-type icon for every entry, and richer ones when an icon package is installed.
- **Pending previews**: reuses the existing browser when another archive replaces a temporary preview, keeping the previous contents on loading failure.

## Installation

To install `archive-view` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/archive-view`.

## Customization

Change the archive browser's background by adding CSS to your `styles.css`:

```css
.archive-editor {
  background-color: #1e1e1e;
}
```

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
