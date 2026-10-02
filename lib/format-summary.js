const counts = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function formatCount(count) {
  return counts.format(count);
}

function formatFileSize(bytes) {
  const units = ["MB", "GB", "TB", "PB"];
  for (let index = units.length - 1; index >= 0; index--) {
    const threshold = 1024 ** (index + 2);
    if (bytes >= threshold) {
      const size = Math.round((bytes / threshold) * 100) / 100;
      return `${size.toFixed(2)} ${units[index]}`;
    }
  }
  if (bytes >= 1024) return `${formatCount(Math.round(bytes / 1024))} KB`;
  return `${formatCount(bytes)} ${bytes === 1 ? "byte" : "bytes"}`;
}

module.exports = { formatCount, formatFileSize };
