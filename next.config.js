module.exports = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: '/.well-known/assetlinks.json', destination: '/api/assetlinks' },
      { source: '/.well%20known/assetlinks.json', destination: '/api/assetlinks' },
      { source: '/assetlinks.json', destination: '/api/assetlinks' }
    ];
  },
};
