import {
  IconAdjustmentsHorizontal,
  IconBarbell,
  IconBath,
  IconBeach,
  IconBuilding,
  IconBuildingCottage,
  IconBuildingSkyscraper,
  IconCampfire,
  IconChargingPile,
  IconChartLine,
  IconChess,
  IconDoor,
  IconDoorEnter,
  IconDots,
  IconFlame,
  IconGrill,
  IconHome,
  IconHome2,
  IconKey,
  IconKeyboard,
  IconLock,
  IconMountain,
  IconMovie,
  IconPlant2,
  IconPool,
  IconRipple,
  IconSailboat,
  IconSofa,
  IconSparkles,
  IconTemperature,
  IconTrees,
  IconUserCheck,
  IconUsers,
  IconWaveSine,
  type TablerIcon,
} from '@tabler/icons-react';
import type { CheckInMethod, PriceOwner, PropertyType, SpaceType } from '@v01/shared';

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

/** Standout features get a picture; the rest of the amenities are a plain list. */
export const STANDOUT_ICONS: Record<string, TablerIcon> = {
  hot_tub: IconBath,
  pool: IconPool,
  sauna: IconTemperature,
  sea_view: IconWaveSine,
  countryside_view: IconTrees,
  mountain_view: IconMountain,
  lake_view: IconRipple,
  beach_access: IconBeach,
  waterfront: IconSailboat,
  log_burner: IconFlame,
  open_fire: IconFlame,
  garden: IconPlant2,
  bbq: IconGrill,
  fire_pit: IconCampfire,
  games_room: IconChess,
  home_cinema: IconMovie,
  ev_charger: IconChargingPile,
  gym: IconBarbell,
};

export const CHECK_IN_ICONS: Record<CheckInMethod, TablerIcon> = {
  smart_lock: IconLock,
  keypad: IconKeyboard,
  lockbox: IconKey,
  host_greets: IconUserCheck,
  building_staff: IconDoorEnter,
};
