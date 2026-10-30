import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mobflow.app',
  appName: 'MobFlow',
  webDir: 'www',
  server: {
    url: 'https://mobflow-pos-stock.lovable.app',
    cleartext: false,
    androidScheme: 'https',
    allowNavigation: ['mobflow-pos-stock.lovable.app'],
  },
};

export default config;
