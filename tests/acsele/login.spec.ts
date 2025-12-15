import { test, expect } from "@playwright/test";

test("exemplo", async ({ page }) => {
  await page.goto("/projectqatesterweb/");
});
