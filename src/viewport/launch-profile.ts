import type { LaunchOptions } from './types';

/**
 * Builder pattern for constructing browser launch options.
 */
export class LaunchProfile {
  private options: Partial<LaunchOptions> = {};

  headless(value = true): this {
    this.options.headless = value;
    return this;
  }

  windowSize(width: number, height: number): this {
    this.options.windowWidth = width;
    this.options.windowHeight = height;
    return this;
  }

  relaxedSecurity(value = true): this {
    this.options.relaxedSecurity = value;
    return this;
  }

  proxy(server: string, username?: string, password?: string): this {
    this.options.proxy = { server, username, password };
    return this;
  }

  userDataDir(path: string): this {
    this.options.userDataDir = path;
    return this;
  }

  browserBinary(path: string): this {
    this.options.browserBinaryPath = path;
    return this;
  }

  persistAfterClose(value = true): this {
    this.options.persistAfterClose = value;
    return this;
  }

  channel(name: string): this {
    this.options.channelName = name;
    return this;
  }

  extraArgs(...args: string[]): this {
    this.options.extraArgs = [...(this.options.extraArgs ?? []), ...args];
    return this;
  }

  build(): LaunchOptions {
    return {
      headless: this.options.headless ?? true,
      relaxedSecurity: this.options.relaxedSecurity ?? false,
      extraArgs: this.options.extraArgs ?? [],
      windowWidth: this.options.windowWidth ?? 1280,
      windowHeight: this.options.windowHeight ?? 1100,
      proxy: this.options.proxy,
      userDataDir: this.options.userDataDir,
      browserBinaryPath: this.options.browserBinaryPath,
      persistAfterClose: this.options.persistAfterClose ?? false,
      channelName: this.options.channelName,
    };
  }
}
