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
