export {};

declare global {
  interface Window {
    screensaver?: {
      dismiss: () => void;
      getSettings: () => Promise<{ idleEnabled: boolean; idleMinutes: number }>;
      setSettings: (value: { idleEnabled: boolean; idleMinutes: number }) => Promise<{ idleEnabled: boolean; idleMinutes: number }>;
    };
  }
}
