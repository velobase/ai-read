const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../../packages')];
// The web host uses a different React version. Resolve native dependencies here.
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules')];
module.exports = config;
