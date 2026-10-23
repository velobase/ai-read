import { StoreBookPage } from '@/components/library/storefront';
export default async function Page({ params }: { params: Promise<{ slug: string }> }) { return <StoreBookPage slug={(await params).slug} />; }
