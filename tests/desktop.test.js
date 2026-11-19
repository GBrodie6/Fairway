// Desktop sizing (src/ui/desktop.js): phones and tablets are never desktop, desktop sizes scale
// the HUD and menus with the height and the Screen size setting, and an ultrawide brings the HUD
// corners in. The settings value is validated.
import { describe, it, expect } from 'vitest';
import { deskScale, SCREEN_SIZES, DESK_MIN_W, DESK_MIN_H } from '../src/ui/desktop.js';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../src/core/settings.js';

describe('desktop sizing', () => {
  it('leaves phones and tablets exactly as they are', () => {
    for (const [w, h] of [[390, 844], [844, 390], [360, 640], [640, 360], [1024, 768], [768, 1024], [1180, 639], [911, 512]]) {
      expect(deskScale(w, h)).toEqual({ desk: false, hud: 1, menu: 1, ex: 0 });
    }
    expect(deskScale(DESK_MIN_W, DESK_MIN_H).desk).toBe(true);
  });
  it('scales the HUD and menus with the window height, capped', () => {
    expect(deskScale(1366, 768).hud).toBe(1);
    expect(deskScale(1920, 1080).hud).toBe(1.2);
    expect(deskScale(2560, 1440).hud).toBe(1.6);
    expect(deskScale(3840, 2160).hud).toBe(1.6);
    expect(deskScale(2560, 1440).menu).toBe(1.45);
  });
  it('follows the Screen size setting', () => {
    expect(deskScale(1920, 1080, 'small').hud).toBeCloseTo(1.2 * SCREEN_SIZES.small, 3);
    expect(deskScale(1920, 1080, 'large').hud).toBeCloseTo(1.2 * SCREEN_SIZES.large, 3);
    expect(deskScale(1920, 1080, 'nonsense').hud).toBe(1.2);
  });
  it('brings the HUD corners in on an ultrawide only', () => {
    expect(deskScale(1920, 1080).ex).toBe(0);
    expect(deskScale(2560, 1440).ex).toBe(0);
    expect(deskScale(3440, 1440).ex).toBe(352);
    expect(deskScale(5120, 1440).ex).toBe(1192);
  });
  it('the setting is validated', () => {
    expect(DEFAULT_SETTINGS.screenSize).toBe('normal');
    expect(sanitizeSettings({ screenSize: 'large' }).screenSize).toBe('large');
    expect(sanitizeSettings({ screenSize: 'huge' }).screenSize).toBe('normal');
  });
});
