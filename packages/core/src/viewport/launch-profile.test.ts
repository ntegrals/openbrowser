import { test, expect, describe } from 'bun:test';
import {
	LaunchProfile,
	CHROME_AUTOMATION_FLAGS,
	CHROME_STRIPPED_FEATURES,
	ANTI_DETECTION_FLAGS,
	CONTAINER_FLAGS,
	REPRODUCIBLE_RENDER_FLAGS,
	RELAXED_SECURITY_FLAGS,
} from './launch-profile.js';

describe('LaunchProfile', () => {
	describe('static create', () => {
		test('returns a LaunchProfile instance', () => {
			const profile = LaunchProfile.create();
			expect(profile).toBeInstanceOf(LaunchProfile);
		});
	});

	describe('default build', () => {
		test('produces headless true by default', () => {
			const opts = LaunchProfile.create().build();
			expect(opts.headless).toBe(true);
		});

		test('produces default window size 1280x1100', () => {
			const opts = LaunchProfile.create().build();
			expect(opts.windowWidth).toBe(1280);
			expect(opts.windowHeight).toBe(1100);
		});

		test('persistAfterClose defaults to false', () => {
			const opts = LaunchProfile.create().build();
			expect(opts.persistAfterClose).toBe(false);
		});

		test('relaxedSecurity defaults to false', () => {
			const opts = LaunchProfile.create().build();
			expect(opts.relaxedSecurity).toBe(false);
		});

		test('includes CHROME_AUTOMATION_FLAGS in extraArgs', () => {
			const opts = LaunchProfile.create().build();
			for (const arg of CHROME_AUTOMATION_FLAGS) {
				expect(opts.extraArgs).toContain(arg);
			}
		});

		test('includes disabled components feature flag', () => {
			const opts = LaunchProfile.create().build();
			const disableFeatures = opts.extraArgs.find((a) =>
				a.startsWith('--disable-features='),
			);
			expect(disableFeatures).toBeDefined();
			for (const component of CHROME_STRIPPED_FEATURES) {
				expect(disableFeatures).toContain(component);
			}
		});

		test('includes window-size arg', () => {
			const opts = LaunchProfile.create().build();
			expect(opts.extraArgs).toContain('--window-size=1280,1100');
		});

		test('proxy is undefined by default', () => {
			const opts = LaunchProfile.create().build();
			expect(opts.proxy).toBeUndefined();
		});

		test('userDataDir is undefined by default', () => {
			const opts = LaunchProfile.create().build();
			expect(opts.userDataDir).toBeUndefined();
		});

		test('channelName is undefined by default', () => {
			const opts = LaunchProfile.create().build();
			expect(opts.channelName).toBeUndefined();
		});
	});

	describe('.headless()', () => {
		test('headless(true) sets headless to true', () => {
			const opts = LaunchProfile.create().headless(true).build();
			expect(opts.headless).toBe(true);
		});

		test('headless(false) sets headless to false', () => {
			const opts = LaunchProfile.create().headless(false).build();
			expect(opts.headless).toBe(false);
		});

		test('headless() with no argument defaults to true', () => {
			const opts = LaunchProfile.create().headless().build();
			expect(opts.headless).toBe(true);
		});
	});

	describe('.headful() equivalent', () => {
		test('headless(false) creates headful mode', () => {
			const opts = LaunchProfile.create().headless(false).build();
			expect(opts.headless).toBe(false);
		});
	});

	describe('.stealthMode()', () => {
		test('adds stealth args when enabled', () => {
			const opts = LaunchProfile.create().stealthMode().build();
			for (const arg of ANTI_DETECTION_FLAGS) {
				expect(opts.extraArgs).toContain(arg);
			}
		});

		test('does not add stealth args when disabled', () => {
			const opts = LaunchProfile.create().stealthMode(false).build();
			// ANTI_DETECTION_FLAGS[1] is --disable-features=AutomationControlled
			// which won't be in the base args (only in ANTI_DETECTION_FLAGS)
			// But CHROME_AUTOMATION_FLAGS also contains --disable-blink-features=AutomationControlled
			// so check for the features one specifically
			const stealthOnlyArg = '--disable-features=AutomationControlled';
			const hasStealthOnlyArg = opts.extraArgs.some(
				(a) => a === stealthOnlyArg,
			);
			expect(hasStealthOnlyArg).toBe(false);
		});

		test('returns this for chaining', () => {
			const profile = LaunchProfile.create();
			const result = profile.stealthMode();
			expect(result).toBe(profile);
		});
	});

	describe('.dockerMode()', () => {
		test('adds docker args when enabled', () => {
			const opts = LaunchProfile.create().dockerMode().build();
			for (const arg of CONTAINER_FLAGS) {
				expect(opts.extraArgs).toContain(arg);
			}
		});

		test('does not add docker args when disabled', () => {
			const opts = LaunchProfile.create().dockerMode(false).build();
			// --no-sandbox should not be present when docker mode is off
			expect(opts.extraArgs).not.toContain('--no-sandbox');
		});
	});

	describe('.deterministicRendering()', () => {
		test('adds deterministic rendering args when enabled', () => {
			const opts = LaunchProfile.create().deterministicRendering().build();
			for (const arg of REPRODUCIBLE_RENDER_FLAGS) {
				expect(opts.extraArgs).toContain(arg);
			}
		});

		test('does not add deterministic args when disabled', () => {
			const opts = LaunchProfile.create().deterministicRendering(false).build();
			expect(opts.extraArgs).not.toContain('--deterministic-mode');
		});
	});

	describe('.relaxedSecurity()', () => {
		test('adds security-disable args when enabled', () => {
			const opts = LaunchProfile.create().relaxedSecurity().build();
			expect(opts.relaxedSecurity).toBe(true);
			for (const arg of RELAXED_SECURITY_FLAGS) {
				expect(opts.extraArgs).toContain(arg);
			}
		});

		test('does not add security args when disabled', () => {
			const opts = LaunchProfile.create().relaxedSecurity(false).build();
			expect(opts.relaxedSecurity).toBe(false);
			expect(opts.extraArgs).not.toContain('--disable-web-security');
		});
	});

	describe('.downloadsPath()', () => {
		test('adds download-default-directory arg', () => {
			const opts = LaunchProfile.create()
				.downloadsPath('/tmp/downloads')
				.build();
			expect(opts.extraArgs).toContain(
				'--download-default-directory=/tmp/downloads',
			);
		});
	});

	describe('.maxIframes()', () => {
		test('returns this for chaining', () => {
			const profile = LaunchProfile.create();
			const result = profile.maxIframes(5);
			expect(result).toBe(profile);
		});
	});

	describe('.addExtension()', () => {
		test('adds single extension path to load-extension arg', () => {
			const opts = LaunchProfile.create()
				.addExtension('/path/to/ext1')
				.build();
			const loadExtArg = opts.extraArgs.find((a) =>
				a.startsWith('--load-extension='),
			);
			expect(loadExtArg).toBe('--load-extension=/path/to/ext1');
		});

		test('adds multiple extensions as comma-separated list', () => {
			const opts = LaunchProfile.create()
				.addExtension('/path/to/ext1')
				.addExtension('/path/to/ext2')
				.build();
			const loadExtArg = opts.extraArgs.find((a) =>
				a.startsWith('--load-extension='),
			);
			expect(loadExtArg).toBe(
				'--load-extension=/path/to/ext1,/path/to/ext2',
			);
		});

		test('no load-extension arg when no extensions added', () => {
			const opts = LaunchProfile.create().build();
			const loadExtArg = opts.extraArgs.find((a) =>
				a.startsWith('--load-extension='),
			);
			expect(loadExtArg).toBeUndefined();
		});
	});

	describe('.windowSize()', () => {
		test('sets custom window dimensions', () => {
			const opts = LaunchProfile.create().windowSize(1920, 1080).build();
			expect(opts.windowWidth).toBe(1920);
			expect(opts.windowHeight).toBe(1080);
			expect(opts.extraArgs).toContain('--window-size=1920,1080');
		});
	});

	describe('.proxy()', () => {
		test('sets proxy server', () => {
			const opts = LaunchProfile.create()
				.proxy('http://proxy:8080')
				.build();
			expect(opts.proxy).toEqual({
				server: 'http://proxy:8080',
				username: undefined,
				password: undefined,
			});
		});

		test('sets proxy with credentials', () => {
			const opts = LaunchProfile.create()
				.proxy('http://proxy:8080', 'user', 'pass')
				.build();
			expect(opts.proxy).toEqual({
				server: 'http://proxy:8080',
				username: 'user',
				password: 'pass',
			});
		});
	});

	describe('.userDataDir()', () => {
		test('sets user data directory', () => {
			const opts = LaunchProfile.create()
				.userDataDir('/tmp/chrome-data')
				.build();
			expect(opts.userDataDir).toBe('/tmp/chrome-data');
		});
	});

	describe('.browserBinary()', () => {
		test('sets browser binary path', () => {
			const opts = LaunchProfile.create()
				.browserBinary('/usr/bin/chromium')
				.build();
			expect(opts.browserBinaryPath).toBe('/usr/bin/chromium');
		});
	});

	describe('.persistAfterClose()', () => {
		test('sets persistAfterClose to true', () => {
			const opts = LaunchProfile.create().persistAfterClose().build();
			expect(opts.persistAfterClose).toBe(true);
		});

		test('sets persistAfterClose to false', () => {
			const opts = LaunchProfile.create().persistAfterClose(false).build();
			expect(opts.persistAfterClose).toBe(false);
		});
	});

	describe('.channel()', () => {
		test('sets channel name', () => {
			const opts = LaunchProfile.create().channel('chrome').build();
			expect(opts.channelName).toBe('chrome');
		});
	});

	describe('.extraArgs()', () => {
		test('appends extra args to the end', () => {
			const opts = LaunchProfile.create()
				.extraArgs('--custom-flag', '--another-flag')
				.build();
			expect(opts.extraArgs).toContain('--custom-flag');
			expect(opts.extraArgs).toContain('--another-flag');
		});

		test('user extra args can override earlier args', () => {
			const opts = LaunchProfile.create()
				.extraArgs('--override=value')
				.build();
			// The user arg should be at the end of the array (after CHROME_AUTOMATION_FLAGS)
			const lastArgs = opts.extraArgs.slice(-1);
			expect(lastArgs).toContain('--override=value');
		});
	});

	describe('builder chaining', () => {
		test('multiple methods can be chained together', () => {
			const opts = LaunchProfile.create()
				.headless(false)
				.stealthMode()
				.dockerMode()
				.deterministicRendering()
				.windowSize(800, 600)
				.downloadsPath('/downloads')
				.addExtension('/ext')
				.persistAfterClose()
				.build();

			expect(opts.headless).toBe(false);
			expect(opts.persistAfterClose).toBe(true);
			expect(opts.windowWidth).toBe(800);
			expect(opts.windowHeight).toBe(600);
			expect(opts.extraArgs).toContain('--window-size=800,600');

			for (const arg of ANTI_DETECTION_FLAGS) {
				expect(opts.extraArgs).toContain(arg);
			}
			for (const arg of CONTAINER_FLAGS) {
				expect(opts.extraArgs).toContain(arg);
			}
			for (const arg of REPRODUCIBLE_RENDER_FLAGS) {
				expect(opts.extraArgs).toContain(arg);
			}
		});
	});
});

describe('CHROME_AUTOMATION_FLAGS', () => {
	test('is a non-empty array', () => {
		expect(Array.isArray(CHROME_AUTOMATION_FLAGS)).toBe(true);
		expect(CHROME_AUTOMATION_FLAGS.length).toBeGreaterThan(10);
	});

	test('contains essential flags', () => {
		expect(CHROME_AUTOMATION_FLAGS).toContain('--no-first-run');
		expect(CHROME_AUTOMATION_FLAGS).toContain('--disable-popup-blocking');
		expect(CHROME_AUTOMATION_FLAGS).toContain('--disable-infobars');
