// ─────────────────────────────────────────────────────────────────────────────
//  COASTER CARNAGE — central tuning + definitions
// ─────────────────────────────────────────────────────────────────────────────

export const DT = 1 / 60; // fixed simulation step
export const GRAVITY = 9.81;

// ── Map layout ───────────────────────────────────────────────────────────────
// Each team owns a territory grid of GRID_W × TERR_ROWS tiles. Row 0 is the
// row nearest the midline. Rows [0, DEPLOY_ROWS) are the deployment yard,
// rows [DEPLOY_ROWS, TERR_ROWS) are the park. Team 0 lives at +z, team 1 at -z
// (rotated 180°), so both teams share the same "local" coordinates.
export const TILE = 2;
export const GRID_W = 48;
export const DEPLOY_ROWS = 12;
export const PARK_ROWS = 30;
export const TERR_ROWS = DEPLOY_ROWS + PARK_ROWS;
export const MID = 14; // half-depth of no-man's land (m)
export const HALF_W = (GRID_W * TILE) / 2; // 48
export const PARK_LZ0 = MID + DEPLOY_ROWS * TILE; // 38
export const PARK_LZ1 = MID + TERR_ROWS * TILE; // 98
export const WATER_LEVEL = -1.4;

export const TEAM_COLORS = [
  { main: 0x2f7cf6, light: 0x7fb3ff, dark: 0x1b4fa8, css: '#2f7cf6', name: 'Blue' },
  { main: 0xf0413d, light: 0xff8d7a, dark: 0xa3221f, css: '#f0413d', name: 'Red' },
];

export const START_MONEY = 4200;
export const CASTLE_HP = 9000;
export const MAX_ROUNDS = 14;
export const SUPPLY_CAP = 48;
export const PREP_TIME = 50; // seconds of game time
export const BATTLE_TIME = 95;
export const RAMPAGE_TIME = 22; // time survivors may rampage after wiping the enemy army
export const ENTRY_FEE = 18;
export const MAX_GUESTS = 64;

// Castle's own defence (fireworks battery)
export const CASTLE_DEFENSE = { range: 34, damage: 38, splash: 2.6, cooldown: 1.15, knock: 7 };
export const INSURANCE = 0.4; // share of lost unit value refunded after each battle
export const SURVIVOR_HEAL = 0.4;

