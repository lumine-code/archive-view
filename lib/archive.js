let loading;

function load() {
  return (loading ||= import("@lumine-code/ls-archive")
    .then((namespace) => {
      const archive = namespace.default ?? namespace;
      if (typeof archive.list !== "function" || typeof archive.readFile !== "function")
        throw new TypeError("Archive decoder is unavailable");
      return archive;
    })
    .catch((error) => {
      loading = null;
      throw error;
    }));
}

function invoke(method, args, callback, isCurrent) {
  module.exports.load().then((archive) => {
    // Importing cannot be cancelled, but a retired request need not open the
    // archive once its decoder becomes available.
    if (!isCurrent()) {
      callback(new DOMException("Archive load was cancelled", "AbortError"));
      return;
    }
    try {
      archive[method](...args, callback);
    } catch (error) {
      callback(error);
    }
  }, callback);
}

module.exports = {
  load,
  list(filePath, options, callback, isCurrent = () => true) {
    invoke("list", [filePath, options], callback, isCurrent);
  },
  readFile(filePath, entryPath, callback, isCurrent = () => true) {
    invoke("readFile", [filePath, entryPath], callback, isCurrent);
  },
};
