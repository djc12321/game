// ArenaGame：1v1 FPS 竞技场游戏逻辑
// 规则：先达到 5 杀（或 5 分钟内最多杀数）者获胜
// 武器：闪光枪（鼠标左键射击，R 键换弹）
import * as THREE from 'three';
import {
  ArenaScene, ALL_ARENA_WALLS, SPAWN_HOST, SPAWN_GUEST,
  circleOverlapsBox, resolveBoxCollision, ARENA_PLAYER_RADIUS,
} from './ArenaScene';
import { InputManager } from './InputManager';
import { type MultiplayerManager, type NetMsg } from './MultiplayerManager';
import { PLAYER_WALK_SPEED, PLAYER_RUN_SPEED } from './constants';

// ====== 竞技场参数 ======
const HP_MAX         = 100;
const DMG_BODY       = 25;    // 身体伤害（4 发击杀）
const DMG_HEAD       = 50;    // 爆头伤害（2 发击杀）
const AMMO_MAX       = 6;
const RELOAD_TIME    = 1.8;   // 秒
const FIRE_CD        = 0.22;  // 最短开枪间隔（秒）
const SHOOT_RANGE    = 22;
const RESPAWN_DELAY  = 3;     // 死后复活倒计时（秒）
const KILLS_TO_WIN   = 5;
const MATCH_DURATION = 300;   // 5 分钟
const POS_SEND_HZ    = 20;    // 位置同步频率

export interface ArenaState {
  hp: number;
  ammo: number;
  reloading: boolean;
  reloadPct: number;      // 0..1
  myKills: number;
  enemyKills: number;
  timeLeft: number;
  isAlive: boolean;
  respawnT: number;
  hitFlash: number;       // 0..1 受击红屏
  hitmarker: number;      // 0..1 命中提示
  enemyHp: number;
  pointerLocked: boolean;
}

export interface ArenaCallbacks {
  onState: (s: ArenaState) => void;
  onEnd: (won: boolean, myKills: number, enemyKills: number) => void;
}

export class ArenaGame {
  private scene: ArenaScene;
  private input: InputManager;
  private net: MultiplayerManager;
  private cb: ArenaCallbacks;
  private isHost: boolean;

  // 本地玩家
  private pos = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private hp = HP_MAX;
  private ammo = AMMO_MAX;
  private reloading = false;
  private reloadT = 0;
  private fireCd = 0;
  private isAlive = true;
  private respawnT = 0;
  private myKills = 0;

  // 对手（网络同步）
  private enemyPos = new THREE.Vector3(9999, 0, 9999);
  private enemyYaw = 0;
  private enemyHp = HP_MAX;
  private enemyAlive = true;
  private enemyKills = 0;

  // 视觉反馈
  private hitFlash = 0;
  private hitmarker = 0;

  // 游戏时间
  private timeLeft = MATCH_DURATION;
  private ended = false;

  // 网络
  private sendTimer = 0;

  // 循环
  private rafId = 0;
  private lastT = 0;

