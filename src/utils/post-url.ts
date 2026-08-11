// Old site URLs were /articles/{YYYYMMDD}/{slug}, built from the raw UTC
// date substring (no timezone conversion). Migrated posts carry that same
// historical date in the published_date field, and cross-links inside
// migrated post bodies already point at YYYYMMDD segments computed this way
// — keep this in sync with those.
export function formatDateSegment(date: Date | string): string {
	const d = typeof date === "string" ? new Date(date) : date;
	const yyyy = d.getUTCFullYear();
	const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(d.getUTCDate()).padStart(2, "0");
	return `${yyyy}${mm}${dd}`;
}

export function getPostUrl(post: { id: string; data: { published_date?: string | null } }): string {
	const raw = post.data.published_date;
	if (!raw) return `/posts/${post.id}`;
	return `/articles/${formatDateSegment(raw)}/${post.id}`;
}
