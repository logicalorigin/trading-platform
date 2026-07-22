import { expect, test } from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";

for (const viewport of [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
]) {
  test(`sign-in typography and controls stay readable on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

    const submit = page.locator('[data-testid="login-gate-submit"]');
    await expect(submit).toBeVisible({ timeout: 30_000 });

    const metrics = await page.evaluate(() => {
      const rectHeight = (element: Element | null) =>
        element ? element.getBoundingClientRect().height : 0;
      const fontSize = (element: Element | null) =>
        element ? Number.parseFloat(getComputedStyle(element).fontSize) : 0;
      const modeSwitch = [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "First-time setup",
      );
      return {
        titleFont: fontSize(document.querySelector("h1")),
        descriptionFont: fontSize(document.querySelector("[data-slot=card-description]")),
        labelFonts: [...document.querySelectorAll("label")].map(fontSize),
        inputFonts: [...document.querySelectorAll("input")].map(fontSize),
        inputHeights: [...document.querySelectorAll("input")].map(rectHeight),
        submitHeight: rectHeight(
          document.querySelector('[data-testid="login-gate-submit"]'),
        ),
        modeSwitchHeight: rectHeight(modeSwitch || null),
      };
    });

    expect(metrics.titleFont).toBeGreaterThanOrEqual(20);
    expect(metrics.descriptionFont).toBeGreaterThanOrEqual(14);
    expect(metrics.labelFonts.every((size) => size >= 13)).toBe(true);
    expect(metrics.inputFonts.every((size) => size >= 16)).toBe(true);
    expect(metrics.inputHeights.every((height) => height >= 44)).toBe(true);
    expect(metrics.submitHeight).toBeGreaterThanOrEqual(44);
    expect(metrics.modeSwitchHeight).toBeGreaterThanOrEqual(44);
  });
}
