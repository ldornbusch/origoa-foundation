import { answerPrompt, expect, get, post, seedDomain, stamp, test } from "./fixtures";

// Folders exist only through their content: the folder field marks the
// segments a write would create, warns about near-misses of an existing
// sibling, offers the hierarchy to pick from, and "New folder" plans a
// destination that becomes real with its first artifact.

const id = stamp();
const folder = `fold-${id}`;

test.beforeAll(async () => {
  await seedDomain(folder, "F" + id.slice(-3).toUpperCase());
  await post("/entries", { path: `${folder}/specs`, type: "req", title: `Seed ${id}`, fields: { priority: "low" } });
});

async function openNewReq(page: import("@playwright/test").Page) {
  await page.keyboard.press("n");
  await page.locator(".dialog .type-card[data-type=req]").click();
  await page.locator("#new-title").waitFor();
}

test("the folder field marks new segments, catches typos and browses the tree", async ({ page }) => {
  await page.goto(`/folder/${folder}/specs`);
  await page.locator("table.grid tbody tr").first().waitFor();
  await openNewReq(page);
  const input = page.locator("#new-path");
  await expect(input).toHaveValue(`${folder}/specs`);
  await expect(page.locator("[data-test=folder-status]")).toHaveCount(0);

  await input.fill(`${folder}/specs/boot/deep`);
  await expect(page.locator("[data-test=folder-status] .folder-path .new")).toHaveText(["boot", "deep"]);
  await expect(page.locator("[data-test=folder-typo]")).toHaveCount(0);

  await input.fill(`${folder}/spec/boot`);
  await expect(page.locator("[data-test=folder-typo]")).toContainText("specs");
  await page.locator("[data-test=folder-typo] button").click();
  await expect(input).toHaveValue(`${folder}/specs/boot`);
  await expect(page.locator("[data-test=folder-status] .folder-path .new")).toHaveText(["boot"]);

  await page.locator("[data-test=folder-browse]").click();
  await page.locator(`.folder-browser .row[data-pick="${folder}"] .caret`).click();
  await page.locator(`.folder-browser .row[data-pick="${folder}/specs"]`).click();
  await expect(input).toHaveValue(`${folder}/specs`);
  await expect(page.locator("[data-test=folder-status]")).toHaveCount(0);

  await input.fill(`${folder}/specs/boot`);
  await page.locator("#new-title").fill(`Booted ${id}`);
  await page.locator(".dialog select").first().selectOption("high");
  await page.locator(".dialog button[type=submit]").click();
  await expect(page.locator("groundsill-detail h2")).toHaveText(`Booted ${id}`);
  const tree = await get<{ folders: { name: string }[] }>(`/repository/tree?path=${folder}/specs`);
  expect(tree.folders.map((f) => f.name)).toContain("boot");
});

test("New folder plans a destination that becomes real with its first artifact", async ({ page }) => {
  await page.goto(`/folder/${folder}`);
  await page.locator(`.tree .row[data-folder="${folder}/specs"]`).waitFor();
  await page.locator("[data-test=new-folder]").click();
  await answerPrompt(page, "plans");
  const row = page.locator(`.tree .row[data-folder="${folder}/plans"]`);
  await expect(row).toHaveClass(/pending/);
  await expect(page.locator(".toolbar .title")).toHaveText("plans");

  await openNewReq(page);
  await expect(page.locator("#new-path")).toHaveValue(`${folder}/plans`);
  await expect(page.locator("[data-test=folder-status] .folder-path .new")).toHaveText(["plans"]);
  await page.locator("#new-title").fill(`Planned ${id}`);
  await page.locator(".dialog select").first().selectOption("high");
  await page.locator(".dialog button[type=submit]").click();
  await expect(page.locator("groundsill-detail h2")).toHaveText(`Planned ${id}`);
  await expect(row).not.toHaveClass(/pending/);
});

test("moving a folder uses the folder field and does not flag the rename as a typo", async ({ page }) => {
  await post("/entries", { path: `${folder}/moveme`, type: "req", title: `Mover ${id}`, fields: { priority: "low" } });
  await page.goto(`/folder/${folder}/moveme`);
  await page.locator("[data-test=move-folder]").click();
  const input = page.locator(".dialog input[data-test=prompt]");
  await input.fill(`${folder}/moveme2`);
  await expect(page.locator("[data-test=folder-status] .folder-path .new")).toHaveText(["moveme2"]);
  await expect(page.locator("[data-test=folder-typo]")).toHaveCount(0);
  await input.press("Enter");
  await expect(page.locator(".toolbar .title")).toHaveText("moveme2");
});
