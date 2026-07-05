import { chromium } from '@playwright/test';

const CHROMIUM_PATH = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

(async () => {
  let browser;
  try {
    const launchOptions = CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH, headless: true } : { headless: true };
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    // Navigate to the page
    console.log('Loading page...');
    await page.goto('https://support.snaptrade.com/brokerages', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });

    // Wait for content to render
    await page.waitForTimeout(5000);

    // Get the full page text to see structure
    const allText = await page.innerText('body');
    console.log(allText);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
