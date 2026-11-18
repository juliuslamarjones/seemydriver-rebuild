import { NextResponse } from 'next/server';
export function middleware(req) {
  if (req.nextUrl.pathname === '/.well-known/assetlinks.json') {
    const data = [{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:'com.seemydriver.www.twa',sha256_cert_fingerprints:['CF:C1:C3:11:C3:61:22:ED:69:B0:5B:4E:45:10:BE:85:3C:A9:38:57:F0:DB:D3:B0:DC:54:D6:73:37:26:10:BA']}}];
    return new NextResponse(JSON.stringify(data, null, 2), {status: 200, headers: {'Content-Type': 'application/json'}});
  }
  return NextResponse.next();
}
export const config = { matcher: '/.well-known/assetlinks.json' };
