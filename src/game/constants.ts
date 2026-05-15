// 游戏常量与关卡配置（潜行 FPS）

export type Difficulty = 'easy' | 'normal' | 'hard' | 'nightmare' | 'hell';

export type GameState = 'MENU' | 'TUTORIAL' | 'PLAYING' | 'PAUSED' | 'WIN' | 'LOSE';

// 妈妈状态机
export type MomState = 'PATROL' | 'INVESTIGATE' | 'ALERT' | 'CHASE' | 'CAUGHT';

// 收集物类型
export type ItemType = 'manga' | 'snack' | 'cola' | 'charger' | 'headphone' | 'cartridge' | 'battery' | 'controller';

// 玩家姿态
export type Stance = 'STAND' | 'CROUCH';

export interface ItemInfo { name: string; emoji: string; color: number; }
export const ITEM_INFO: Record<ItemType, ItemInfo> = {
  manga:      { name: '漫画书',   emoji: '📚', color: 0xff6b6b },
  snack:      { name: '薯片',     emoji: '🍟', color: 0xfbbf24 },
  cola:       { name: '可乐',     emoji: '🥤', color: 0x60a5fa },
  charger:    { name: '充电器',   emoji: '🔌', color: 0xa78bfa },
  headphone:  { name: '耳机',     emoji: '🎧', color: 0x4ade80 },
  cartridge:  { name: '游戏卡带', emoji: '💾', color: 0xec4899 },
  battery:    { name: '电池',     emoji: '🔋', color: 0x10b981 },
  controller: { name: '游戏手柄', emoji: '🎮', color: 0xf472b6 },
};

export interface LevelConfig {
  level: number;
  itemsToCollect: number;     // 需收集物品数
  totalItemsInMap: number;    // 地图上散落物品总数
  momSpeed: number;           // 巡逻速度 m/s
  momChaseSpeed: number;      // 追逐速度 m/s
  momViewDist: number;        // 视野距离（米）
  momViewAngleDeg: number;    // 视野半角（度）
  timeLimit: number;          // 时限（秒）
  momCount: number;           // 妈妈数量（一般 1，高难 2）
}

export const LEVELS: LevelConfig[] = [
  { level: 1,  itemsToCollect: 3, totalItemsInMap: 5,  momSpeed: 1.4, momChaseSpeed: 3.6, momViewDist: 7,  momViewAngleDeg: 45, timeLimit: 240, momCount: 1 },
  { level: 2,  itemsToCollect: 4, totalItemsInMap: 6,  momSpeed: 1.5, momChaseSpeed: 3.8, momViewDist: 8,  momViewAngleDeg: 50, timeLimit: 240, momCount: 1 },
  { level: 3,  itemsToCollect: 5, totalItemsInMap: 7,  momSpeed: 1.6, momChaseSpeed: 4.0, momViewDist: 9,  momViewAngleDeg: 55, timeLimit: 240, momCount: 1 },
  { level: 4,  itemsToCollect: 5, totalItemsInMap: 7,  momSpeed: 1.7, momChaseSpeed: 4.2, momViewDist: 10, momViewAngleDeg: 55, timeLimit: 220, momCount: 1 },
  { level: 5,  itemsToCollect: 6, totalItemsInMap: 8,  momSpeed: 1.8, momChaseSpeed: 4.4, momViewDist: 11, momViewAngleDeg: 60, timeLimit: 220, momCount: 1 },
  { level: 6,  itemsToCollect: 6, totalItemsInMap: 9,  momSpeed: 1.8, momChaseSpeed: 4.6, momViewDist: 11, momViewAngleDeg: 60, timeLimit: 210, momCount: 2 },
  { level: 7,  itemsToCollect: 7, totalItemsInMap: 9,  momSpeed: 2.0, momChaseSpeed: 4.8, momViewDist: 12, momViewAngleDeg: 65, timeLimit: 210, momCount: 2 },
  { level: 8,  itemsToCollect: 7, totalItemsInMap: 10, momSpeed: 2.1, momChaseSpeed: 5.0, momViewDist: 13, momViewAngleDeg: 65, timeLimit: 200, momCount: 2 },
  { level: 9,  itemsToCollect: 8, totalItemsInMap: 10, momSpeed: 2.2, momChaseSpeed: 5.4, momViewDist: 14, momViewAngleDeg: 70, timeLimit: 200, momCount: 2 },
  { level: 10, itemsToCollect: 8, totalItemsInMap: 10, momSpeed: 2.4, momChaseSpeed: 5.8, momViewDist: 15, momViewAngleDeg: 75, timeLimit: 180, momCount: 2 },
];

