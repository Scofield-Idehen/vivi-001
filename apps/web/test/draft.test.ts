import { PropertyCreateSchema } from '@v01/shared';
import { describe, expect, it } from 'vitest';
import { V01 } from '../src/lib/format.ts';
import {
  amenitiesText,
  isDirty,
  limitsText,
  newDraft,
  type PropertyDraft,
  priceErrors,
  priceToMinor,
  roomsText,
  STAGES,
  STEPS,
  stepSummary,
  suggestTitle,
  toCreate,
  usualPriceText,
} from '../src/pages/properties/draft.ts';

const draft = (patch: Partial<PropertyDraft> = {}): PropertyDraft => ({ ...newDraft('GB'), ...patch });

describe('typed prices', () => {
  it('reads amounts the way people type them', () => {
    expect(priceToMinor('120', 'GBP')).toEqual({ minor: 12_000 });
    expect(priceToMinor('£120.50', 'GBP')).toEqual({ minor: 12_050 });
    expect(priceToMinor(' 1,200 ', 'GBP')).toEqual({ minor: 120_000 });
    expect(priceToMinor('', 'GBP')).toEqual({});
  });

  it('explains what is wrong with an amount', () => {
    expect(priceToMinor('0', 'GBP').error).toBe('Enter an amount above zero');
    expect(priceToMinor('twelve', 'GBP').error).toBe('Enter an amount such as 120 or 120.50');
    expect(priceToMinor('12.345', 'GBP').error).toBe('Enter an amount such as 120 or 120.50');
  });

  it('catches a lowest price above the highest', () => {
    expect(priceErrors(draft({ minPrice: '340', maxPrice: '120' }), 'GBP')).toEqual({
      minPrice: 'The lowest price is above the highest',
    });
    expect(priceErrors(draft({ minPrice: '120', maxPrice: '340' }), 'GBP')).toEqual({});
  });
});

describe('words for the preview and the step list', () => {
  it('describes the limits, and nothing while they are wrong', () => {
    expect(limitsText(draft({ minPrice: '120', maxPrice: '340' }), 'GBP', 'en-GB')).toBe(
      '£120 to £340 a night',
    );
    expect(limitsText(draft({ minPrice: '95.50' }), 'GBP', 'en-GB')).toBe('From £95.50 a night');
    expect(limitsText(draft({ maxPrice: '340' }), 'GBP', 'en-GB')).toBe('Up to £340 a night');
    expect(limitsText(draft(), 'GBP', 'en-GB')).toBeNull();
    expect(limitsText(draft({ minPrice: '340', maxPrice: '120' }), 'GBP', 'en-GB')).toBeNull();
    expect(limitsText(draft({ minPrice: 'abc', maxPrice: '340' }), 'GBP', 'en-GB')).toBeNull();
  });

  it('counts rooms in plain English', () => {
    expect(roomsText(draft({ maxGuests: 6, bedrooms: 3, beds: 4, bathrooms: 1.5 }))).toBe(
      '6 guests, 3 bedrooms, 4 beds and 1.5 bathrooms',
    );
    expect(roomsText(draft({ maxGuests: 1, bedrooms: 0, beds: 1, bathrooms: 1 }))).toBe(
      '1 guest, 0 bedrooms, 1 bed and 1 bathroom',
    );
  });

  it('sums up each step once there is an answer', () => {
    expect(stepSummary('place', draft(), false, 'GBP', 'en-GB')).toBeNull();
    expect(stepSummary('place', draft({ propertyType: 'cottage' }), false, 'GBP', 'en-GB')).toBe(
      'Cottage, the whole place',
    );
    expect(
      stepSummary('name', draft({ name: 'Harbour View Lodge', city: 'Whitby' }), true, 'GBP', 'en-GB'),
    ).toBe('Harbour View Lodge, Whitby');
    expect(stepSummary('rooms', draft(), false, 'GBP', 'en-GB')).toBeNull();
    expect(stepSummary('pricing', draft({ minPrice: '120', maxPrice: '340' }), true, 'GBP', 'en-GB')).toBe(
      `Set in ${V01}, £120 to £340`,
    );
    expect(stepSummary('pricing', draft({ priceOwner: 'pricelabs' }), true, 'GBP', 'en-GB')).toBe(
      'PriceLabs',
    );
  });
});

