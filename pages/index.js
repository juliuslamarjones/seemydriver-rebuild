import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/fleet');
  }, [router]);

  return (
    <div className="bg-black text-white h-screen w-screen flex items-center justify-center font-mono text-xs">
      <span className="text-amber-400 animate-pulse">Loading SeeMyDriver Command Center...</span>
    </div>
  );
}
