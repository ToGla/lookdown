import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("index.html has the app title and mount point", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  expect(html).toContain("<title>lookdown</title>");
  expect(html).toContain('<main id="app"></main>');
});
