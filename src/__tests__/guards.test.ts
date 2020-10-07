import { BlankPageGuard } from '../guards/blank-page';
import { CrashGuard } from '../guards/crash';
import { PopupGuard } from '../guards/popups';
import { UrlPolicyGuard } from '../guards/url-policy';

describe('Guards', () => {
  describe('BlankPageGuard', () => {
    it('should have correct name and priority', () => {
      const guard = new BlankPageGuard();
      expect(guard.name).toBe('blank-page');
      expect(guard.priority).toBe(50);
    });
  });

  describe('CrashGuard', () => {
    it('should have correct name and priority', () => {
      const guard = new CrashGuard();
      expect(guard.name).toBe('crash');
      expect(guard.priority).toBe(10);
    });
  });

  describe('PopupGuard', () => {
    it('should have correct name and priority', () => {
      const guard = new PopupGuard();
      expect(guard.name).toBe('popups');
      expect(guard.priority).toBe(30);
    });
  });

  describe('UrlPolicyGuard', () => {
    it('should have correct name and priority', () => {
      const guard = new UrlPolicyGuard();
      expect(guard.name).toBe('url-policy');
      expect(guard.priority).toBe(20);
    });
  });
});
