// Native builds receive only these public, explicitly selected values.
const environment = process.env.BYPAGE_MOBILE_ENV || 'development';
if (!['development', 'production'].includes(environment))
  throw new Error('Invalid BYPAGE_MOBILE_ENV');
const officialOrigin = 'https://leafread.ai';
// Only local development builds can use a loopback backend. There is no
// customer-selectable server, and release builds always use the official service.
const apiOrigin = process.env.BYPAGE_MOBILE_API_ORIGIN || officialOrigin;
if (apiOrigin !== officialOrigin) {
  const url = new URL(apiOrigin);
  if (
    environment !== 'development' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !['http:', 'https:'].includes(url.protocol)
  ) {
    throw new Error(
      'Mobile builds use https://leafread.ai. Only development builds allow a loopback origin.',
    );
  }
}

module.exports = {
  name: 'LeafRead',
  slug: 'bypage-reader',
  owner: 'attune-dating-team',
  icon: './assets/icon.png',
  version: '1.0.5',
  locales: {
    en: { CFBundleDisplayName: 'LeafRead' },
    'zh-Hans': { CFBundleDisplayName: '叶子阅读' },
    'zh-Hant': { CFBundleDisplayName: '葉子閱讀' },
  },
  scheme: [
    'bypage',
    'com.velobase.bypage',
    'com.googleusercontent.apps.921480483661-3jcm4s70ugvgpbsntqjn3tu7f87e0ku2',
  ],
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'com.velobase.bypage',
    usesAppleSignIn: true,
    entitlements: { 'com.apple.developer.applesignin': ['Default'] },
    buildNumber: '1',
    supportsTablet: true,
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
          // Private library files and external documents explicitly opened by the user.
          NSPrivacyAccessedAPITypeReasons: ['C617.1', '3B52.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
          NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
        },
      ],
    },
    infoPlist: {
      CFBundleDisplayName: 'LeafRead',
      GIDClientID: '921480483661-3jcm4s70ugvgpbsntqjn3tu7f87e0ku2.apps.googleusercontent.com',
      GIDServerClientID: '921480483661-k7bj60rqb8be0t10pi4558p21tkl3101.apps.googleusercontent.com',
      ITSAppUsesNonExemptEncryption: false,
      ByPageAuthAllowLocalHTTP: environment === 'development',
      ByPageServiceOrigin: new URL(apiOrigin).origin,
      // Import into a private pending inbox; never edit the external document.
      LSSupportsOpeningDocumentsInPlace: false,
      UIFileSharingEnabled: false,
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: 'Books and reading packs',
          CFBundleTypeRole: 'Viewer',
          LSHandlerRank: 'Alternate',
          LSItemContentTypes: [
            'com.adobe.pdf',
            'org.idpf.epub-container',
            'public.plain-text',
            'public.json',
          ],
        },
      ],
      UTImportedTypeDeclarations: [
        {
          UTTypeIdentifier: 'org.idpf.epub-container',
          UTTypeDescription: 'EPUB book',
          UTTypeConformsTo: ['public.data'],
          UTTypeTagSpecification: {
            'public.filename-extension': ['epub'],
            'public.mime-type': ['application/epub+zip'],
          },
        },
      ],
      ...(environment === 'development'
        ? {
            NSLocalNetworkUsageDescription:
              'Connect to the development server on your local network.',
            NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
          }
        : {}),
    },
  },
  android: { package: 'com.velobase.bypage', allowBackup: false },
  plugins: [
    './plugins/with-google-signin',
    'expo-document-picker',
    'expo-sqlite',
    'expo-localization',
    'expo-font',
    'expo-sharing',
    'expo-status-bar',
  ],
  extra: {
    apiOrigin: new URL(apiOrigin).origin,
    environment,
    eas: { projectId: 'a3adde3b-27f2-4af9-9f9e-43f25e8d5d3e' },
  },
};
