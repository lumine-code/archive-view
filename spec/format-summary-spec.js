const { formatCount, formatFileSize } = require("../lib/format-summary");

describe("Archive summary formatting", () => {
  it("groups file and folder counts with commas", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1)).toBe("1");
    expect(formatCount(1000)).toBe("1,000");
    expect(formatCount(1234567)).toBe("1,234,567");
  });

  it("preserves byte units, binary thresholds and rounding", () => {
    const sizes = [
      [-1, "-1 bytes"],
      [0, "0 bytes"],
      [1, "1 byte"],
      [2, "2 bytes"],
      [1023, "1,023 bytes"],
      [1024, "1 KB"],
      [1535, "1 KB"],
      [1536, "2 KB"],
      [1024 ** 2 - 1, "1,024 KB"],
      [1024 ** 2, "1.00 MB"],
      [1024 ** 2 * 1.125, "1.13 MB"],
      [1024 ** 3 - 1, "1024.00 MB"],
      [1024 ** 3, "1.00 GB"],
      [1024 ** 4, "1.00 TB"],
      [1024 ** 5, "1.00 PB"],
    ];
    for (const [bytes, expected] of sizes) {
      expect(formatFileSize(bytes)).withContext(`${bytes} bytes`).toBe(expected);
    }
  });
});
