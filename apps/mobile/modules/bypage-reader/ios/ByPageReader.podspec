Pod::Spec.new do |s|
  s.name = 'ByPageReader'
  s.version = '0.1.0'
  s.summary = 'Native page transitions for ByPage'
  s.description = 'UIKit page curl, slide and instant reading transitions.'
  s.license = 'MIT'
  s.author = 'ByPage'
  s.homepage = 'https://github.com/velobase/ai-read'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UIKit'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
