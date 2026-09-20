import { describe, expect, it } from "vitest";
import fs from "node:fs";

const styles = fs.readFileSync(
  new URL("../src/client/styles.css", import.meta.url),
  "utf8",
);

describe("theme tokens", () => {
  it("defines light-theme button colours instead of inheriting dark tokens", () => {
    const lightTheme = styles.match(
      /html\[data-theme=["']light["']\]\s*\{([\s\S]*?)\}/,
    )?.[1];

    expect(lightTheme).toBeTruthy();
    expect(lightTheme).toMatch(/--btn-bg:\s*#f1f3f7/);
    expect(lightTheme).toMatch(/--btn-border:\s*#c9d0dc/);
    expect(styles).toMatch(/button\s*\{[\s\S]*background:\s*var\(--btn-bg\)/);
  });
});
