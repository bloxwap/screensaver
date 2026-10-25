import type { AssetSymbol } from './assets';

export {};

declare global {
  interface Window {
    /** Injected by the native ScreenSaverView before application code runs. */
    readonly nativeScreensaver?: Readonly<{
      asset: AssetSymbol;
      isPreview: boolean;
    }>;
    screensaver?: {
      dismiss: () => void;
      getSettings: () => Promise<{ idleEnabled: boolean; idleMinutes: number }>;
      setSettings: (value: { idleEnabled: boolean; idleMinutes: number }) => Promise<{ idleEnabled: boolean; idleMinutes: number }>;
    };
  }
}
