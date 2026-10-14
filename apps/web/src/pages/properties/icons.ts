import {
  IconAdjustmentsHorizontal,
  IconBuilding,
  IconBuildingCottage,
  IconBuildingSkyscraper,
  IconChartLine,
  IconDoor,
  IconDots,
  IconHome,
  IconHome2,
  IconSofa,
  IconSparkles,
  IconTrees,
  IconUsers,
  type TablerIcon,
} from '@tabler/icons-react';
import type { PriceOwner, PropertyType, SpaceType } from '@v01/shared';

export const PROPERTY_TYPE_ICONS: Record<PropertyType, TablerIcon> = {
  house: IconHome,
  flat: IconBuilding,
  cottage: IconBuildingCottage,
  cabin: IconTrees,
  studio: IconSofa,
  serviced_apartment: IconBuildingSkyscraper,
  unusual: IconSparkles,
  other: IconDots,
};

export const SPACE_TYPE_ICONS: Record<SpaceType, TablerIcon> = {
  entire_place: IconHome2,
  private_room: IconDoor,
  shared_room: IconUsers,
};

export const PRICE_OWNER_ICONS: Record<PriceOwner, TablerIcon> = {
  v01: IconAdjustmentsHorizontal,
  pricelabs: IconChartLine,
};