// ── Units ────────────────────────────────────────────────────────────────────
// role drives battle AI; attack.kind: melee | ranged | lob | ram | stomp
export const UNIT_TYPES = {
  janitor: {
    name: 'Janitor', icon: '🧹', cost: 60, supply: 1, hp: 100, speed: 3.4, scale: 1.0,
    role: 'melee',
    attack: { kind: 'melee', anim: 'swing', reach: 1.7, damage: 15, cooldown: 1.0, knock: 3.5, structMult: 0.7 },
    weapon: 'mop', look: { shirt: 'team', pants: 0x4d5566, hat: 'cap', skin: 'any' },
    desc: 'Cheap, cheerful, disposable. Swarms anything that stands still.',
  },
  popper: {
    name: 'Dart Popper', icon: '🎯', cost: 120, supply: 1, hp: 72, speed: 3.1, scale: 0.95,
    role: 'ranged',
    attack: { kind: 'ranged', anim: 'throw', range: 23, damage: 15, cooldown: 1.25, projSpeed: 30, proj: 'dart', knock: 1.5, structMult: 0.35, spread: 0.02 },
    weapon: 'none', look: { shirt: 'team', pants: 0xe9d9b0, hat: 'visor', skin: 'any' },
    desc: 'Carnival sharpshooter. Kites melee, shreds slow tanks. Fragile.',
  },
  clown: {
    name: 'Pie Clown', icon: '🤡', cost: 140, supply: 1, hp: 115, speed: 4.6, scale: 0.95,
    role: 'skirmisher',
    attack: { kind: 'ranged', anim: 'throw', range: 10, damage: 12, cooldown: 1.9, projSpeed: 16, proj: 'pie', stun: 1.5, knock: 2.5, structMult: 0.3 },
    weapon: 'none', look: { shirt: 'team', pants: 'team2', hat: 'clownhair', face: 0xffffff, nose: true, skin: 'pale' },
    desc: 'Fast pie-flinger. Stuns targets and dives backlines.',
  },
  mascot: {
    name: 'Mascot Bruiser', icon: '🐻', cost: 230, supply: 2, hp: 440, speed: 2.7, scale: 1.3,
    role: 'tank',
    attack: { kind: 'melee', anim: 'punch', reach: 1.5, damage: 24, cooldown: 0.85, knock: 6, structMult: 0.8 },
    weapon: 'none', look: { shirt: 'fur', pants: 'fur', hat: 'bearhead', fur: 0x8a5a33, bib: 'team', skin: 'fur' },
    desc: 'Big fuzzy wall. Soaks damage so your backline can work.',
  },
  ringmaster: {
    name: 'Ringmaster', icon: '🎩', cost: 280, supply: 1, hp: 160, speed: 3.0, scale: 1.0,
    role: 'support',
    attack: { kind: 'melee', anim: 'whip', reach: 3.2, damage: 11, cooldown: 0.9, knock: 2, structMult: 0.4 },
    aura: { radius: 10, damage: 1.3, speed: 1.2, regen: 4 },
    weapon: 'whip', look: { shirt: 'team', coat: true, pants: 0xf5f0e6, hat: 'tophat', skin: 'any' },
    desc: 'Rallies nearby allies: +30% damage, +20% speed, slow regen.',
  },
  bumper: {
    name: 'Bumper Car', icon: '🚗', cost: 300, supply: 2, hp: 300, speed: 10.5, scale: 1.0,
    role: 'cavalry', vehicle: true,
    attack: { kind: 'ram', damage: 42, knock: 13, structMult: 0.8, cooldown: 0.6 },
    weapon: 'none', look: { shirt: 'team', pants: 0x333333, hat: 'helmet', skin: 'any' },
    desc: 'Rams through lines and hunts ranged units. Loves a flank.',
  },
  cannonball: {
    name: 'Human Cannonball', icon: '💥', cost: 240, supply: 1, hp: 120, speed: 3.3, scale: 1.0,
    role: 'assassin',
    launch: { range: 72, damage: 75, splash: 3.4, knock: 12 },
    attack: { kind: 'melee', anim: 'punch', reach: 1.3, damage: 13, cooldown: 0.9, knock: 3, structMult: 0.5 },
    weapon: 'none', look: { shirt: 0xe8e8f0, cape: 'team', pants: 'team', hat: 'cannonhelm', skin: 'any' },
    desc: 'Fired over the lines at battle start. Crashes into artillery.',
  },
  strongman: {
    name: 'Strongman', icon: '🔨', cost: 420, supply: 2, hp: 470, speed: 2.4, scale: 1.15,
    role: 'heavy',
    attack: { kind: 'melee', anim: 'slam', reach: 2.3, damage: 78, cooldown: 2.3, knock: 13, splash: 1.9, structMult: 1.6 },
    weapon: 'mallet', look: { shirt: 'stripes', pants: 0x222222, hat: 'mustache', skin: 'tan' },
    desc: 'High-striker mallet. Splash damage flattens crowds and walls.',
  },
  cannoneer: {
    name: 'Popcorn Cannoneer', icon: '🍿', cost: 360, supply: 2, hp: 95, speed: 2.3, scale: 1.0,
    role: 'artillery',
    attack: { kind: 'lob', anim: 'aim', range: 44, minRange: 7, damage: 52, splash: 3.6, cooldown: 4.2, projSpeed: 24, proj: 'popcorn', knock: 9, structMult: 1.0 },
    weapon: 'popgun', look: { shirt: 'team', pants: 0x7a4a2a, hat: 'chef', skin: 'any' },
    desc: 'Lobs exploding popcorn tubs. Devastating vs clumps. Needs protecting.',
  },
  giant: {
    name: 'Inflatable Giant', icon: '🎈', cost: 1500, supply: 6, hp: 3000, speed: 1.9, scale: 2.7,
    role: 'boss',
    attack: { kind: 'melee', anim: 'stomp', reach: 3.4, damage: 60, cooldown: 2.0, knock: 15, splash: 4.2, structMult: 2.2 },
    weapon: 'none', look: { shirt: 'team', pants: 'team', hat: 'none', skin: 'balloon' },
    desc: 'A colossal parade balloon with a grudge. Stomps everything.',
  },
};
export const UNIT_ORDER = ['janitor', 'popper', 'clown', 'mascot', 'ringmaster', 'bumper', 'cannonball', 'strongman', 'cannoneer', 'giant'];

