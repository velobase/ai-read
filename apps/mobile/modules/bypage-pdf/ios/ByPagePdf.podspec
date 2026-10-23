Pod::Spec.new do |s|
  s.name = 'ByPagePdf'
  s.version = '0.1.0'
  s.summary = 'Local PDF extraction for ByPage'
  s.description = 'PDFKit text extraction with optional local Vision OCR.'
  s.license = 'MIT'
  s.author = 'ByPage'
  s.homepage = 'https://github.com/velobase/ai-read'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'PDFKit', 'Vision'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
