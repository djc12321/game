// GameManager: 第一人称潜行 FPS 核心逻辑
// 玩家移动+碰撞、妈妈AI（巡逻/调查/警觉/追逐）、物品收集、胜负判定
import * as THREE from 'three';
import { ThreeScene, type AABB, type ItemSpawn, type MomVisual } from './ThreeScene';
import { InputManager } from './InputManager';
import { audio } from './audio';
import {
  LEVELS, DIFFICULTY_MULTIPLIERS, ITEM_INFO,
  type Difficulty, type MomState, type ItemType, type Stance,
  PLAYER_HEIGHT_STAND, PLAYER_HEIGHT_CROUCH, PLAYER_RADIUS,
  PLAYER_WALK_SPEED, PLAYER_RUN_SPEED, PLAYER_CROUCH_SPEED,
  NOISE_RADIUS_RUN, NOISE_RADIUS_WALK, NOISE_RADIUS_CROUCH,
  MOM_SUSPICION_MAX, MOM_SUSPICION_DETECT, MOM_SUSPICION_ALERT,
  PLAYER_JUMP_SPEED, GRAVITY, NOISE_RADIUS_JUMP_LAND,
  CAT_MEOW_NOISE_RADIUS, CAT_BUMP_DIST, CAT_PET_DIST, CAT_PET_BONUS, CAT_MEOW_COOLDOWN,
  CREAKY_FLOOR_RADIUS, CREAKY_FLOOR_NOISE, CREAKY_TRIGGER_COOLDOWN,
  CLOCK_CYCLE, CLOCK_CHIME_DURATION,
  HIDE_INTERACT_DIST, HIDE_SUSPICION_DECAY,
  GHOST_RUN_BONUS, GHOST_RUN_MAX_SUSPICION,
  STAMINA_MAX, STAMINA_RUN_DRAIN, STAMINA_WALK_REGEN, STAMINA_CROUCH_REGEN, STAMINA_REUSE_MIN,
  ITEM_PICKUP_NOISE, MOM_SUSPICION_DECAY, MOM_SUSPICION_FLOOR,
} from './constants';
import { clamp } from './utils';

export interface ManagerCallbacks {
  onWin: (score: number, badges: string[]) => void;
  onLose: (reason: string) => void;
  onState: (s: ManagerState) => void;
}

export interface MomRuntime {
  vis: MomVisual;
  state: MomState;
  pos: THREE.Vector3;
  yaw: number;             // 朝向（0 = 朝向 -Z）
  yawTarget: number;
  patrolIndex: number;
  patrolWaitT: number;     // 在巡逻点停留时间
  suspicion: number;       // 0..100
  investigatePos: THREE.Vector3 | null;
  investigateT: number;
  speed: number;
  chaseSpeed: number;
  viewDist: number;
  viewHalfAngle: number;
}

export interface ManagerState {
  itemsCollected: number;
  itemsToCollect: number;
  totalItemsInMap: number;
  itemsRemainingNeeded: number;
  timeLeft: number;
  paused: boolean;
  stance: Stance;
  isRunning: boolean;
  isAirborne: boolean;
  flashlightOn: boolean;
  noiseRadius: number;
  nearbyItem: { type: ItemType; name: string; emoji: string } | null;
  inBedZone: boolean;
  canFinish: boolean;
  maxAlarm: 0 | 1 | 2;     // 全局最高警戒
  maxSuspicion: number;    // 全局最高怀疑度
  detected: boolean;       // 是否有妈妈在追
  pointerLocked: boolean;
  currentRoomName: string;
  score: number;
  // 小地图数据
  mapW: number;
  mapD: number;
  playerX: number;
  playerZ: number;
  playerYaw: number;
  bedX: number;
  bedZ: number;
  itemsForMap: { x: number; z: number; collected: boolean }[];
  momsForMap: { x: number; z: number; yaw: number; alarm: 0 | 1 | 2 }[];
  wallsForMap: { minX: number; maxX: number; minZ: number; maxZ: number }[];
  // 隐藏机制
  clockChiming: boolean;          // 当前是否在钟声掩护中
  clockNextIn: number;            // 距离下一次钟声秒数
  hidden: boolean;                // 玩家是否在衣柜里
  nearbyHideSpot: boolean;        // 是否靠近衣柜（提示按 E）
  nearbyCatPet: boolean;          // 是否可撸猫（蹲下 + 距离够）
  catX: number; catZ: number;     // 小地图猫位置
  creakNotice: number;            // 0..1 刚踩到吱呀板的瞬时提示
  stamina: number;                // 0..100 体力值
}

export class GameManager {
  scene: ThreeScene;
  input: InputManager;
  cb: ManagerCallbacks;
  level: number;
  difficulty: Difficulty;