// Rough counter matrix used by the AI planner: EFF[a][b] = how well a trades vs b (1 = even).
export const EFF = {
  janitor:    { janitor: 1, popper: 1.4, clown: 1.0, mascot: 0.6, ringmaster: 1.2, bumper: 1.1, cannonball: 1.1, strongman: 0.45, cannoneer: 1.5, giant: 0.5 },
  popper:     { janitor: 1.1, popper: 1, clown: 0.6, mascot: 1.5, ringmaster: 1.3, bumper: 0.55, cannonball: 1.0, strongman: 1.6, cannoneer: 1.2, giant: 1.7 },
  clown:      { janitor: 0.9, popper: 1.7, clown: 1, mascot: 0.6, ringmaster: 1.3, bumper: 0.8, cannonball: 1.1, strongman: 1.2, cannoneer: 1.7, giant: 0.8 },
  mascot:     { janitor: 1.5, popper: 0.8, clown: 1.5, mascot: 1, ringmaster: 1.2, bumper: 1.5, cannonball: 1.3, strongman: 0.7, cannoneer: 0.9, giant: 0.7 },
  ringmaster: { janitor: 1.0, popper: 0.8, clown: 0.9, mascot: 0.9, ringmaster: 1, bumper: 0.9, cannonball: 1, strongman: 0.9, cannoneer: 1, giant: 1 },
  bumper:     { janitor: 1.0, popper: 1.8, clown: 1.2, mascot: 0.6, ringmaster: 1.4, bumper: 1, cannonball: 1.2, strongman: 0.6, cannoneer: 1.9, giant: 0.6 },
  cannonball: { janitor: 0.8, popper: 1.3, clown: 0.9, mascot: 0.7, ringmaster: 1.2, bumper: 0.8, cannonball: 1, strongman: 0.8, cannoneer: 2.0, giant: 0.6 },
  strongman:  { janitor: 1.8, popper: 0.7, clown: 0.8, mascot: 1.5, ringmaster: 1.1, bumper: 1.6, cannonball: 1.1, strongman: 1, cannoneer: 1.0, giant: 1.2 },
  cannoneer:  { janitor: 1.9, popper: 1.4, clown: 0.7, mascot: 1.0, ringmaster: 1.2, bumper: 0.5, cannonball: 0.6, strongman: 1.1, cannoneer: 1, giant: 1.0 },
  giant:      { janitor: 1.8, popper: 0.7, clown: 1.3, mascot: 1.3, ringmaster: 1.2, bumper: 1.5, cannonball: 1.2, strongman: 0.9, cannoneer: 1.1, giant: 1 },
};

