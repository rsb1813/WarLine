// defs 모듈 입구: 게임 전체가 균형을 맞추는 정적 데이터와 수치 계산.
export { WEAPONS, PRIMARY_IDS, SECONDARY_IDS, CAT_NAMES, CAT_ORDER } from './weapons';
export { ATTACHMENTS, SLOT_NAMES, ATTACHMENT_IDS_BY_SLOT } from './attachments';
export {
  computeStats, defaultAttachments, normalizeAttachments, resolveAttachment, slotOptions, statBars, SIGNATURE_BONUS,
} from './stats';
export { GADGETS, GADGET_IDS, THROWABLE_IDS, gadgetVariant } from './gadgets';
export { CLASSES, CLASS_IDS, CLASS_TRAITS } from './classes';
export { VEHICLES, VWEAPONS, VEHICLE_TYPES } from './vehicles';
export { MAPS, SIZES, DIFFS, SIZE_IDS, DIFF_IDS } from './maps';
export { FACTIONS, NAMES, SQUAD_NAMES, LORE } from './misc';
