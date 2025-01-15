import {
	chromium,
	type Browser,
	type BrowserContext,
	type Page,
	type CDPSession,
} from 'playwright';
import { EventHub } from './event-hub.js';
import type { ViewportEventMap, ViewportRequestMap } from './events.js';
import type { LaunchOptions, ViewportSnapshot, TabDescriptor } from './types.js';
import { LaunchProfile } from './launch-profile.js';
import { BaseGuard, type GuardContext } from './guard-base.js';
import { LaunchFailedError, ViewportCrashedError } from '../errors.js';
import { tabId, targetId, type TargetId } from '../types.js';
import { createLogger } from '../logging.js';
import { timed } from '../telemetry.js';
import { isNewTabPage } from '../utils.js';

// Watchdogs
import { LocalInstanceGuard } from './guards/local-instance.js';
import { UrlPolicyGuard } from './guards/url-policy.js';
import { DefaultHandlerGuard } from './guards/default-handler.js';
import { PopupGuard } from './guards/popups.js';
import { PageReadyGuard } from './guards/page-ready.js';
import { DownloadGuard } from './guards/downloads.js';
