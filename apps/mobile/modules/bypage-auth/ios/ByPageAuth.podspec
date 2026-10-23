Pod::Spec.new do |s|
  s.name = 'ByPageAuth'
  s.version = '0.1.0'
  s.summary = 'System browser account sign-in for ByPage'
  s.description = 'ASWebAuthenticationSession, PKCE and origin-bound Keychain credentials.'
  s.license = 'MIT'
  s.author = 'ByPage'
  s.homepage = 'https://github.com/velobase/ai-read'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AuthenticationServices', 'Security', 'CryptoKit', 'UIKit'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
