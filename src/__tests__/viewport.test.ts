import { Viewport } from '../viewport';
import { ViewportError, LaunchFailedError } from '../errors';

// Mock puppeteer
jest.mock('puppeteer', () => {
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