describe('the finished draft', () => {
  it('only counts as started once something changes', () => {
    expect(isDirty(newDraft('GB'))).toBe(false);
    expect(isDirty(draft({ maxGuests: 3 }))).toBe(true);
  });

  it('becomes a request the API accepts, leaving out what was not given', () => {
    const input = toCreate(
      draft({
        propertyType: 'cottage',
        name: '  Harbour View Lodge ',
        internalCode: 'HVL',
        city: 'Whitby',
        area: ' ',
        maxGuests: 6,
        bedrooms: 3,
        beds: 4,
        bathrooms: 1.5,
        minPrice: '£120',
        maxPrice: '340',
      }),
      'GBP',
    );
    expect(input).toEqual({
      name: 'Harbour View Lodge',
      countryCode: 'GB',
      propertyType: 'cottage',
      spaceType: 'entire_place',
      internalCode: 'HVL',
      city: 'Whitby',
      maxGuests: 6,
      bedrooms: 3,
      beds: 4,
      bathrooms: 1.5,
      checkInTime: '15:00',
      checkOutTime: '10:00',
      priceOwner: 'v01',
      minPriceMinor: 12_000,
      maxPriceMinor: 34_000,
    });
    expect(PropertyCreateSchema.safeParse(input).success).toBe(true);
  });

  it('needs nothing but a name', () => {
    expect(PropertyCreateSchema.safeParse(toCreate(draft({ name: 'The Granary' }), 'GBP')).success).toBe(
      true,
    );
  });
});

describe('making it stand out', () => {
  it('puts every step in exactly one of the three stages, in order', () => {
    expect(STAGES.flatMap((stage) => stage.steps)).toEqual(STEPS.map((step) => step.id));
    expect(STAGES.map((stage) => stage.title)).toEqual(['About the place', 'Make it stand out', 'Finish up']);
  });

  it('names amenities as guests read them, standout features first', () => {
    expect(amenitiesText([])).toBeNull();
    expect(amenitiesText(['wifi'])).toBe('Wi-Fi');
    expect(amenitiesText(['wifi', 'hot_tub'])).toBe('Hot tub and Wi-Fi');
    expect(amenitiesText(['wifi', 'hot_tub', 'smoke_alarm'], 3)).toBe('Hot tub, Wi-Fi and Smoke alarm');
    expect(amenitiesText(['wifi', 'kitchen', 'sea_view', 'garden'])).toBe('Sea view, Garden and 2 more');
  });

  it('suggests a title from the answers, within the limit', () => {
    const cottage = draft({
      propertyType: 'cottage',
      bedrooms: 3,
      area: 'Port Seton',
      amenities: ['wifi', 'hot_tub'],
    });
    expect(suggestTitle(cottage, 50)).toBe('3-bedroom cottage in Port Seton with a hot tub');
    // Too long for the limit: the feature goes first, then the place.
    expect(suggestTitle(cottage, 32)).toBe('3-bedroom cottage in Port Seton');
    expect(suggestTitle(cottage, 20)).toBe('3-bedroom cottage');
    expect(suggestTitle(draft({ propertyType: 'studio', city: 'Leith' }), 50)).toBe('Studio in Leith');
    // Nothing to go on yet, or a kind of place that doesn't read as a title.
    expect(suggestTitle(draft(), 50)).toBeNull();
    expect(suggestTitle(draft({ propertyType: 'other', city: 'Leith' }), 50)).toBeNull();
  });

  it('describes the usual price and cleaning fee', () => {
    expect(usualPriceText(draft(), 'GBP', 'en-GB')).toBeNull();
    expect(usualPriceText(draft({ basePrice: '165', cleaningFee: '60' }), 'GBP', 'en-GB')).toBe(
      '£165 a night, £60 cleaning',
    );
  });

  it('sums up the new steps in the step list', () => {
    expect(stepSummary('amenities', draft({ amenities: ['hot_tub'] }), true, 'GBP', 'en-GB')).toBe('Hot tub');
    expect(stepSummary('amenities', draft(), true, 'GBP', 'en-GB')).toBe('None picked yet');
    expect(stepSummary('photos', draft(), true, 'GBP', 'en-GB', 6)).toBe('6 photos');
    expect(stepSummary('photos', draft(), false, 'GBP', 'en-GB', 0)).toBeNull();
    expect(stepSummary('description', draft({ title: 'Harbour cottage' }), true, 'GBP', 'en-GB')).toBe(
      'Harbour cottage',
    );
    expect(stepSummary('pricing', draft({ basePrice: '165' }), true, 'GBP', 'en-GB')).toBe(
      `Set in ${V01}, £165 a night`,
    );
  });

  it('sends the title, description, amenities and prices with the new property', () => {
    const input = toCreate(
      draft({
        name: '3 Carnoustie Drive',
        title: ' 3-bedroom cottage with a hot tub ',
        summary: 'Two streets from the harbour.',
        amenities: ['hot_tub', 'wifi'],
        basePrice: '165',
        cleaningFee: '£60',
      }),
      'GBP',
    );
    expect(input).toMatchObject({
      title: '3-bedroom cottage with a hot tub',
      summary: 'Two streets from the harbour.',
      amenities: ['hot_tub', 'wifi'],
      basePriceMinor: 16_500,
      cleaningFeeMinor: 6_000,
    });
    expect(PropertyCreateSchema.safeParse(input).success).toBe(true);
  });
});
