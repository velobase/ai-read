import Link from 'next/link';
import { catalogAdministrator } from '@/lib/server/catalog-admin';
export const dynamic = 'force-dynamic';
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await catalogAdministrator()))
    return (
      <main className="mx-auto max-w-lg p-12">
        <h1 className="text-2xl font-semibold">LeafRead Admin</h1>
        <p className="my-6">Sign in with your administrator account to manage the bookstore.</p>
        <Link className="library-primary" href="/login">
          Sign in
        </Link>
        <Link className="ml-6 underline" href="/">
          Back to reading
        </Link>
      </main>
    );
  return (
    <div className="min-h-screen bg-[#f7f8f6] text-[#24382e]">
      <header className="border-b bg-white px-6 py-5 flex items-center justify-between">
        <Link href="/admin" className="text-xl font-semibold">
          LeafRead <span className="text-sm font-normal text-gray-500">/ Bookstore Admin</span>
        </Link>
        <Link href="/discover" target="_blank" className="text-sm underline">
          Open bookstore ↗
        </Link>
      </header>
      {children}
    </div>
  );
}
