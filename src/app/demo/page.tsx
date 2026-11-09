import type { Metadata } from 'next';
import { demoData } from '@/lib/demo';
import { Workspace } from '@/components/workspace';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sample studio' };
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const query = await searchParams;
  return <Workspace initial={demoData()} view={query.view || 'dashboard'} />;
}
