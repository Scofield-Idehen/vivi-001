import { TAG_MAX, TAGS_MAX, TagsSchema } from '@v01/shared';
import { describe, expect, it } from 'vitest';
import { addTag } from '../src/pages/properties/tagList.ts';

describe('tags on a property', () => {
  it('adds a typed tag tidied, once whatever the capitals', () => {
    expect(addTag(['Sea view'], '  Owner:   Ellis ')).toEqual({
      tags: ['Sea view', 'Owner: Ellis'],
      error: null,
    });
    expect(addTag(['Sea view'], 'sea VIEW')).toEqual({ tags: ['Sea view'], error: null });
    expect(addTag(['Sea view'], '   ')).toEqual({ tags: ['Sea view'], error: null });
  });

  it('says why a tag can’t be added', () => {
    expect(addTag([], 'x'.repeat(TAG_MAX + 1)).error).toBe(`Keep a tag to ${TAG_MAX} characters`);
    const full = Array.from({ length: TAGS_MAX }, (_, i) => `Tag ${i}`);
    expect(addTag(full, 'One more')).toEqual({
      tags: full,
      error: `A property can have up to ${TAGS_MAX} tags`,
    });
  });

  it('agrees with what the API accepts', () => {
    const typed = ['Family', ' family ', 'Large groups'];
    const added = typed.reduce((tags, t) => addTag(tags, t).tags, [] as string[]);
    expect(TagsSchema.parse(typed)).toEqual(added);
  });
});
