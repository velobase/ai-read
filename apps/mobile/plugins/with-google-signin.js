const { withPodfile } = require('@expo/config-plugins');

// Google Sign-In's optional App Check dependency needs module maps when Expo
// links pods statically. Keep this change reproducible in EAS prebuild.
module.exports = function withGoogleSignIn(config) {
  return withPodfile(config, (result) => {
    const marker = '  # LeafRead Google Sign-In module maps';
    if (!result.modResults.contents.includes(marker)) {
      const anchor = '  use_expo_modules!';
      if (!result.modResults.contents.includes(anchor))
        throw new Error('Google Sign-In: unsupported Expo Podfile template');
      result.modResults.contents = result.modResults.contents.replace(
        anchor,
        `${anchor}\n${marker}\n  pod 'GoogleUtilities', :modular_headers => true\n  pod 'RecaptchaInterop', :modular_headers => true`,
      );
    }
    return result;
  });
};
