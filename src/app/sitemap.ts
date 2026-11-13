import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  return ['', '/demo', '/login', '/privacy', '/terms'].map((path) => ({
    url: `${origin}${path}`,
    changeFrequency: 'monthly',
    priority: path ? 0.6 : 1,
  }));
}
