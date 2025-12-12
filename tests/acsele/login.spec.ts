import { test, expect } from "@playwright/test";

test("exemplo", async ({ page }) => {
  await page.goto("/projectqatesterweb/");
  expect(true).toBeTruthy();
  await page.waitForTimeout(5000)
});
