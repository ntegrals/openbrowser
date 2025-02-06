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