  // 玩家状态
  private playerPos = new THREE.Vector3();
  private playerYaw = 0;
  private playerPitch = 0;
  private stance: Stance = 'STAND';
  private playerHeight = PLAYER_HEIGHT_STAND;
  private flashOn = false;
  private currentMoveSpeed = 0;
  // 跳跃物理
  private playerY = 0;          // 脚底 Y。在地面时 = 0
  private velY = 0;             // 垂直速度
  private grounded = true;
  private justLanded = false;   // 本帧刚落地（出噪音）

  // 游戏状态
  private timeLeft: number;
  private paused = false;
  private ended = false;
  private score = 0;
  private collected = 0;
  private moms: MomRuntime[] = [];

  // === 隐藏机制状态 ===
  private clockT = CLOCK_CHIME_DURATION + 5;           // 跳过开局立刻钟声，首响在 ~45s 后
  private clockChiming = false;
  private cat = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, wanderT: 0, meowCd: 0, alarmed: false };
  private creakyTriggered: number[] = [];              // 每块吱呀板的剩余冷却（秒）
  private creakNotice = 0;                             // 刚踩到吱呀板的视觉/HUD 闪烁
  private hidden = false;                              // 玩家在衣柜中
  private nearestClosetIdx = -1;
  // 幽灵潜行追踪
  private maxSusEver = 0;
  private flashEverUsed = false;
  private creakyEverTriggered = false;
  private petCat = false;

  // 体力系统
  private stamina = STAMINA_MAX;
  private canRun = true;

  // 内部
  private rafId = 0;
  private lastT = 0;
  private startT = 0;

  constructor(container: HTMLElement, level: number, difficulty: Difficulty, cb: ManagerCallbacks) {
    this.level = level;
    this.difficulty = difficulty;
    this.cb = cb;
    const cfg = LEVELS[level - 1] ?? LEVELS[0];
    const m = DIFFICULTY_MULTIPLIERS[difficulty];
    this.timeLeft = cfg.timeLimit * m.timeLimit;
    this.scene = new ThreeScene(container);
    this.input = new InputManager(container);
    this.startT = performance.now();
    this.init().catch(e => console.error('init failed', e));
  }

  private async init() {
    await this.scene.loadAssets();
    const map = this.scene.buildMap();
    const cfg = LEVELS[this.level - 1] ?? LEVELS[0];
    const m = DIFFICULTY_MULTIPLIERS[this.difficulty];

    // 玩家初始位置（玩家床边）
    this.playerPos.set(map.playerSpawn.x, 0, map.playerSpawn.z);
    this.playerHeight = PLAYER_HEIGHT_STAND;
    this.playerYaw = Math.PI;  // 面向走廊（南）
    this.playerPitch = 0;

    // 隐藏机制初始化
    this.cat.x = map.catSpawn.x;
    this.cat.z = map.catSpawn.z;
    this.cat.yaw = Math.random() * Math.PI * 2;
    this.creakyTriggered = map.creakyFloors.map(() => 0);
    this.scene.setCatPos(this.cat.x, this.cat.z, this.cat.yaw);

    // 物品分布：在玩家卧室外的 4 个房间随机
    const allTypes: ItemType[] = ['manga', 'snack', 'cola', 'charger', 'headphone', 'cartridge', 'battery', 'controller'];
    // shuffled
    const types: ItemType[] = [];
    while (types.length < cfg.totalItemsInMap) {
      types.push(allTypes[(types.length + Math.floor(Math.random() * allTypes.length)) % allTypes.length]);
    }
    // 房间索引：1=爸妈 2=客厅 3=厨房 4=走廊（避开玩家卧室=0）
    const roomOptions = [1, 2, 3, 4];
    const items = types.map((t, i) => ({ type: t, roomIndex: roomOptions[i % roomOptions.length] }));
    this.scene.spawnItems(items);

    // 妈妈
    for (let i = 0; i < cfg.momCount; i++) {
      const startWp = map.patrolWaypoints[(i * 2) % map.patrolWaypoints.length];
      const vis = this.scene.spawnMom(startWp.clone());
      const speed = cfg.momSpeed * m.momSpeed;
      const chaseSpeed = cfg.momChaseSpeed * m.momSpeed;
      const viewDist = cfg.momViewDist * m.momView;
      const viewHalfAngle = (cfg.momViewAngleDeg * Math.PI / 180) / 2;
      const mom: MomRuntime = {
        vis, state: 'PATROL',
        pos: startWp.clone(),
        yaw: 0, yawTarget: 0,
        patrolIndex: i * 2 % map.patrolWaypoints.length,
        patrolWaitT: 0,
        suspicion: 0,
        investigatePos: null, investigateT: 0,
        speed, chaseSpeed, viewDist, viewHalfAngle,
      };
      this.scene.setMomViewCone(vis, viewDist, viewHalfAngle, 0);
      this.moms.push(mom);
    }

    this.lastT = performance.now();
    this.loop();
  }

  dispose() {
    cancelAnimationFrame(this.rafId);
    this.scene.dispose();
    this.input.dispose();
  }

  togglePause() {
    if (this.ended) return;
    this.paused = !this.paused;
    if (this.paused) this.input.releaseLock();
    this.lastT = performance.now();
    this.emitState();
  }

  // ==== 主循环 ====
  private loop = () => {
    this.rafId = requestAnimationFrame(this.loop);
    const now = performance.now();
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (dt > 0.1) dt = 0.1;

    if (!this.paused && !this.ended) this.tick(dt);
    this.scene.update(dt);
    this.scene.render();
    this.emitState();
  };

  private tick(dt: number) {
    const inp = this.input.poll();

    // 暂停
    if (inp.pause) { this.togglePause(); return; }

    // 时间
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) { this.lose('timeout'); return; }

    // === 隐藏机制：钟声周期 ===
    this.clockT += dt;
    const phase = this.clockT % CLOCK_CYCLE;
    const wasChiming = this.clockChiming;
    this.clockChiming = phase < CLOCK_CHIME_DURATION;
    if (this.clockChiming && !wasChiming) audio.doorCreak(); // 钟声起
    if (this.clockChiming !== wasChiming) this.scene.setClockChiming(this.clockChiming);

    // === 衣柜躲藏：若按 E 且靠近衣柜则切换 ===
    let nearestCloset = -1;
    let nearestClosetD2 = HIDE_INTERACT_DIST * HIDE_INTERACT_DIST;
    for (let i = 0; i < this.scene.map.closets.length; i++) {
      const c = this.scene.map.closets[i];
      const d2v = (c.x - this.playerPos.x) ** 2 + (c.z - this.playerPos.z) ** 2;
      if (d2v < nearestClosetD2) { nearestClosetD2 = d2v; nearestCloset = i; }
    }
    this.nearestClosetIdx = nearestCloset;

    // 视角
    this.playerYaw += inp.lookDX;
    this.playerPitch = clamp(this.playerPitch + inp.lookDY, -Math.PI / 2.05, Math.PI / 2.05);

    // === 隐藏中：玩家被冻结，仅能用 E 出来 ===
    if (this.hidden) {
      if (inp.interact) { this.hidden = false; audio.click(); }
      // 视图微调
      this.scene.setPlayerPos(this.playerPos.x, this.playerPos.z, PLAYER_HEIGHT_CROUCH);
      this.scene.applyLook(this.playerYaw, this.playerPitch);
      // 妈妈仍然 AI 但完全看不见 / 听不见玩家
      this.updateMoms(dt);
      // 怀疑度快速衰减
      for (const m of this.moms) m.suspicion = Math.max(0, m.suspicion - HIDE_SUSPICION_DECAY * dt);
      // 更新猫
      this.updateCat(dt);
      return;
    }

    // 姿态切换（蹲下。空中不能蹲起过渡）
    const wantsCrouch = inp.crouch && this.grounded;
    const targetH = wantsCrouch ? PLAYER_HEIGHT_CROUCH : PLAYER_HEIGHT_STAND;
    this.playerHeight += (targetH - this.playerHeight) * Math.min(1, dt * 8);
    this.stance = Math.abs(this.playerHeight - PLAYER_HEIGHT_CROUCH) < 0.1 ? 'CROUCH' : 'STAND';

    // 跳跃：只能在地面且未蹲起跳
    if (inp.jump && this.grounded && !wantsCrouch) {
      this.velY = PLAYER_JUMP_SPEED;
      this.grounded = false;
      audio.click();
    }
    // 重力
    this.velY -= GRAVITY * dt;
    this.playerY += this.velY * dt;
    this.justLanded = false;
    if (this.playerY <= 0) {
      if (!this.grounded) this.justLanded = true;
      this.playerY = 0;
      this.velY = 0;
      this.grounded = true;
    }

    // 移动速度（空中减速）+ 体力系统
    const isMovingInput = Math.abs(inp.moveX) + Math.abs(inp.moveY) > 0.05;
    // 体力：跑步消耗，走路/蹲行回复
    if (inp.run && this.canRun && this.stamina > 0 && this.stance !== 'CROUCH' && isMovingInput && this.grounded) {
      this.stamina = Math.max(0, this.stamina - STAMINA_RUN_DRAIN * dt);
      if (this.stamina <= 0) this.canRun = false;
    } else {
      const regen = this.stance === 'CROUCH' ? STAMINA_CROUCH_REGEN : STAMINA_WALK_REGEN;
      this.stamina = Math.min(STAMINA_MAX, this.stamina + regen * dt);
      if (!this.canRun && this.stamina >= STAMINA_REUSE_MIN) this.canRun = true;
    }
    const canActuallyRun = inp.run && this.canRun && this.stamina > 0;
    let speed = PLAYER_WALK_SPEED;
    if (this.stance === 'CROUCH') speed = PLAYER_CROUCH_SPEED;
    else if (canActuallyRun) speed = PLAYER_RUN_SPEED;
    if (!this.grounded) speed *= 0.7;
    this.currentMoveSpeed = isMovingInput ? speed : 0;

    // 朝向移动向量（以 yaw 为参考）
    if (this.currentMoveSpeed > 0) {
      const cy = Math.cos(this.playerYaw), sy = Math.sin(this.playerYaw);
      // 摄像机面向 -Z，前向为 (-sin yaw, 0, -cos yaw)
      const fwdX = -sy, fwdZ = -cy;
      const rgtX =  cy, rgtZ = -sy;
      const dx = (fwdX * (-inp.moveY) + rgtX * inp.moveX) * speed * dt;
      const dz = (fwdZ * (-inp.moveY) + rgtZ * inp.moveX) * speed * dt;
      this.tryMovePlayer(dx, dz);
    }

    // 手电筒
    if (inp.flashlight) {
      this.flashOn = !this.flashOn;
      audio.click();
      this.scene.setFlashlight(this.flashOn);
      if (this.flashOn) this.flashEverUsed = true;
    }

    // === 隐藏机制：吱呀地板 ===
    // 走/跑（非蹲）才会触发；离开冷却中的板子也不重复响
    for (let i = 0; i < this.creakyTriggered.length; i++) {
      this.creakyTriggered[i] = Math.max(0, this.creakyTriggered[i] - dt);
    }
    if (this.currentMoveSpeed > 0 && this.stance === 'STAND') {
      const fl = this.scene.map.creakyFloors;
      for (let i = 0; i < fl.length; i++) {
        if (this.creakyTriggered[i] > 0) continue;
        const dx = fl[i].x - this.playerPos.x, dz = fl[i].z - this.playerPos.z;
        if (dx * dx + dz * dz < CREAKY_FLOOR_RADIUS * CREAKY_FLOOR_RADIUS) {
          this.creakyTriggered[i] = CREAKY_TRIGGER_COOLDOWN;
          this.creakNotice = 1;
          this.creakyEverTriggered = true;
          audio.doorCreak();
          break;
        }
      }
    }
    this.creakNotice = Math.max(0, this.creakNotice - dt * 1.2);

    // === 隐藏机制：流浪猫 ===
    this.updateCat(dt);
    // 撸猫（蹲下 + 距离 < CAT_PET_DIST + 按 E）
    const catDx = this.cat.x - this.playerPos.x, catDz = this.cat.z - this.playerPos.z;
    const catD = Math.hypot(catDx, catDz);
    const canPet = !this.petCat && this.stance === 'CROUCH' && catD < CAT_PET_DIST;
    if (canPet && inp.interact) {
      this.petCat = true;
      this.score += CAT_PET_BONUS;
      audio.collect();
    }

    // 拾取（撸猫优先，避免重复消耗 interact）
    let consumedInteract = canPet && inp.interact;
    // 衣柜进入
    if (!consumedInteract && nearestCloset >= 0 && inp.interact) {
      this.hidden = true;
      audio.putDown();
      consumedInteract = true;
    }
    if (!consumedInteract) {
      const near = this.findNearbyItem();
      if (near && inp.interact) {
        this.scene.collectItem(near.id);
        near.collected = true;
        this.collected++;
        this.score += 100;
        audio.collect();
        // 拾取噪音：附近妈妈被吸引
        for (const mom of this.moms) {
          const md = Math.hypot(mom.pos.x - this.playerPos.x, mom.pos.z - this.playerPos.z);
          if (md < ITEM_PICKUP_NOISE) {
            mom.suspicion = clamp(mom.suspicion + 18, 0, MOM_SUSPICION_ALERT);
            mom.investigatePos = new THREE.Vector3(this.playerPos.x, 1.55, this.playerPos.z);
          }
        }
      }
    }

    // 妈妈 AI
    this.updateMoms(dt);

    // 应用相机
    this.scene.setPlayerPos(this.playerPos.x, this.playerPos.z, this.playerHeight + this.playerY);
    this.scene.applyLook(this.playerYaw, this.playerPitch);

    // 胜利检测：收集够数 + 回到床
    const cfg = LEVELS[this.level - 1] ?? LEVELS[0];
    if (this.collected >= cfg.itemsToCollect && this.inBedZone()) {
      const timeBonus = Math.max(0, Math.floor(this.timeLeft * 5));
      const stealthBonus = this.moms.every(m => m.suspicion < 30) ? 500 : 0;
      // 幽灵潜行额外奖励
      const ghost = this.maxSusEver < GHOST_RUN_MAX_SUSPICION
                  && !this.flashEverUsed
                  && !this.creakyEverTriggered;
      const ghostBonus = ghost ? GHOST_RUN_BONUS : 0;
      const finalScore = this.score + timeBonus + stealthBonus + ghostBonus;
      const badges: string[] = [];
      if (ghost) badges.push('ghost');
      if (this.petCat) badges.push('catfriend');
      this.win(finalScore, badges);
    }
  }

  // === 隐藏机制：流浪猫 AI（在客厅游荡 + 看到玩家会远离 + 撞到喵叫） ===
  private updateCat(dt: number) {
    const b = this.scene.map.catRoomBounds;
    this.cat.wanderT -= dt;
    if (this.cat.wanderT <= 0) {
      this.cat.wanderT = 1.5 + Math.random() * 2.5;
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 0.4;
      this.cat.vx = Math.cos(a) * sp;
      this.cat.vz = Math.sin(a) * sp;
    }
    // 撸过的猫会跟着玩家
    if (this.petCat) {
      const dxp = this.playerPos.x - this.cat.x, dzp = this.playerPos.z - this.cat.z;
      const dp = Math.hypot(dxp, dzp);
      if (dp > 1.5) { this.cat.vx = (dxp / dp) * 1.0; this.cat.vz = (dzp / dp) * 1.0; }
      else          { this.cat.vx *= 0.5; this.cat.vz *= 0.5; }
    }
    let nx = this.cat.x + this.cat.vx * dt;
    let nz = this.cat.z + this.cat.vz * dt;
    // 限制在客厅范围内（除非已撸猫，则可跟随玩家全图）
    if (!this.petCat) {
      if (nx < b.minX || nx > b.maxX) { this.cat.vx *= -1; nx = clamp(nx, b.minX, b.maxX); }
      if (nz < b.minZ || nz > b.maxZ) { this.cat.vz *= -1; nz = clamp(nz, b.minZ, b.maxZ); }
    }
    // 与墙碰撞
    if (!collidesCircle(nx, this.cat.z, 0.18, this.scene.map.walls)) this.cat.x = nx;
    else this.cat.vx *= -1;
    if (!collidesCircle(this.cat.x, nz, 0.18, this.scene.map.walls)) this.cat.z = nz;
    else this.cat.vz *= -1;
    if (Math.hypot(this.cat.vx, this.cat.vz) > 0.05) {
      this.cat.yaw = Math.atan2(this.cat.vx, this.cat.vz);
    }
    this.cat.meowCd = Math.max(0, this.cat.meowCd - dt);
    // 撞到玩家（站立或走路）→ 喵叫，且没在撸 / 没在 hide
    if (!this.petCat && !this.hidden && this.cat.meowCd <= 0) {
      const cd = Math.hypot(this.cat.x - this.playerPos.x, this.cat.z - this.playerPos.z);
      if (cd < CAT_BUMP_DIST) {
        this.cat.meowCd = CAT_MEOW_COOLDOWN;
        this.cat.alarmed = true;
        audio.warning(); audio.warning();
        // 让最近妈妈来调查
        let nearest: MomRuntime | null = null; let nd = 1e9;
        for (const m of this.moms) {
          const md = m.pos.distanceTo(this.playerPos);
          if (md < nd) { nd = md; nearest = m; }
        }
        if (nearest) {
          nearest.investigatePos = new THREE.Vector3(this.playerPos.x, 1.55, this.playerPos.z);
          nearest.suspicion = Math.min(MOM_SUSPICION_MAX - 5, nearest.suspicion + 50);
        }
      }
    }
    this.scene.setCatPos(this.cat.x, this.cat.z, this.cat.yaw);
  }

  private win(score: number, badges: string[] = []) {
    if (this.ended) return;
    this.ended = true;
    audio.win();
    this.input.releaseLock();
    this.cb.onWin(score, badges);
  }
  private lose(reason: string) {
    if (this.ended) return;
    this.ended = true;
    audio.caught();
    this.input.releaseLock();
    this.cb.onLose(reason);
  }

  // === 玩家碰撞：圆形（半径 PLAYER_RADIUS）vs 一组 AABB ===
  private tryMovePlayer(dx: number, dz: number) {
    // 分轴解算
    const walls = this.scene.map.walls;
    const r = PLAYER_RADIUS;
    let nx = this.playerPos.x + dx;
    let nz = this.playerPos.z;
    if (!collidesCircle(nx, nz, r, walls)) this.playerPos.x = nx;
    nx = this.playerPos.x;
    nz = this.playerPos.z + dz;
    if (!collidesCircle(nx, nz, r, walls)) this.playerPos.z = nz;
  }

  private inBedZone(): boolean {
    const b = this.scene.map.bedTrigger;
    const p = this.playerPos;
    return p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
  }

  private findNearbyItem(): ItemSpawn | null {
    let best: ItemSpawn | null = null;
    let bestD = 1.6 * 1.6;  // 1.6m 半径内可拾取
    for (const it of this.scene.itemSpawns) {
      if (it.collected) continue;
      const dx = it.pos.x - this.playerPos.x;
      const dz = it.pos.z - this.playerPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = it; }
    }
    return best;
  }

  // === 妈妈 AI ===
  private updateMoms(dt: number) {
    const map = this.scene.map;
    const playerEye = new THREE.Vector3(this.playerPos.x, this.playerHeight * 0.85, this.playerPos.z);
    const m = DIFFICULTY_MULTIPLIERS[this.difficulty];

    // 玩家噪音半径
    const isMoving = this.currentMoveSpeed > 0.1;
    let noiseR = 0;
    if (isMoving) {
      if (this.stance === 'CROUCH') noiseR = NOISE_RADIUS_CROUCH;
      else if (this.currentMoveSpeed > PLAYER_WALK_SPEED + 0.2) noiseR = NOISE_RADIUS_RUN;
      else noiseR = NOISE_RADIUS_WALK;
    }
    if (this.flashOn) noiseR = Math.max(noiseR, 5); // 手电筒会暴露光线（视觉）
    if (this.justLanded) noiseR = Math.max(noiseR, NOISE_RADIUS_JUMP_LAND); // 落地啦一声
    // 吱呀地板：刚踩到的额外噪音（一次性）
    if (this.creakNotice > 0.85 && this.stance === 'STAND') {
      noiseR = Math.max(noiseR, CREAKY_FLOOR_NOISE);
    }
    // === 隐藏机制：钟声掩护 / 衣柜躲藏 → 妈妈听不见 ===
    if (this.clockChiming || this.hidden) noiseR = 0;
    // 猫叫：等同于在玩家位置发出大噪音
    if (this.cat.alarmed && this.cat.meowCd > CAT_MEOW_COOLDOWN - 1.0 && !this.clockChiming) {
      noiseR = Math.max(noiseR, CAT_MEOW_NOISE_RADIUS);
    }
    this.cat.alarmed = false;

    for (const mom of this.moms) {
      // 1) 视觉检测
      const eyeMom = new THREE.Vector3(mom.pos.x, 1.55, mom.pos.z);
      const toPlayer = new THREE.Vector3(playerEye.x - eyeMom.x, 0, playerEye.z - eyeMom.z);
      const dist = toPlayer.length();
      let canSee = false;
      if (dist < mom.viewDist) {
        // 角度检查
        const fwd = new THREE.Vector2(-Math.sin(mom.yaw), -Math.cos(mom.yaw));
        const dir = new THREE.Vector2(toPlayer.x, toPlayer.z).normalize();
        const dot = fwd.x * dir.x + fwd.y * dir.y;
        const ang = Math.acos(clamp(dot, -1, 1));
        // 蹲下且距离>1.5m 视野半角缩小（更难发现）
        const effHalf = mom.viewHalfAngle * (this.stance === 'CROUCH' && dist > 1.5 ? 0.7 : 1.0);
        if (ang < effHalf) {
          // 视线遮挡
          if (!segmentBlockedByWalls(eyeMom, playerEye, map.walls)) {
            canSee = true;
          }
        }
      }
      // === 隐藏机制：衣柜中完全无视 ===
      if (this.hidden) canSee = false;
      // 2) 手电筒额外侦测（被照亮容易被看到）
      // 3) 听觉检测：玩家噪音半径 vs 妈妈到玩家的距离
      const heard = noiseR > 0 && dist < noiseR;

      // 怀疑度更新
      const susRate = m.suspicionRate;
      if (canSee) {
        // 站立 + 距离 < 5 极快；远距 + 蹲 较慢
        const closeness = 1 - clamp(dist / mom.viewDist, 0, 1);
        const stanceMul = this.stance === 'CROUCH' ? 0.5 : 1;
        const flashMul = this.flashOn ? 1.6 : 1.0;
        mom.suspicion = clamp(mom.suspicion + (35 + closeness * 60) * stanceMul * flashMul * susRate * dt, 0, MOM_SUSPICION_MAX);
        mom.investigatePos = playerEye.clone();
      } else if (heard) {
        mom.suspicion = clamp(mom.suspicion + 25 * susRate * dt, 0, MOM_SUSPICION_ALERT - 5);
        mom.investigatePos = playerEye.clone();
      } else {
        // 缓慢衰减（比原来慢，更难甩掉妈妈）
        mom.suspicion = Math.max(0, mom.suspicion - MOM_SUSPICION_DECAY * dt);
      }

      // 状态转移
      if (mom.suspicion >= MOM_SUSPICION_DETECT && canSee) {
        mom.state = 'CHASE';
      } else if (mom.suspicion >= MOM_SUSPICION_ALERT && mom.investigatePos) {
        if (mom.state !== 'CHASE') mom.state = 'INVESTIGATE';
      } else if (mom.state !== 'CHASE') {
        if (mom.investigatePos) mom.state = 'INVESTIGATE';
        else mom.state = 'PATROL';
      }
      // CHASE 失去视野且怀疑度落到一定值 -> INVESTIGATE
      if (mom.state === 'CHASE' && !canSee && mom.suspicion < 70) {
        mom.state = 'INVESTIGATE';
      }

      // 行为执行
      if (mom.state === 'CHASE') {        // 追玩家位置
        this.steerMomTo(mom, playerEye, mom.chaseSpeed, dt);
        // 抓到（接触距离）
        if (dist < 0.9) {
          this.lose('caught_mom');
          return;
        }
      } else if (this.clockChiming) {
        // 钟声中：呆立捂耳，原地张望
        mom.yawTarget = mom.yaw + Math.sin(this.clockT * 3) * 0.4;
      } else if (mom.state === 'INVESTIGATE' && mom.investigatePos) {
        const d = mom.pos.distanceTo(mom.investigatePos);
        if (d < 0.5) {
          mom.investigateT += dt;
          if (mom.investigateT > 3.0) {
            mom.investigatePos = null;
            mom.investigateT = 0;
            // 调查完毕后保留最低怀疑度（妈妈心有余悸，不会完全忘记）
            mom.suspicion = Math.max(MOM_SUSPICION_FLOOR, mom.suspicion - 30);
            mom.state = 'PATROL';
          } else {
            // 原地左右张望
            mom.yawTarget = mom.yaw + Math.sin(mom.investigateT * 2) * 0.8;
          }
        } else {
          this.steerMomTo(mom, mom.investigatePos, mom.speed * 1.3, dt);
        }
      } else {
        // PATROL
        const wp = map.patrolWaypoints[mom.patrolIndex];
        const d = mom.pos.distanceTo(wp);
        if (d < 0.6) {
          mom.patrolWaitT += dt;
          if (mom.patrolWaitT > 1.2) {
            mom.patrolWaitT = 0;
            mom.patrolIndex = (mom.patrolIndex + 1) % map.patrolWaypoints.length;
          }
        } else {
          this.steerMomTo(mom, wp, mom.speed, dt);
        }
      }

      // 平滑朝向
      mom.yaw = approachAngle(mom.yaw, mom.yawTarget, dt * 4);
      mom.vis.group.position.set(mom.pos.x, 0, mom.pos.z);
      mom.vis.group.rotation.y = mom.yaw;

      // 跟踪幽灵潜行：全局最高怀疑度
      if (mom.suspicion > this.maxSusEver) this.maxSusEver = mom.suspicion;

      // 视觉同步
      const alarmLevel: 0 | 1 | 2 = mom.state === 'CHASE' ? 2 : mom.state === 'INVESTIGATE' ? 1 : 0;
      this.scene.setMomViewCone(mom.vis, mom.viewDist, mom.viewHalfAngle, alarmLevel);
      this.scene.setMomAlertIcon(mom.vis,
        mom.state === 'CHASE' ? 'alert' :
        (mom.state === 'INVESTIGATE' || mom.suspicion > 25) ? 'susp' : 'none');
      this.scene.setMomLight(mom.vis, mom.state === 'CHASE' ? 4.0 : 1.5);

      // 动画
      const moving = mom.state !== 'PATROL' || d2(mom.pos, map.patrolWaypoints[mom.patrolIndex]) > 0.36;
      if (mom.vis.walkAction && mom.vis.idleAction) {
        if (moving) { mom.vis.walkAction.play(); mom.vis.idleAction.stop(); }
        else        { mom.vis.idleAction.play(); mom.vis.walkAction.stop(); }
        mom.vis.walkAction.timeScale = mom.state === 'CHASE' ? 1.6 : 1.0;
      }
    }
  }

  private steerMomTo(mom: MomRuntime, target: THREE.Vector3, speed: number, dt: number) {
    const dx = target.x - mom.pos.x;
    const dz = target.z - mom.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.001) return;
    let nx = dx / d, nz = dz / d;
    // 障碍避让：若前方一定距离与墙相撞，绕开（简单版本）
    const probe = 0.6;
    const tryX = mom.pos.x + nx * speed * dt;
    const tryZ = mom.pos.z + nz * speed * dt;
    const walls = this.scene.map.walls;
    let canX = !collidesCircle(tryX, mom.pos.z, 0.35, walls);
    let canZ = !collidesCircle(mom.pos.x, tryZ, 0.35, walls);
    if (canX) mom.pos.x = tryX;
    if (canZ) mom.pos.z = tryZ;
    // 如果两轴都不能动，尝试沿垂直方向滑动
    if (!canX && !canZ) {
      const slideX = mom.pos.x + (-nz) * speed * dt * 0.6;
      const slideZ = mom.pos.z + ( nx) * speed * dt * 0.6;
      if (!collidesCircle(slideX, mom.pos.z, 0.35, walls)) mom.pos.x = slideX;
      if (!collidesCircle(mom.pos.x, slideZ, 0.35, walls)) mom.pos.z = slideZ;
    }
    void probe;
    mom.yawTarget = Math.atan2(-nx, -nz);  // 与 yaw 定义一致
  }

  private currentRoomName(): string {
    const p = this.playerPos;
    for (const r of this.scene.map.rooms) {
      if (p.x >= r.bounds.minX && p.x <= r.bounds.maxX &&
          p.z >= r.bounds.minZ && p.z <= r.bounds.maxZ) return r.name;
    }
    return '';
  }

  private emitState() {
    const cfg = LEVELS[this.level - 1] ?? LEVELS[0];
    const near = this.findNearbyItem();
    const inBed = this.inBedZone();
    const need = Math.max(0, cfg.itemsToCollect - this.collected);
    const maxSus = this.moms.reduce((mx, m) => Math.max(mx, m.suspicion), 0);
    const detected = this.moms.some(m => m.state === 'CHASE');
    const maxAlarm: 0 | 1 | 2 = detected ? 2 : (this.moms.some(m => m.state === 'INVESTIGATE' || m.suspicion >= MOM_SUSPICION_ALERT) ? 1 : 0);
    const isRunning = this.currentMoveSpeed > PLAYER_WALK_SPEED + 0.2;
    const noiseR = isRunning ? NOISE_RADIUS_RUN : (this.currentMoveSpeed > 0.1 ? (this.stance === 'CROUCH' ? NOISE_RADIUS_CROUCH : NOISE_RADIUS_WALK) : 0);
    const map = this.scene.map;
    const itemsForMap = this.scene.itemSpawns.map(it => ({ x: it.pos.x, z: it.pos.z, collected: it.collected }));
    const momsForMap = this.moms.map(m => ({
      x: m.pos.x, z: m.pos.z, yaw: m.yaw,
      alarm: (m.state === 'CHASE' ? 2 : (m.state === 'INVESTIGATE' || m.suspicion >= MOM_SUSPICION_ALERT) ? 1 : 0) as 0 | 1 | 2,
    }));
    const wallsForMap = map.walls;
    const bedCx = (map.bedTrigger.minX + map.bedTrigger.maxX) / 2;
    const bedCz = (map.bedTrigger.minZ + map.bedTrigger.maxZ) / 2;
    const s: ManagerState = {
      itemsCollected: this.collected,
      itemsToCollect: cfg.itemsToCollect,
      totalItemsInMap: cfg.totalItemsInMap,
      itemsRemainingNeeded: need,
      timeLeft: this.timeLeft,
      paused: this.paused,
      stance: this.stance,
      isRunning,
      isAirborne: !this.grounded,
      flashlightOn: this.flashOn,
      noiseRadius: noiseR,
      nearbyItem: near ? { type: near.type, name: ITEM_INFO[near.type].name, emoji: ITEM_INFO[near.type].emoji } : null,
      inBedZone: inBed,
      canFinish: this.collected >= cfg.itemsToCollect,
      maxAlarm,
      maxSuspicion: maxSus,
      detected,
      pointerLocked: this.input.pointerLocked,
      currentRoomName: this.currentRoomName(),
      score: this.score,
      mapW: map.size.w, mapD: map.size.d,
      playerX: this.playerPos.x, playerZ: this.playerPos.z, playerYaw: this.playerYaw,
      bedX: bedCx, bedZ: bedCz,
      itemsForMap, momsForMap, wallsForMap,
      clockChiming: this.clockChiming,
      clockNextIn: this.clockChiming
        ? (CLOCK_CHIME_DURATION - (this.clockT % CLOCK_CYCLE))
        : (CLOCK_CYCLE - (this.clockT % CLOCK_CYCLE)),
      hidden: this.hidden,
      nearbyHideSpot: this.nearestClosetIdx >= 0 && !this.hidden,
      nearbyCatPet: !this.petCat && this.stance === 'CROUCH'
        && Math.hypot(this.cat.x - this.playerPos.x, this.cat.z - this.playerPos.z) < CAT_PET_DIST,
      catX: this.cat.x, catZ: this.cat.z,
      creakNotice: this.creakNotice,
      stamina: this.stamina,
    };
    this.cb.onState(s);
  }
}

// ===== 工具函数 =====

function collidesCircle(px: number, pz: number, r: number, walls: AABB[]): boolean {
  for (const w of walls) {
    const cx = clamp(px, w.minX, w.maxX);
    const cz = clamp(pz, w.minZ, w.maxZ);
    const dx = px - cx, dz = pz - cz;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

function segmentBlockedByWalls(a: THREE.Vector3, b: THREE.Vector3, walls: AABB[]): boolean {
  // 仅水平面（XZ）做线段-AABB 检测
  for (const w of walls) {
    if (segmentIntersectsAABB(a.x, a.z, b.x, b.z, w)) return true;
  }
  return false;
}

function segmentIntersectsAABB(ax: number, az: number, bx: number, bz: number, w: AABB): boolean {
  // Liang-Barsky 2D 线段裁剪
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  const p = [-dx, dx, -dz, dz];
  const q = [ax - w.minX, w.maxX - ax, az - w.minZ, w.maxZ - az];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else          { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

function approachAngle(cur: number, target: number, t: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * Math.min(1, t);
}

function d2(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x, dz = a.z - b.z;
  return dx * dx + dz * dz;
}
