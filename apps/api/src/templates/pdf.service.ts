import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { config } from '../config';

type Browser = import('playwright-core').Browser;

/**
 * HTML → PDF using a headless Chromium (playwright-core, no bundled browser).
 * Set CHROMIUM_PATH to a Chrome/Chromium executable. When it is not set the
 * caller falls back to delivering HTML, which prints to PDF from any browser.
 */
@Injectable()
export class PdfService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfService.name);
  private browser: Promise<Browser> | null = null;

  get available() {
    return !!config.CHROMIUM_PATH;
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = import('playwright-core').then(({ chromium }) =>
        chromium.launch({ executablePath: config.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] }),
      );
      this.browser.catch((e) => {
        this.logger.error(`Chromium failed to start: ${e.message}`);
        this.browser = null;
      });
    }
    return this.browser;
  }

  async render(html: string): Promise<Buffer | null> {
    if (!this.available) return null;
    const browser = await this.getBrowser();
    // JavaScript is disabled: templates are data-only and must not execute code.
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      return Buffer.from(pdf);
    } finally {
      await context.close();
    }
  }

  async onModuleDestroy() {
    if (this.browser) await (await this.browser).close().catch(() => undefined);
  }
}
