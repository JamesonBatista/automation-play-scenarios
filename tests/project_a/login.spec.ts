import { test, expect } from "@playwright/test";

test("exemplo", async ({ page }) => {

  // baseUrl definida em server.js na linha 246 e a ENV 247
  await page.goto(process.env.BASE_URL + "/projectqatesterweb/");
});
