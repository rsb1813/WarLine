// 메뉴용 작은 선 아이콘 (직접 그린 24×24 SVG)
const s = (body: string, fill = false) =>
  `<svg class="wm-ic" viewBox="0 0 24 24" aria-hidden="true" ${fill ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;

export const IC = {
  deploy: s('<path d="M5 5l7 7-7 7"/><path d="M12 5l7 7-7 7"/>'),
  setup: s('<path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>'),
  loadout: s('<path d="M1.5 10.2h4v-.8h9.4v.9h7.6v1.3h-7.6v1.4h-2.6l-.7 4.2H9.7l.4-4.2H8.3l-.9 2.8H5.7l.7-2.8h-1L2.7 15H1.5z"/><path d="M8.2 7.6h4.4v1.4H8.2z"/>', true),
  settings: s('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
  help: s('<rect x="2.5" y="6" width="19" height="12" rx="1.5"/><path d="M6 10h1.2M9.4 10h1.2M12.8 10h1.2M16.2 10h1.6M6.5 14h11"/>'),
  back: s('<path d="M15 5l-7 7 7 7"/>'),
  close: s('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: s('<path d="M4.5 12.5l4.5 4.5L19.5 6.5"/>'),
  reset: s('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>'),
  swap: s('<path d="M4 8.5h15l-3.5-3.5M20 15.5H5l3.5 3.5"/>'),
  rotate: s('<ellipse cx="12" cy="13" rx="9" ry="4"/><path d="M15.5 6.8l3 2.3-3.4 1.3"/>'),
  arrow: s('<path d="M4 12h15M13.5 6l6 6-6 6"/>'),
  chevron: s('<path d="M9 5l7 7-7 7"/>'),
  // 칸
  rifle: s('<path d="M1.5 10.2h4v-.8h9.4v.9h7.6v1.3h-7.6v1.4h-2.6l-.7 4.2H9.7l.4-4.2H8.3l-.9 2.8H5.7l.7-2.8h-1L2.7 15H1.5z"/><path d="M8.2 7.6h4.4v1.4H8.2z"/>', true),
  pistol: s('<path d="M3.5 7h16v3.2h-2.2V11H11l-.8 1.1.7 5.4H6.8L6 12.2 3.5 10.3z"/>', true),
  gadget: s('<rect x="3.5" y="9" width="17" height="10" rx="1"/><path d="M8 9V5.5h3.5M14 12.5h3.5M14 15.5h3.5"/><circle cx="8.5" cy="14" r="1.6"/>'),
  grenade: s('<circle cx="11" cy="14.5" r="6"/><path d="M8.8 8.7V6.2h4.6v2.5M13.4 6.2l4.6-2.4M11 11.5v6M8 14.5h6"/>'),
  // 부착물 슬롯
  optic: s('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="1.2"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>'),
  muzzle: s('<rect x="2.5" y="8.5" width="13" height="7" rx="1"/><path d="M15.5 10.5h6v3h-6M6.5 8.5v7M10.5 8.5v7"/>'),
  barrel: s('<path d="M2.5 10h14v4h-14z"/><path d="M16.5 11h5v2h-5M6 10v4M10 10v4"/>'),
  underbarrel: s('<path d="M2.5 7h19v3.5h-19z"/><path d="M9 10.5l-1.2 9.5h4.6l1.1-9.5"/>'),
  magazine: s('<path d="M8.5 3h7l.3 5.5-2.3 12H7.2l1.6-12z"/><path d="M8.6 8.5h7.1"/>'),
  ammo: s('<path d="M9.5 21V10.5C9.5 7 10.6 4.5 12 3c1.4 1.5 2.5 4 2.5 7.5V21z"/><path d="M9.5 17h5"/>'),
  stock: s('<path d="M21.5 8.5H10L2.5 10.8v5.4l3.4 1.3 4.6-3.4h11z"/>'),
  // 병과
  assault: s('<path d="M12 3l8 6v4l-8-5.4L4 13V9z"/><path d="M12 11.5l8 6v3.5l-8-5.4L4 21v-3.5z"/>'),
  engineer: s('<path d="M14.6 3.3a5 5 0 0 0-5.7 6.5L3 15.7 8.3 21l5.9-5.9a5 5 0 0 0 6.5-5.7l-3 3-3.4-.6-.7-3.5z"/>'),
  support: s('<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>'),
  recon: s('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.4"/><path d="M12 1.8v4.4M12 17.8v4.4M1.8 12h4.4M17.8 12h4.4"/>'),
  // 기타
  skull: s('<path d="M12 3.5c-4.4 0-7.5 3-7.5 7 0 2.4 1.1 4 2.6 5v3.5h9.8V15.5c1.5-1 2.6-2.6 2.6-5 0-4-3.1-7-7.5-7z"/><circle cx="9" cy="11.5" r="1.6"/><circle cx="15" cy="11.5" r="1.6"/><path d="M10.5 19v-2.5M13.5 19v-2.5"/>'),
  flag: s('<path d="M5 21V3.5"/><path d="M5 4h12.5l-2.5 4 2.5 4H5"/>'),
  target: s('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>'),
  heart: s('<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/><path d="M8 12h2.2l1.2-2 1.6 4 1.1-2H16"/>'),
  stack: s('<path d="M12 3l9 4.5-9 4.5-9-4.5z"/><path d="M3 12l9 4.5 9-4.5M3 16.5L12 21l9-4.5"/>'),
  clock: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>'),
  users: s('<circle cx="9" cy="8.5" r="3.2"/><path d="M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.4c2 .8 3.5 2.9 3.5 5.6"/>'),
  head: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/>'),
  sun: s('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>'),
  sound: s('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  touch: s('<path d="M9 11V5a1.6 1.6 0 0 1 3.2 0v5.5"/><path d="M12.2 10V8.8a1.6 1.6 0 0 1 3.2 0V11M15.4 10.2a1.6 1.6 0 0 1 3.2 0v4.3c0 3.6-2.4 6-5.8 6h-.7c-2.3 0-3.6-1-4.8-2.6L4.7 14.4a1.6 1.6 0 0 1 2.5-2L9 14"/>'),
  mouse: s('<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v6.5M6 9.5h12"/>'),
  info: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.2"/>'),
  bolt: s('<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>'),
};

export type IconName = keyof typeof IC;

export const CLASS_IC: Record<string, string> = { assault: IC.assault, engineer: IC.engineer, support: IC.support, recon: IC.recon };
export const SLOT_IC: Record<string, string> = {
  optic: IC.optic, muzzle: IC.muzzle, barrel: IC.barrel, underbarrel: IC.underbarrel, magazine: IC.magazine, ammo: IC.ammo, stock: IC.stock,
};
