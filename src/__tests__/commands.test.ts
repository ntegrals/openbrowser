import * as commands from '../commands';
import { CommandError, ElementNotFoundError } from '../errors';

// Create a mock Puppeteer page
function createMockPage() {
  return {
    goto: jest.fn().mockResolvedValue(null),
    url: jest.fn().mockReturnValue('https://example.com'),
    title: jest.fn().mockResolvedValue('Example'),
    click: jest.fn().mockResolvedValue(undefined),
    type: jest.fn().mockResolvedValue(undefined),
    screenshot: jest.fn().mockResolvedValue(Buffer.from('png-data')),
    viewport: jest.fn().mockReturnValue({ width: 1280, height: 800 }),
    evaluate: jest.fn().mockResolvedValue({ x: 0, y: 500 }),
    waitForSelector: jest.fn().mockResolvedValue(null),
    waitForNavigation: jest.fn().mockResolvedValue(null),
    goBack: jest.fn().mockResolvedValue(null),
    goForward: jest.fn().mockResolvedValue(null),
    hover: jest.fn().mockResolvedValue(undefined),
    select: jest.fn().mockResolvedValue(['option1']),
    keyboard: {
      press: jest.fn().mockResolvedValue(undefined),
    },
  } as any;
}

describe('commands', () => {
  let page: any;

  beforeEach(() => {
    page = createMockPage();
  });

  describe('click', () => {
    it('should click an element', async () => {
      const result = await commands.click(page, 'button.submit');
      expect(result.success).toBe(true);
      expect(page.waitForSelector).toHaveBeenCalledWith('button.submit', {
        visible: true,
        timeout: 5000,
      });
      expect(page.click).toHaveBeenCalledWith('button.submit');
    });

    it('should throw ElementNotFoundError when element not found', async () => {
      page.waitForSelector.mockRejectedValue(
        new Error('waiting for selector "button.submit" failed'),
      );
      await expect(
        commands.click(page, 'button.submit'),
      ).rejects.toThrow(ElementNotFoundError);
    });
  });

  describe('typeText', () => {
    it('should type text into an input', async () => {
      const result = await commands.typeText(page, 'input#email', 'test@example.com');
      expect(result.success).toBe(true);
      expect(page.type).toHaveBeenCalledWith(
        'input#email',
        'test@example.com',
        { delay: 0 },
      );
    });

    it('should clear input before typing by default', async () => {
      await commands.typeText(page, 'input', 'hello');
      expect(page.click).toHaveBeenCalledWith('input', { clickCount: 3 });
    });

    it('should truncate long text in result message', async () => {
      const longText = 'a'.repeat(50);
      const result = await commands.typeText(page, 'input', longText);
      expect(result.message).toContain('...');
    });
  });

  describe('navigate', () => {
    it('should navigate to a URL', async () => {
      const result = await commands.navigate(page, 'https://example.com');
      expect(result.success).toBe(true);
      expect(page.goto).toHaveBeenCalledWith('https://example.com', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    });

    it('should auto-prepend https://', async () => {
      await commands.navigate(page, 'example.com');
      expect(page.goto).toHaveBeenCalledWith(
        'https://example.com',
        expect.any(Object),
      );
    });

    it('should not modify about: URLs', async () => {
      await commands.navigate(page, 'about:blank');
      expect(page.goto).toHaveBeenCalledWith(
        'about:blank',
        expect.any(Object),
      );
    });
  });

  describe('scroll', () => {
    it('should scroll down', async () => {
      const result = await commands.scroll(page, 'down', 500);
      expect(result.success).toBe(true);
      expect(page.evaluate).toHaveBeenCalled();
    });

    it('should scroll up', async () => {
      const result = await commands.scroll(page, 'up', 300);
      expect(result.success).toBe(true);
    });

    it('should use default amount of 300px', async () => {
      await commands.scroll(page, 'down');
      const evalCall = page.evaluate.mock.calls[0];
      // Second argument is the scroll amount
      expect(evalCall[2]).toBe(300); // y amount
    });
  });

  describe('screenshot', () => {
    it('should take a screenshot', async () => {
      const result = await commands.screenshot(page);
      expect(result.buffer).toBeDefined();
      expect(result.width).toBe(1280);
      expect(result.height).toBe(800);
    });

    it('should support fullPage option', async () => {
      await commands.screenshot(page, { fullPage: true });
      expect(page.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({ fullPage: true }),
      );
    });
  });

  describe('goBack', () => {
    it('should go back in history', async () => {
      const result = await commands.goBack(page);
      expect(result.success).toBe(true);
      expect(page.goBack).toHaveBeenCalled();
    });
  });

  describe('goForward', () => {
    it('should go forward in history', async () => {
      const result = await commands.goForward(page);
      expect(result.success).toBe(true);
      expect(page.goForward).toHaveBeenCalled();
    });
  });

  describe('pressKey', () => {
    it('should press a key', async () => {
      const result = await commands.pressKey(page, 'Enter');
      expect(result.success).toBe(true);
      expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
    });
  });

  describe('hover', () => {
    it('should hover over an element', async () => {
      const result = await commands.hover(page, 'div.menu-item');
      expect(result.success).toBe(true);
      expect(page.hover).toHaveBeenCalledWith('div.menu-item');
    });
  });

  describe('selectOption', () => {
    it('should select an option', async () => {
      const result = await commands.selectOption(page, 'select#country', 'US');
      expect(result.success).toBe(true);
      expect(page.select).toHaveBeenCalledWith('select#country', 'US');
    });
  });

  describe('waitForNavigation', () => {
    it('should wait for navigation', async () => {
      const result = await commands.waitForNavigation(page);
      expect(result.success).toBe(true);
      expect(page.waitForNavigation).toHaveBeenCalled();
    });
  });
});
