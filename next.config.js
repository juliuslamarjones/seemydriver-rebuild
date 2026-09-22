module.exports = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/:path*/assetlinks.json',
        destination: '/api/assetlinks',
      },
    ];
  },
};
