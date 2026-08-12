import { getEmDashCollection, type MediaValue } from "emdash";

// Tag icons live in their own collection keyed by tag_slug rather than as
// a field on the tag taxonomy term, so any page rendering tag chips needs
// this lookup to attach an icon by slug.
export async function getTagIconMap(): Promise<Map<string, MediaValue>> {
	const { entries } = await getEmDashCollection("tag_icons");
	return new Map(
		entries.map((entry) => [entry.data.tag_slug, entry.data.icon]),
	);
}
