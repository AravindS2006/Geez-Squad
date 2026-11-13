import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/privacy', '/terms', '/demo'],
      disallow: ['/app', '/api/', '/studio/', '/invite'],
    },
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
