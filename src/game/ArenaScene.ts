// ArenaScene：1v1 竞技场 Three.js 场景
// 风格：赛博朋克霓虹色，小型对称竞技场
import * as THREE from 'three';

// 竞技场尺寸
export const ARENA_W = 24;
export const ARENA_D = 18;
const WALL_H = 3.2;
const PLAYER_RADIUS = 0.32;

export interface Box2D { minX: number; maxX: number; minZ: number; maxZ: number; }

// 柱子 AABB
const PILLAR_DEFS: Box2D[] = [
  { minX: -5.0, maxX: -3.8, minZ: -2.8, maxZ: -1.6 },
  { minX:  3.8, maxX:  5.0, minZ: -2.8, maxZ: -1.6 },
  { minX: -5.0, maxX: -3.8, minZ:  1.6, maxZ:  2.8 },
  { minX:  3.8, maxX:  5.0, minZ:  1.6, maxZ:  2.8 },
];

// 掩体墙 AABB
const COVER_DEFS: Box2D[] = [
  { minX: -9.0, maxX: -6.2, minZ: -0.5, maxZ:  0.5 },  // 左侧横墙
  { minX:  6.2, maxX:  9.0, minZ: -0.5, maxZ:  0.5 },  // 右侧横墙
  { minX: -0.5, maxX:  0.5, minZ: -7.5, maxZ: -5.5 },  // 上侧纵墙
  { minX: -0.5, maxX:  0.5, minZ:  5.5, maxZ:  7.5 },  // 下侧纵墙
];

// 外墙 AABB（碰撞）
const OUTER_WALLS: Box2D[] = [
  { minX: -ARENA_W / 2 - 0.4, maxX: -ARENA_W / 2, minZ: -ARENA_D / 2, maxZ: ARENA_D / 2 },
  { minX:  ARENA_W / 2,       maxX:  ARENA_W / 2 + 0.4, minZ: -ARENA_D / 2, maxZ: ARENA_D / 2 },
  { minX: -ARENA_W / 2, maxX:  ARENA_W / 2, minZ: -ARENA_D / 2 - 0.4, maxZ: -ARENA_D / 2 },
  { minX: -ARENA_W / 2, maxX:  ARENA_W / 2, minZ:  ARENA_D / 2,       maxZ:  ARENA_D / 2 + 0.4 },
];

export const ALL_ARENA_WALLS: Box2D[] = [...OUTER_WALLS, ...PILLAR_DEFS, ...COVER_DEFS];

export const SPAWN_HOST = new THREE.Vector3(-9, 0, 0);
export const SPAWN_GUEST = new THREE.Vector3(9, 0, 0);

// 工具函数：圆 vs AABB 碰撞检测
export function circleOverlapsBox(cx: number, cz: number, r: number, b: Box2D): boolean {
  const nx = Math.max(b.minX, Math.min(cx, b.maxX));
  const nz = Math.max(b.minZ, Math.min(cz, b.maxZ));
  const dx = cx - nx, dz = cz - nz;
  return dx * dx + dz * dz < r * r;
}

export function resolveBoxCollision(cx: number, cz: number, r: number, b: Box2D): { x: number; z: number } {
  const nx = Math.max(b.minX, Math.min(cx, b.maxX));
  const nz = Math.max(b.minZ, Math.min(cz, b.maxZ));
  const dx = cx - nx, dz = cz - nz;
  const dist = Math.sqrt(dx * dx + dz * dz) || 1e-6;
  const pen = r - dist;
  return { x: cx + (dx / dist) * pen, z: cz + (dz / dist) * pen };
}