  // 鼠标射击监听
  private pendingFire = false;
  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) this.pendingFire = true;
  };

  constructor(
    container: HTMLElement,
    net: MultiplayerManager,
    cb: ArenaCallbacks,
    isHost: boolean,
  ) {
    this.net = net;
    this.cb = cb;
    this.isHost = isHost;

    this.scene = new ArenaScene(container);
    this.input = new InputManager(this.scene.renderer.domElement);

    // 接管 net 的消息处理
    this.net.cb.onMessage = (msg: NetMsg) => this._onNetMsg(msg);

    // 鼠标左键 = 射击（需要 pointer lock）
    this.scene.renderer.domElement.addEventListener('mousedown', this.onMouseDown);

    // 出生位置
    const spawn = isHost ? SPAWN_HOST.clone() : SPAWN_GUEST.clone();
    this.pos.copy(spawn);
    this.yaw = isHost ? 0 : Math.PI; // 面向对方

    this.lastT = performance.now();
    this.rafId = requestAnimationFrame(this._loop);
  }

  private _loop = (now: number) => {
    const dt = Math.min((now - this.lastT) / 1000, 0.1);
    this.lastT = now;
    if (!this.ended) this._tick(dt);
    this.scene.render(dt);
    this.rafId = requestAnimationFrame(this._loop);
  };

  private _tick(dt: number) {
    // 时间
    this.timeLeft = Math.max(0, this.timeLeft - dt);

    const inp = this.input.poll();

    if (this.isAlive) {
      this._tickMove(dt, inp);
      this._tickShoot(dt, inp);
    } else {
      this.respawnT = Math.max(0, this.respawnT - dt);
      if (this.respawnT <= 0) this._respawn();
    }

    // 换弹进度
    if (this.reloading) {
      this.reloadT = Math.max(0, this.reloadT - dt);
      if (this.reloadT <= 0) { this.reloading = false; this.ammo = AMMO_MAX; }
    }

    // 视觉衰减
    this.hitFlash  = Math.max(0, this.hitFlash  - dt * 3.5);
    this.hitmarker = Math.max(0, this.hitmarker - dt * 4.0);

    // 同步位置
    this.sendTimer -= dt;
    if (this.sendTimer <= 0) {
      this.sendTimer = 1 / POS_SEND_HZ;
      this.net.send({ t: 'pos', x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, pitch: this.pitch });
    }

    // 更新相机
    this.scene.yawObject.position.set(this.pos.x, this.pos.y + 1.55, this.pos.z);
    this.scene.yawObject.rotation.y = this.yaw;
    this.scene.pitchObject.rotation.x = this.pitch;

    // 更新对手 mesh
    if (this.enemyAlive) {
      this.scene.setRemotePlayer(this.enemyPos.x, this.enemyPos.y, this.enemyPos.z, this.enemyYaw);
    } else {
      this.scene.hideRemotePlayer();
    }

    // 胜负判定
    const timeUp = this.timeLeft <= 0;
    if (this.myKills >= KILLS_TO_WIN || this.enemyKills >= KILLS_TO_WIN || timeUp) {
      this.ended = true;
      const won = this.myKills > this.enemyKills || this.myKills >= KILLS_TO_WIN;
      this.cb.onEnd(won, this.myKills, this.enemyKills);
    }

    this._emitState();
  }

  private _tickMove(dt: number, inp: ReturnType<InputManager['poll']>) {
    // 视角
    this.yaw   -= inp.lookDX;
    this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch - inp.lookDY));

    // 移动
    const speed = inp.run ? PLAYER_RUN_SPEED : PLAYER_WALK_SPEED;
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    const fwdX = -sinY, fwdZ = -cosY;
    const rtX  =  cosY, rtZ  = -sinY;

    let mx = (fwdX * inp.moveY + rtX * inp.moveX);
    let mz = (fwdZ * inp.moveY + rtZ * inp.moveX);
    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0) { mx = (mx / len) * speed * dt; mz = (mz / len) * speed * dt; }

    let nx = this.pos.x + mx;
    let nz = this.pos.z + mz;

    for (const wall of ALL_ARENA_WALLS) {
      if (circleOverlapsBox(nx, nz, ARENA_PLAYER_RADIUS, wall)) {
        const r = resolveBoxCollision(nx, nz, ARENA_PLAYER_RADIUS, wall);
        nx = r.x; nz = r.z;
      }
    }
    this.pos.x = nx; this.pos.z = nz;
  }

  private _tickShoot(dt: number, inp: ReturnType<InputManager['poll']>) {
    this.fireCd = Math.max(0, this.fireCd - dt);

    // 弹药耗尽时自动换弹
    if (this.ammo <= 0 && !this.reloading) this._startReload();

    // R 键手动换弹
    if (inp.interact && !this.reloading && this.ammo < AMMO_MAX) this._startReload();

    // 射击（鼠标左键）
    const fire = this.pendingFire;
    this.pendingFire = false;
    if (fire && !this.reloading && this.ammo > 0 && this.fireCd <= 0) {
      this._fire();
    }
  }

  private _startReload() {
    this.reloading = true;
    this.reloadT = RELOAD_TIME;
  }

  private _fire() {
    this.ammo--;
    this.fireCd = FIRE_CD;

    const origin = new THREE.Vector3();
    const dir    = new THREE.Vector3();
    this.scene.camera.getWorldPosition(origin);
    this.scene.camera.getWorldDirection(dir);

    // 自己的光束
    this.scene.spawnBeam(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, false);

    // 对手命中检测（射线 vs 对手胶囊球）
    if (this.enemyAlive) {
      const enemyEye = this.enemyPos.clone();
      enemyEye.y += 0.9;  // 身体中心

      const toEnemy = enemyEye.clone().sub(origin);
      const tProj = toEnemy.dot(dir);
      if (tProj > 0 && tProj < SHOOT_RANGE) {
        const closest = origin.clone().addScaledVector(dir, tProj);
        const bodyMiss = closest.distanceTo(enemyEye);
        if (bodyMiss < 0.42) {
          // 区分爆头
          const headCenter = this.enemyPos.clone(); headCenter.y += 1.42;
          const headMiss = closest.distanceTo(headCenter);
          const dmg = headMiss < 0.3 ? DMG_HEAD : DMG_BODY;
          this.hitmarker = 1;
          this.net.send({ t: 'hit', dmg });
        }
      }
    }

    // 告知对手：同步光束
    this.net.send({ t: 'shot', ox: origin.x, oy: origin.y, oz: origin.z, dx: dir.x, dy: dir.y, dz: dir.z });
  }

  private _respawn() {
    this.isAlive = true;
    this.hp      = HP_MAX;
    this.ammo    = AMMO_MAX;
    this.reloading = false;
    // 随机微偏移，防止重叠
    const spawn = this.isHost ? SPAWN_HOST.clone() : SPAWN_GUEST.clone();
    spawn.x += (Math.random() - 0.5) * 2;
    spawn.z += (Math.random() - 0.5) * 2;
    this.pos.copy(spawn);
    this.yaw = this.isHost ? 0 : Math.PI;
    this.net.send({ t: 'respawn', x: this.pos.x, z: this.pos.z });
  }

  private _onNetMsg(msg: NetMsg) {
    switch (msg.t) {
      case 'pos':
        this.enemyPos.set(msg.x, msg.y, msg.z);
        this.enemyYaw = msg.yaw;
        break;
      case 'shot':
        this.scene.spawnBeam(msg.ox, msg.oy, msg.oz, msg.dx, msg.dy, msg.dz, true);
        break;
      case 'hit':
        if (this.isAlive) {
          this.hp = Math.max(0, this.hp - msg.dmg);
          this.hitFlash = 1;
          if (this.hp <= 0) {
            this.isAlive  = false;
            this.respawnT = RESPAWN_DELAY;
            this.enemyKills++;
            this.net.send({ t: 'die' });
          }
        }
        break;
      case 'die':
        this.myKills++;
        this.enemyAlive = false;
        this.enemyHp    = HP_MAX;
        setTimeout(() => { this.enemyAlive = true; }, RESPAWN_DELAY * 1000);
        break;
      case 'respawn':
        this.enemyPos.set(msg.x, 0, msg.z);
        this.enemyAlive = true;
        break;
    }
  }

  private _emitState() {
    this.cb.onState({
      hp:          this.hp,
      ammo:        this.ammo,
      reloading:   this.reloading,
      reloadPct:   this.reloading ? 1 - this.reloadT / RELOAD_TIME : 1,
      myKills:     this.myKills,
      enemyKills:  this.enemyKills,
      timeLeft:    this.timeLeft,
      isAlive:     this.isAlive,
      respawnT:    this.respawnT,
      hitFlash:    this.hitFlash,
      hitmarker:   this.hitmarker,
      enemyHp:     this.enemyHp,
      pointerLocked: this.input.pointerLocked,
    });
  }

  /** 给外部调用（主机发起开始信号） */
  get inputRef(): InputManager { return this.input; }

  dispose() {
    this.ended = true;
    cancelAnimationFrame(this.rafId);
    this.scene.renderer.domElement.removeEventListener('mousedown', this.onMouseDown);
    this.input.dispose();
    this.scene.dispose();
  }
}
