export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json([
    {
      "relation": ["delegate_permission/common.handle_all_urls"],
      "target": {
        "namespace": "android_app",
        "package_name": "com.seemydriver.www.twa",
        "sha256_cert_fingerprints": [
          "CF:C1:C3:11:C3:61:22:ED:69:B0:5B:4E:45:10:BE:85:3C:A9:38:57:F0:DB:D3:B0:DC:54:D6:73:37:26:10:BA"
        ]
      }
    }
  ]);
}