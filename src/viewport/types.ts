export interface LaunchOptions {
  headless: boolean;
  relaxedSecurity: boolean;
  extraArgs: string[];
  windowWidth: number;
  windowHeight: number;
  proxy?: { server: string; username?: string; password?: string };
  userDataDir?: string;
  browserBinaryPath?: string;
  persistAfterClose: boolean;
  channelName?: string;
}

export interface TabDescriptor {
  tabId: number;
  url: string;
  title: string;
  isActive: boolean;
}

export interface ViewportSnapshot {
  url: string;
  title: string;
  tabs: TabDescriptor[];
  activeTabIndex: number;
}
