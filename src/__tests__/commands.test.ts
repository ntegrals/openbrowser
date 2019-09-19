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