// ── Buildings ────────────────────────────────────────────────────────────────
// Footprint w×d in tiles (for rotation 0). E/I/N = excitement/intensity/nausea.
export const BUILDINGS = {
  // Rides
  carousel: {
    name: 'Carousel', icon: '🎠', cat: 'rides', cost: 520, w: 5, d: 5, hp: 900, height: 7, upkeep: 5,
    ride: { E: 3.1, I: 1.2, N: 0.9, cap: 12, cycle: 12, price: 7 },
    desc: 'A gentle classic. Cheap, reliable income.',
  },
  teacups: {
    name: 'Spinning Teacups', icon: '☕', cat: 'rides', cost: 640, w: 5, d: 5, hp: 850, height: 4, upkeep: 6,
    ride: { E: 4.0, I: 3.6, N: 5.0, cap: 12, cycle: 12, price: 8 },
    desc: 'Dizzying fun. Great capacity for the price.',
  },
  pirate: {
    name: 'Pirate Ship', icon: '🏴‍☠️', cat: 'rides', cost: 950, w: 4, d: 8, hp: 1200, height: 10, upkeep: 8,
    ride: { E: 5.5, I: 5.8, N: 4.4, cap: 16, cycle: 16, price: 10 },
    combat: { type: 'swing', damage: 55, knock: 16 },
    desc: 'Swinging galleon. The hull smacks invaders standing under it.',
  },
  ferris: {
    name: 'Ferris Wheel', icon: '🎡', cat: 'rides', cost: 1200, w: 7, d: 4, hp: 1600, height: 18, upkeep: 9,
    ride: { E: 4.8, I: 1.8, N: 1.0, cap: 16, cycle: 20, price: 9 },
    rating: 6,
    desc: 'Towering landmark. Huge capacity and a big park-rating boost.',
  },
  droptower: {
    name: 'Drop Tower', icon: '🗼', cat: 'rides', cost: 1250, w: 3, d: 3, hp: 1100, height: 26, upkeep: 9,
    ride: { E: 6.6, I: 8.2, N: 3.0, cap: 8, cycle: 12, price: 13 },
    combat: { type: 'shockwave', radius: 11, damage: 42, knock: 14 },
    desc: 'Terrifying plunge. Each drop sends a shockwave through nearby invaders.',
  },
  cannonshow: {
    name: 'Human Cannon Show', icon: '🎆', cat: 'rides', cost: 1150, w: 3, d: 5, hp: 1000, height: 6, upkeep: 8,
    ride: { E: 6.2, I: 7.0, N: 2.6, cap: 1, cycle: 4, price: 18 },
    combat: { type: 'cannon', range: 80, damage: 60, splash: 3.6, cooldown: 4.5, knock: 12 },
    desc: 'Guests pay to be fired from a cannon. In battle... at the enemy.',
  },
  // Shops
  burger: {
    name: 'Burger Stall', icon: '🍔', cat: 'shops', cost: 220, w: 2, d: 2, hp: 400, height: 4, upkeep: 2,
    shop: { need: 'hunger', price: 8 },
    desc: 'Feeds hungry guests.',
  },
  soda: {
    name: 'Soda Stand', icon: '🥤', cat: 'shops', cost: 180, w: 2, d: 2, hp: 400, height: 4, upkeep: 2,
    shop: { need: 'thirst', price: 5 },
    desc: 'Quenches thirsty guests.',
  },
  balloons: {
    name: 'Balloon Cart', icon: '🎈', cat: 'shops', cost: 200, w: 2, d: 2, hp: 350, height: 4, upkeep: 2,
    shop: { need: 'fun', price: 7 },
    desc: 'Happy guests buy balloons. Boosts guest happiness.',
  },
  // Defense attractions
  turret: {
    name: 'Popcorn Cannon', icon: '🍿', cat: 'defense', cost: 600, w: 2, d: 2, hp: 800, height: 5, upkeep: 4,
    shop: { need: 'hunger', price: 5 },
    combat: { type: 'turret', range: 27, damage: 30, splash: 2.6, cooldown: 1.9, knock: 7 },
    desc: 'Sells popcorn by day. Lobs explosive tubs at invaders by war.',
  },
  fountain: {
    name: 'Splash Fountain', icon: '⛲', cat: 'defense', cost: 480, w: 3, d: 3, hp: 900, height: 3, upkeep: 3,
    scenery: 4,
    combat: { type: 'jets', range: 14, damage: 9, knock: 15, cooldown: 1.1 },
    desc: 'Pretty scenery. High-pressure jets hose attackers away.',
  },
  // Scenery
  tree: { name: 'Tree', icon: '🌳', cat: 'scenery', cost: 25, w: 1, d: 1, hp: 60, height: 5, scenery: 1.2, desc: 'Leafy shade. Guests love trees.' },
  pine: { name: 'Pine', icon: '🌲', cat: 'scenery', cost: 25, w: 1, d: 1, hp: 60, height: 6, scenery: 1.1, desc: 'Tall and proud.' },
  palm: { name: 'Palm', icon: '🌴', cat: 'scenery', cost: 35, w: 1, d: 1, hp: 60, height: 6, scenery: 1.4, desc: 'Tropical vibes.' },
  flowers: { name: 'Flower Bed', icon: '🌷', cat: 'scenery', cost: 15, w: 1, d: 1, hp: 30, height: 0.5, scenery: 0.9, desc: 'A splash of colour.' },
  lamp: { name: 'Lamp Post', icon: '💡', cat: 'scenery', cost: 30, w: 1, d: 1, hp: 60, height: 4, scenery: 0.6, desc: 'Lights up the night.' },
  statue: { name: 'Mascot Statue', icon: '🗿', cat: 'scenery', cost: 160, w: 2, d: 2, hp: 400, height: 5, scenery: 3.2, desc: 'A golden monument to yourself.' },
  // Special (not in build menu)
  castle: { name: 'Grand Castle', icon: '🏰', cat: 'special', cost: 0, w: 6, d: 6, hp: CASTLE_HP, height: 22, scenery: 3 },
  gate: { name: 'Park Gate', icon: '🎪', cat: 'special', cost: 0, w: 4, d: 2, hp: 99999, height: 9 },
  station: { name: 'Coaster Station', icon: '🎢', cat: 'special', cost: 0, w: 2, d: 9, hp: 1500, height: 5 },
};
export const BUILD_MENU = {
  rides: ['carousel', 'teacups', 'pirate', 'ferris', 'droptower', 'cannonshow'],
  shops: ['burger', 'soda', 'balloons'],
  defense: ['turret', 'fountain'],
  scenery: ['tree', 'pine', 'palm', 'flowers', 'lamp', 'statue'],
};
export const PATH_COST = 10;

// ── Coaster ──────────────────────────────────────────────────────────────────
export const COASTER = {
  stationCost: 800,
  costPerMeter: 9,
  supportCost: 15,
  hp: 2200,
  cars: 4,
  seatsPerCar: 4,
  carLength: 2.6,
  maxHeight: 34,
  combat: { damageScale: 1.2, maxDamage: 260, radius: 1.7, knock: 1.0 },
};
