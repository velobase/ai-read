Pod::Spec.new do |s|
  s.name = 'ByPageAuth'
  s.version = '0.1.0'
  s.summary = 'Native Apple and Google account sign-in for LeafRead'
  s.description = 'System Apple authorization, Google Sign-In SDK, and origin-bound Keychain sessions.'
  s.license = 'MIT'
  s.author = 'ByPage'
  s.homepage = 'https://github.com/velobase/ai-read'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'GoogleSignIn', '9.2.0'
  s.frameworks = 'AuthenticationServices', 'Security', 'CryptoKit', 'UIKit'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
