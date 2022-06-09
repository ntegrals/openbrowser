import { Viewport } from '../viewport';
import { ViewportError, LaunchFailedError } from '../errors';

// Mock puppeteer
// @ts-nocheck
// TODO: update mocks for bun:test

jest.mock('playwright', () => {
  const mockPage = {
    goto: jest.fn().mockResolvedValue(null),
    url: jest.fn().mockReturnValue('https://example.com'),
    title: jest.fn().mockResolvedValue('Example'),
    click: jest.fn().mockResolvedValue(undefined),
    type: jest.fn().mockResolvedValue(undefined),
    screenshot: jest.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
    viewport: jest.fn().mockReturnValue({ width: 1280, height: 800 }),
    setViewport: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue(null),
    waitForSelector: jest.fn().mockResolvedValue(null),
    waitForNavigation: jest.fn().mockResolvedValue(null),
    goBack: jest.fn().mockResolvedValue(null),
    goForward: jest.fn().mockResolvedValue(null),
    keyboard: {
      press: jest.fn().mockResolvedValue(undefined),
    },
    hover: jest.fn().mockResolvedValue(undefined),
    select: jest.fn().mockResolvedValue(['value']),
    $eval: jest.fn().mockResolvedValue(null),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };

  const mockBrowser = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    close: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  };

  return {
    __esModule: true,
    default: {
      launch: jest.fn().mockResolvedValue(mockBrowser),
    },
  };
});

describe('Viewport', () => {
  let viewport: Viewport;

  beforeEach(() => {
    viewport = new Viewport({ headless: true });
  });

  afterEach(async () => {
    if (viewport.isConnected) {
      await viewport.close();
    }
  });

  describe('constructor', () => {
    it('should create a viewport with default config', () => {
      const vp = new Viewport();
      expect(vp.config.headless).toBe(true);
      expect(vp.config.viewport.width).toBe(1280);
      expect(vp.config.viewport.height).toBe(800);
    });

    it('should accept custom config', () => {
      const vp = new Viewport({
        headless: false,
        viewport: { width: 1920, height: 1080 },
      });
      expect(vp.config.headless).toBe(false);
      expect(vp.config.viewport.width).toBe(1920);
    });

    it('should generate a unique id', () => {
      const vp1 = new Viewport();
      const vp2 = new Viewport();
      expect(vp1.id).not.toBe(vp2.id);
    });
  });

  describe('launch', () => {
    it('should launch the browser', async () => {
      await viewport.launch();
      expect(viewport.isConnected).toBe(true);
    });

    it('should not launch twice', async () => {
      await viewport.launch();
      await viewport.launch(); // Should not throw
      expect(viewport.isConnected).toBe(true);
    });

    it('should emit launched event', async () => {
      const handler = jest.fn();
      viewport.events.on('launched', handler);
      await viewport.launch();
      expect(handler).toHaveBeenCalledWith({ headless: true });
    });
  });

  describe('navigation', () => {
    beforeEach(async () => {
      await viewport.launch();
    });

    it('should navigate to a URL', async () => {
      const result = await viewport.navigate('https://example.com');
      expect(result.success).toBe(true);
    });

    it('should emit navigated event', async () => {
      const handler = jest.fn();
      viewport.events.on('navigated', handler);
      await viewport.navigate('https://example.com');
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('page access', () => {
    it('should throw when accessing page before launch', () => {
      expect(() => viewport.page).toThrow(ViewportError);
    });

    it('should return page after launch', async () => {
      await viewport.launch();
      expect(viewport.page).toBeDefined();
    });
  });

  describe('close', () => {
    it('should close the browser', async () => {
      await viewport.launch();
      await viewport.close();
      expect(viewport.isConnected).toBe(false);
    });

    it('should emit closed event', async () => {
      await viewport.launch();
      const handler = jest.fn();
      viewport.events.on('closed', handler);
      await viewport.close();
      expect(handler).toHaveBeenCalled();
    });

    it('should be safe to call close without launching', async () => {
      await viewport.close(); // Should not throw
    });
  });

  describe('getPageInfo', () => {
    it('should return page metadata', async () => {
      await viewport.launch();
      const info = await viewport.getPageInfo();
      expect(info).toHaveProperty('url');
      expect(info).toHaveProperty('title');
      expect(info).toHaveProperty('viewport');
    });
  });

  describe('uptime', () => {
    it('should return 0 before launch', () => {
      expect(viewport.uptime).toBe(0);
    });

    it('should return positive value after launch', async () => {
      await viewport.launch();
      // Small delay to ensure uptime > 0
      await new Promise(r => setTimeout(r, 10));
      expect(viewport.uptime).toBeGreaterThan(0);
    });
  });
});
