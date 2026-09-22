module.exports = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/.well-known/assetlinks.json',
        destination: '/assetlinks-real.json',
      },
    ];
  },
};
