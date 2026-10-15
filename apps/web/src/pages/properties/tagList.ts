import { TAG_MAX, TAGS_MAX } from '@v01/shared';

/**
 * Adds a typed tag to a property's list: tidied, and only if it isn't empty, too long, there already
 * (whatever the capitals) or one too many. The API applies the same rules.
 */
export function addTag(tags: string[], typed: string): { tags: string[]; error: string | null } {
  const tag = typed.trim().replace(/\s+/g, ' ');
  if (!tag) return { tags, error: null };
  if (tag.length > TAG_MAX) return { tags, error: `Keep a tag to ${TAG_MAX} characters` };
  if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return { tags, error: null };
  if (tags.length >= TAGS_MAX) return { tags, error: `A property can have up to ${TAGS_MAX} tags` };
  return { tags: [...tags, tag], error: null };
}
