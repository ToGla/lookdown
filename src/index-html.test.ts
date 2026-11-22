import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("index.html has the app title and mount point", () => {
  expect(html).toContain("<title>lookdown</title>");
  expect(html).toContain('<main id="app"></main>');
});

test("index.html has a status line for messages", () => {
  expect(html).toContain('<p id="status"></p>');
});

test("index.html has the tab bar above the editor", () => {
  const tabs = html.indexOf('<nav id="tabs"></nav>');
  expect(tabs).toBeGreaterThan(-1);
  expect(tabs).toBeLessThan(html.indexOf('<main id="app"></main>'));
});
