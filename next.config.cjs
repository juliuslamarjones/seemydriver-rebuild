module.exports = {
  reactStrictMode: true,
  async redirects() {
    return [{ source: '/seemydriver.apk', destination: 'https://github.com/juliuslamarjones/seemydriver-rebuild/releases/download/v1.0.0/seemydriver.apk', permanent: false }];
  }
};