export class ArenaScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  container: HTMLElement;

  // 玩家相机挂载点
  yawObject: THREE.Object3D;
  pitchObject: THREE.Object3D;

  // 手电（作为枪口灯）
  flashlight: THREE.SpotLight;
  flashlightTarget: THREE.Object3D;

  // 对手 mesh（红色胶囊）
  remoteMesh!: THREE.Group;

  // 射线光束池
  private activeBeams: { mesh: THREE.Mesh; life: number; maxLife: number }[] = [];

  constructor(container: HTMLElement) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080c14);
    this.scene.fog = new THREE.FogExp2(0x080c14, 0.025);

    this.camera = new THREE.PerspectiveCamera(80, container.clientWidth / container.clientHeight, 0.05, 80);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // 相机绑定
    this.yawObject = new THREE.Object3D();
    this.pitchObject = new THREE.Object3D();
    this.yawObject.add(this.pitchObject);
    this.pitchObject.add(this.camera);
    this.scene.add(this.yawObject);

    // 手电枪口灯
    this.flashlight = new THREE.SpotLight(0x88ccff, 3.5, 18, Math.PI / 9, 0.35, 1.0);
    this.flashlightTarget = new THREE.Object3D();
    this.scene.add(this.flashlight);
    this.scene.add(this.flashlightTarget);
    this.flashlight.target = this.flashlightTarget;

    this._buildArena();
    this.remoteMesh = this._createRemoteMesh();
    this.scene.add(this.remoteMesh);

    window.addEventListener('resize', this._onResize);
  }

  private _onResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private _buildArena() {
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x0d1520, roughness: 0.95 });
    const wallMat  = new THREE.MeshStandardMaterial({ color: 0x1a2535, roughness: 0.85 });
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x263040, roughness: 0.7 });
    const coverMat  = new THREE.MeshStandardMaterial({ color: 0x2a2010, roughness: 0.8, metalness: 0.3 });
    const neonCyan  = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 1.8 });
    const neonRed   = new THREE.MeshStandardMaterial({ color: 0xff2244, emissive: 0xff2244, emissiveIntensity: 1.5 });

    // 地板
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W, ARENA_D), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 地板网格线（赛博风）
    const gridHelper = new THREE.GridHelper(Math.max(ARENA_W, ARENA_D), 24, 0x00e5ff, 0x0a1525);
    (gridHelper.material as THREE.LineBasicMaterial).opacity = 0.3;
    (gridHelper.material as THREE.LineBasicMaterial).transparent = true;
    this.scene.add(gridHelper);

    // 天花板
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x0a1020, emissive: 0x050810, emissiveIntensity: 0.4 });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W, ARENA_D), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = WALL_H;
    this.scene.add(ceil);

    // 四面外墙
    const wallConfigs: { w: number; d: number; x: number; z: number }[] = [
      { w: ARENA_W + 0.8, d: 0.4, x: 0, z: -ARENA_D / 2 },
      { w: ARENA_W + 0.8, d: 0.4, x: 0, z:  ARENA_D / 2 },
      { w: 0.4, d: ARENA_D, x: -ARENA_W / 2, z: 0 },
      { w: 0.4, d: ARENA_D, x:  ARENA_W / 2, z: 0 },
    ];
    for (const wc of wallConfigs) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(wc.w, WALL_H, wc.d), wallMat);
      mesh.position.set(wc.x, WALL_H / 2, wc.z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    // 霓虹灯条（蓝色：墙底部）
    for (const z of [-ARENA_D / 2 + 0.03, ARENA_D / 2 - 0.03]) {
      for (const y of [0.5, 2.5]) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(ARENA_W, 0.05, 0.04), neonCyan);
        s.position.set(0, y, z);
        this.scene.add(s);
      }
    }
    // 红色灯条（两侧墙）
    for (const x of [-ARENA_W / 2 + 0.03, ARENA_W / 2 - 0.03]) {
      for (const y of [1.5]) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, ARENA_D), neonRed);
        s.position.set(x, y, 0);
        this.scene.add(s);
      }
    }

    // 柱子（八边形棱柱）
    for (const p of PILLAR_DEFS) {
      const cx = (p.minX + p.maxX) / 2;
      const cz = (p.minZ + p.maxZ) / 2;
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, WALL_H, 8), pillarMat);
      mesh.position.set(cx, WALL_H / 2, cz);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
      // 霓虹环
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.035, 8, 20), neonCyan);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(cx, 1.2, cz);
      this.scene.add(ring);
    }

    // 掩体矮墙
    for (const b of COVER_DEFS) {
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const w = b.maxX - b.minX;
      const d = b.maxZ - b.minZ;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), coverMat);
      mesh.position.set(cx, 0.55, cz);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
      // 顶部装甲条
      const topStrip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.06, d + 0.05), neonCyan);
      topStrip.position.set(cx, 1.12, cz);
      this.scene.add(topStrip);
    }

    // 环境光 + 天花板网格灯
    this.scene.add(new THREE.AmbientLight(0x1a2844, 2.5));
    const ptColors = [0x00e5ff, 0xff2244, 0x00e5ff, 0xff2244];
    let ci = 0;
    for (let x = -6; x <= 6; x += 6) {
      for (let z = -5; z <= 5; z += 5) {
        const pl = new THREE.PointLight(ptColors[ci++ % 4], 1.2, 14);
        pl.position.set(x, WALL_H - 0.05, z);
        this.scene.add(pl);
      }
    }

    // 出生点地标
    const spawnMatHost  = new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 1.0 });
    const spawnMatGuest = new THREE.MeshStandardMaterial({ color: 0xff4455, emissive: 0xff4455, emissiveIntensity: 1.0 });
    const spawnGeom = new THREE.RingGeometry(0.45, 0.65, 16);
    const spA = new THREE.Mesh(spawnGeom, spawnMatHost);
    spA.rotation.x = -Math.PI / 2;
    spA.position.set(SPAWN_HOST.x, 0.01, SPAWN_HOST.z);
    this.scene.add(spA);
    const spB = new THREE.Mesh(spawnGeom, spawnMatGuest);
    spB.rotation.x = -Math.PI / 2;
    spB.position.set(SPAWN_GUEST.x, 0.01, SPAWN_GUEST.z);
    this.scene.add(spB);
  }

  private _createRemoteMesh(): THREE.Group {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcc2233, emissive: 0x440011 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xff4455 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.1, 10), bodyMat);
    body.position.y = 0.55;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), headMat);
    head.position.y = 1.42;
    g.add(head);
    // 枪管
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x667788 });
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.38, 6), gunMat);
    gun.rotation.x = Math.PI / 2;
    gun.position.set(0.25, 1.2, -0.28);
    g.add(gun);
    // 名字标签
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 32;
    const ctx2 = canvas.getContext('2d')!;
    ctx2.fillStyle = '#ff4455';
    ctx2.font = 'bold 20px sans-serif';
    ctx2.textAlign = 'center';
    ctx2.textBaseline = 'middle';
    ctx2.fillText('对手', 64, 16);
    const tex = new THREE.CanvasTexture(canvas);
    const labelMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const label = new THREE.Sprite(labelMat);
    label.scale.set(1.2, 0.3, 1);
    label.position.y = 1.9;
    g.add(label);
    g.visible = false;
    return g;
  }

  /** 更新对手玩家位置和朝向 */
  setRemotePlayer(x: number, y: number, z: number, yaw: number) {
    this.remoteMesh.visible = true;
    this.remoteMesh.position.set(x, y, z);
    this.remoteMesh.rotation.y = yaw;
  }

  hideRemotePlayer() {
    this.remoteMesh.visible = false;
  }

  /** 生成一道射线光束（蓝=自己，红=对手） */
  spawnBeam(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, isEnemy = false) {
    const len = 22;
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const mat = new THREE.MeshStandardMaterial({
      color: isEnemy ? 0xff2244 : 0x00ccff,
      emissive: isEnemy ? 0xff2244 : 0x00ccff,
      emissiveIntensity: 3,
      transparent: true,
      opacity: 1,
    });
    const geom = new THREE.CylinderGeometry(0.012, 0.012, len, 4);
    const mesh = new THREE.Mesh(geom, mat);
    const mid = new THREE.Vector3(ox + dir.x * len / 2, oy + dir.y * len / 2, oz + dir.z * len / 2);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.scene.add(mesh);
    this.activeBeams.push({ mesh, life: 0.12, maxLife: 0.12 });

    // 枪口闪光
    const flash = new THREE.PointLight(isEnemy ? 0xff2244 : 0x00ccff, 6, 4);
    flash.position.set(ox, oy, oz);
    this.scene.add(flash);
    setTimeout(() => this.scene.remove(flash), 70);
  }

  private _updateBeams(dt: number) {
    for (let i = this.activeBeams.length - 1; i >= 0; i--) {
      const b = this.activeBeams[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        (b.mesh.material as THREE.MeshStandardMaterial).dispose();
        b.mesh.geometry.dispose();
        this.activeBeams.splice(i, 1);
      } else {
        (b.mesh.material as THREE.MeshStandardMaterial).opacity = b.life / b.maxLife;
      }
    }
  }

  /** 每帧调用：更新动画+渲染 */
  render(dt: number) {
    this._updateBeams(dt);
    // 跟随相机更新手电
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    this.camera.getWorldPosition(camPos);
    this.camera.getWorldDirection(camDir);
    this.flashlight.position.copy(camPos);
    this.flashlightTarget.position.copy(camPos.clone().addScaledVector(camDir, 8));
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

export { PLAYER_RADIUS as ARENA_PLAYER_RADIUS };