export const DIFFICULTY_MULTIPLIERS: Record<Difficulty, {
  momSpeed: number; momView: number; timeLimit: number; suspicionRate: number;
}> = {
  easy:      { momSpeed: 0.7, momView: 0.7, timeLimit: 1.5, suspicionRate: 0.6 },
  normal:    { momSpeed: 0.85, momView: 0.85, timeLimit: 1.2, suspicionRate: 0.85 },
  hard:      { momSpeed: 1.0, momView: 1.0, timeLimit: 1.0, suspicionRate: 1.0 },
  nightmare: { momSpeed: 1.2, momView: 1.15, timeLimit: 0.85, suspicionRate: 1.3 },
  hell:      { momSpeed: 1.4, momView: 1.3, timeLimit: 0.7, suspicionRate: 1.7 },
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '简单', normal: '普通', hard: '困难', nightmare: '噩梦', hell: '地狱'
};
export const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  easy: '#4ade80', normal: '#60a5fa', hard: '#fbbf24', nightmare: '#f97316', hell: '#ef4444'
};

// 玩家参数
export const PLAYER_HEIGHT_STAND = 1.65;
export const PLAYER_HEIGHT_CROUCH = 0.95;
export const PLAYER_RADIUS = 0.32;
export const PLAYER_WALK_SPEED = 2.6;
export const PLAYER_RUN_SPEED = 5.0;
export const PLAYER_CROUCH_SPEED = 1.4;

// 噪音半径（米）— 妈妈在此距离能听到
export const NOISE_RADIUS_RUN = 9.0;
export const NOISE_RADIUS_WALK = 4.0;
export const NOISE_RADIUS_CROUCH = 0.0;
export const NOISE_RADIUS_JUMP_LAND = 6.5;  // 跳跃落地噪音

// 跳跃物理
export const PLAYER_JUMP_SPEED = 4.5;       // 起跳初速度（m/s）
export const GRAVITY = 14.0;                // 重力加速度（m/s²）

// 妈妈侦测
export const MOM_SUSPICION_MAX = 100;     // 怀疑度上限
export const MOM_SUSPICION_DETECT = 100;  // 满则进入 CHASE
export const MOM_SUSPICION_ALERT = 60;    // 进入 ALERT 阈值

// === 隐藏机制（彩蛋）===
// 1. 流浪猫
export const CAT_MEOW_NOISE_RADIUS = 12.0; // 猫叫触发的等效噪音半径
export const CAT_BUMP_DIST = 0.7;          // 撞到猫的距离
export const CAT_PET_DIST = 1.3;           // 蹲着撸猫的距离
export const CAT_PET_BONUS = 200;          // 撸猫奖励分
export const CAT_MEOW_COOLDOWN = 6.0;      // 叫了之后多久能再叫

// 2. 吱呀地板
export const CREAKY_FLOOR_COUNT = 6;
export const CREAKY_FLOOR_RADIUS = 0.55;
export const CREAKY_FLOOR_NOISE = 5.5;     // 站立踩上去额外噪音
export const CREAKY_TRIGGER_COOLDOWN = 1.2;

// 3. 走廊挂钟
export const CLOCK_CYCLE = 50.0;           // 周期秒
export const CLOCK_CHIME_DURATION = 4.0;   // 钟声持续秒（期间妈妈"耳聋"）

// 4. 衣柜躲藏
export const HIDE_INTERACT_DIST = 1.5;     // 衣柜交互距离
export const HIDE_SUSPICION_DECAY = 35;    // 隐藏时怀疑度每秒下降

// 5. 幽灵潜行
export const GHOST_RUN_BONUS = 1500;
export const GHOST_RUN_MAX_SUSPICION = 15;

// === 难度强化 ===
// 体力系统（跑步消耗，否则只能走）
export const STAMINA_MAX = 100;
export const STAMINA_RUN_DRAIN = 22;      // /s 跑步消耗
export const STAMINA_WALK_REGEN = 10;     // /s 走路/站立回复
export const STAMINA_CROUCH_REGEN = 18;   // /s 蹲行回复最快
export const STAMINA_REUSE_MIN = 25;      // 体力耗尽后需恢复到此值才能再跑

// 拾取物品发出的噪音
export const ITEM_PICKUP_NOISE = 3.0;     // 半径内妈妈被吸引

// 妈妈：更慢的怀疑度衰减 + 调查后保留最低怀疑度
export const MOM_SUSPICION_DECAY = 4.0;   // /s（原为 8，降低让妈妈更难忘记）
export const MOM_SUSPICION_FLOOR = 18;    // 完成调查后保留的最低怀疑度
