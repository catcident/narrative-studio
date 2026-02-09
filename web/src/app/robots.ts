import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/app', '/api/'],
      },
    ],
    sitemap: 'https://storygraph.catcident.com/sitemap.xml',
  };
}
