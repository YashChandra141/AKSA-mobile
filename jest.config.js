/** Jest config: golden tests against the pure-TS sky engine.
 * jest-expo is the preset (per plan), but src/sky/** has no React Native
 * imports, so these tests also run in a plain Node environment. */

module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|astronomy-engine|fuse.js)',
  ],
  testMatch: ['**/tests/**/*.test.ts?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};