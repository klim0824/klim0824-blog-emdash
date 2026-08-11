import type { APIRoute } from "astro";
import { getEmDashCollection, getSiteSettings } from "emdash";

import { resolveBlogSiteIdentity } from "../utils/site-identity";
import { getPostUrl } from "../utils/post-url";

export const GET: APIRoute = async ({ site, url }) => {
	const siteUrl = site?.toString() || url.origin;
	const { siteTitle, siteTagline } = resolveBlogSiteIdentity(await getSiteSettings());

	// published_date carries the real historical publish date; the system
	// published_at is only when the row was migrated/created.
	const { entries: posts } = await getEmDashCollection("posts", {
		orderBy: { published_date: "desc" },
		limit: 20,
	});

	const items = posts
		.map((post) => {
			if (!post.data.published_date) return null;
			const pubDate = new Date(post.data.published_date).toUTCString();

			const postUrl = `${siteUrl}${getPostUrl(post)}`;
			const title = escapeXml(post.data.title || "Untitled");
			const description = escapeXml(post.data.excerpt || "");

			return `    <item>
      <title>${title}</title>
      <link>${postUrl}</link>
      <guid isPermaLink="true">${postUrl}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${description}</description>
    </item>`;
		})
		.filter(Boolean)
		.join("\n");

	const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(siteTitle)}</title>
    <description>${escapeXml(siteTagline)}</description>
    <link>${siteUrl}</link>
    <atom:link href="${siteUrl}/rss.xml" rel="self" type="application/rss+xml"/>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

	return new Response(rss, {
		headers: {
			"Content-Type": "application/rss+xml; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
};

const XML_ESCAPE_PATTERNS = [
	[/&/g, "&amp;"],
	[/</g, "&lt;"],
	[/>/g, "&gt;"],
	[/"/g, "&quot;"],
	[/'/g, "&apos;"],
] as const;

function escapeXml(str: string): string {
	let result = str;
	for (const [pattern, replacement] of XML_ESCAPE_PATTERNS) {
		result = result.replace(pattern, replacement);
	}
	return result;
}
