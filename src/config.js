// Geometry, layout and palette constants for the NVL72 model.
// Units are metres. Origin sits on the floor under the rack centre;
// +x is to the right when facing the front, +y is up, +z points out of the front.

export const U = 0.04445;

export const RACK = {
  W: 0.6,
  D: 1.068,
  H: 2.236,
  baseY: 0.066, // bottom of U1
  nU: 48,
};

export const Z_FRONT = 0.5; // plane of the tray front panels
export const Z_REAR = -0.3; // rear face of the trays (blind-mate plane)
export const TRAY_W = 0.444;
export const TRAY_H = U - 0.0016;
export const PORT_Y = 0.0215; // port centre height above the tray bottom

// Rear infrastructure, x positions in world space (viewed from the front).
// Busbar on the rack centreline as in ORv3/MGX; cable cartridges in two pairs
// either side of it; liquid manifolds at the outer edges.
export const CART_X = [-0.158, -0.092, 0.092, 0.158];
export const BUSBAR_X = 0.0;
export const MANI_SUPPLY_X = -0.207; // facility supply (cold)
export const MANI_RETURN_X = 0.207; // facility return (warm)
export const CART = { W: 0.056, D: 0.15, zFace: Z_REAR - 0.03 };

// Front cable management ducts
export const DUCT_X = 0.262;

export const yOfU = (u) => RACK.baseY + (u - 1) * U;
export const uOfSlot = (slot) => 10 + slot; // slot 1 -> U11 ... slot 27 -> U37

// GPU and NVSwitch die positions inside their trays (tray-local x, z)
export const GPU_X = [-0.158, -0.056, 0.056, 0.158];
export const GPU_Z = -0.04;
export const NVSW_X = [-0.1, 0.1];
export const NVSW_Z = -0.03;

// Neighbouring network rack that hosts the scale-out / scale-in leaf switches
export const NETRACK_X = 1.12;
export const TRAY_Y_OVERHEAD = 2.47;

export const PALETTE = {
  bg: 0x0a1118,
  ink: 0x0e1a24,
  nv: 0x2e9e6b,
  nvGlow: 0x7cf2b8,
  ib: 0x4276e0,
  ibGlow: 0x9dbcff,
  eth: 0xe08a2e,
  ethGlow: 0xffc27a,
  oob: 0x7f8b98,
  oobGlow: 0xe3ebf2,
  pwr: 0xc98a4b,
  pwrGlow: 0xffd79a,
  liqS: 0x3a8fd6,
  liqSGlow: 0xa5e2ff,
  liqR: 0xd9534a,
  liqRGlow: 0xffb9ad,
  bad: 0xe5533a,
  warn: 0xf2b23e,
  ok: 0x4fd69a,
};

export const NET = {
  nv: { key: 'nv', label: 'NVLink', sub: 'Scale-up', css: '#6FD3A3' },
  ib: { key: 'ib', label: 'InfiniBand', sub: 'Scale-out', css: '#8FB0FF' },
  eth: { key: 'eth', label: '以太网', sub: 'Scale-in', css: '#F5B062' },
  oob: { key: 'oob', label: '带外管理', sub: '1GbE', css: '#C3CED8' },
  pwr: { key: 'pwr', label: '供电', sub: '约 50 V DC', css: '#E3A869' },
  liq: { key: 'liq', label: '液冷', sub: '供液 / 回液', css: '#7CC4F2' },
};

// Capacity figures (public NVIDIA reference numbers)
export const LINK_GBPS = 400; // one NVLink, one direction
export const IB_GBPS = 400; // ConnectX-7 OSFP
export const ETH_GBPS = 200; // BlueField-3 port as deployed in the SuperPOD reference (the B3240 itself can do 400)
export const OOB_GBPS = 1;
export const RACK_KW = 120;
export const SHELF_KW = 33; // 6 x 5.5 kW
