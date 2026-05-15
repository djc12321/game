// ThreeScene: 第一人称潜行 FPS 场景
// 负责：房屋几何、墙体碰撞 AABB、收集物 mesh、妈妈模型/视野锥、手电筒、玩家相机
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ITEM_INFO, type ItemType, PLAYER_HEIGHT_STAND, PLAYER_HEIGHT_CROUCH } from './constants';

export interface AABB { minX: number; maxX: number; minZ: number; maxZ: number; }

export interface RoomDef {
  name: string;
  bounds: AABB;
}

export interface ItemSpawn {
  id: number;
  type: ItemType;
  pos: THREE.Vector3;
  mesh: THREE.Object3D;
  collected: boolean;
}

export interface MapData {
  walls: AABB[];                     // 用于玩家与妈妈的碰撞
  rooms: RoomDef[];                  // 用于刷新物品和导航分区
  patrolWaypoints: THREE.Vector3[];  // 妈妈巡逻路径点
  playerSpawn: THREE.Vector3;        // 玩家初始位置
  bedTrigger: AABB;                  // 玩家床触发区（胜利条件）
  size: { w: number; d: number };
  // 隐藏机制
  closets: { x: number; z: number }[];        // 衣柜中心点（可躲藏）
  catSpawn: { x: number; z: number };          // 猫初始位置
  catRoomBounds: AABB;                         // 猫游荡范围（客厅）
  clockPos: { x: number; z: number };          // 挂钟位置
  creakyFloors: { x: number; z: number }[];    // 吱呀地板中心点（不可见）
}

export interface MomVisual {
  group: THREE.Group;                  // 包含模型与视野锥
  model: THREE.Object3D;
  viewCone: THREE.Mesh;                // 视野锥可视化
  alertIcon: THREE.Sprite;             // ?/! 提示
  spotlight: THREE.SpotLight;          // 妈妈手电
  spotlightTarget: THREE.Object3D;
  mixer?: THREE.AnimationMixer;
  walkAction?: THREE.AnimationAction;
  idleAction?: THREE.AnimationAction;
}

const WALL_HEIGHT = 2.7;
const WALL_THICK = 0.18;
const DOOR_WIDTH = 1.7;

export class ThreeScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  container: HTMLElement;

  // 玩家头顶相机/朝向
  yawObject: THREE.Object3D;     // 控制 yaw（绕 Y）
  pitchObject: THREE.Object3D;   // 控制 pitch（绕 X）— 相机挂在它下面
  flashlight: THREE.SpotLight;
  flashlightTarget: THREE.Object3D;

  map!: MapData;
  itemSpawns: ItemSpawn[] = [];
  moms: MomVisual[] = [];
  private itemNextId = 1;
  private itemBobClock = 0;

  // 隐藏机制视觉
  catMesh!: THREE.Group;
  clockMesh!: THREE.Group;
  private clockGlowMat?: THREE.MeshStandardMaterial;

  // 浮动 ? / ! 贴图
  private alertTex!: THREE.Texture;
  private suspTex!: THREE.Texture;

  // 资源
  private momModelTemplate: THREE.Object3D | null = null;
  private momAnimations: THREE.AnimationClip[] = [];
  ready = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    // 偏蓝紫的夜色，但比之前亮不少，远雾推远
    this.scene.background = new THREE.Color(0x182238);
    this.scene.fog = new THREE.Fog(0x182238, 14, 42);

    this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.05, 100);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // 玩家相机层级
    this.yawObject = new THREE.Object3D();
    this.pitchObject = new THREE.Object3D();
    this.pitchObject.add(this.camera);
    this.yawObject.add(this.pitchObject);
    this.scene.add(this.yawObject);

    // 玩家手电筒
    this.flashlight = new THREE.SpotLight(0xfff5d6, 0, 16, Math.PI * 0.18, 0.45, 1.5);
    this.flashlight.castShadow = false;
    this.flashlightTarget = new THREE.Object3D();
    this.pitchObject.add(this.flashlight);
    this.pitchObject.add(this.flashlightTarget);
    this.flashlight.position.set(0.15, -0.05, 0);
    this.flashlightTarget.position.set(0.15, -0.05, -1);
    this.flashlight.target = this.flashlightTarget;

    // 全局环境光（夜晚但能看清场景）
    const amb = new THREE.AmbientLight(0x8090b0, 0.85);
    this.scene.add(amb);
    // 半球光让地面/天花板有冷暖差异
    const hemi = new THREE.HemisphereLight(0x9ab0d6, 0x2a2418, 0.55);
    this.scene.add(hemi);
    // 月光（强方向光）
    const moon = new THREE.DirectionalLight(0xb8cdf0, 0.85);
    moon.position.set(-8, 14, -6);
    this.scene.add(moon);

    this.alertTex = makeIconTexture('!', '#ff4040');
    this.suspTex  = makeIconTexture('?', '#fbbf24');

    window.addEventListener('resize', this.onResize);
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.scene.traverse(o => {
      const m = o as any;
      if (m.geometry) m.geometry.dispose?.();
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach((mt: any) => mt.dispose?.());
        else m.material.dispose?.();
      }
    });
  }

  private onResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  async loadAssets() {
    const loader = new GLTFLoader();
    try {
      const gltf = await loader.loadAsync('models/mom/Michelle.glb');
      this.momModelTemplate = gltf.scene;
      this.momAnimations = gltf.animations || [];
      this.momModelTemplate.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; }
      });
    } catch (e) {
      console.warn('Mom model failed to load, using placeholder', e);
    }
    this.ready = true;
  }

  // === 地图构建 ===
  buildMap(): MapData {
    const walls: AABB[] = [];
    const rooms: RoomDef[] = [];
    const W = 30, D = 24;
    const halfW = W / 2, halfD = D / 2;

    // 地板
    const floorGeo = new THREE.PlaneGeometry(W, D);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.95 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // 木地板纹路
    for (let i = 0; i < 12; i++) {
      const ln = new THREE.Mesh(
        new THREE.PlaneGeometry(W, 0.04),
        new THREE.MeshBasicMaterial({ color: 0x1a1612 })
      );
      ln.rotation.x = -Math.PI / 2;
      ln.position.set(0, 0.001, -halfD + i * 2);
      this.scene.add(ln);
    }

    // 天花板（仅作为深色面，避免向上看到外部）
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D),
      new THREE.MeshBasicMaterial({ color: 0x0a0a10 })
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = WALL_HEIGHT;
    this.scene.add(ceil);

    // 工具：建一段轴向墙（沿 X 或 Z）
    // axis 'x' 表示沿 x 方向延伸（z 固定），axis 'z' 反之
    const addWall = (axis: 'x' | 'z', fixed: number, from: number, to: number, doorAt?: number) => {
      if (from > to) [from, to] = [to, from];
      const segments: [number, number][] = [];
      if (doorAt !== undefined) {
        const dHalf = DOOR_WIDTH / 2;
        if (doorAt - dHalf > from) segments.push([from, doorAt - dHalf]);
        if (doorAt + dHalf < to)   segments.push([doorAt + dHalf, to]);
      } else {
        segments.push([from, to]);
      }
      for (const [a, b] of segments) {
        const len = b - a;
        const mid = (a + b) / 2;
        const geo = new THREE.BoxGeometry(
          axis === 'x' ? len : WALL_THICK,
          WALL_HEIGHT,
          axis === 'x' ? WALL_THICK : len
        );
        const mat = new THREE.MeshStandardMaterial({ color: 0x4a3f35, roughness: 0.85 });
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = false; m.receiveShadow = true;
        if (axis === 'x') m.position.set(mid, WALL_HEIGHT / 2, fixed);
        else              m.position.set(fixed, WALL_HEIGHT / 2, mid);
        this.scene.add(m);
        // AABB
        const half = WALL_THICK / 2;
        if (axis === 'x') walls.push({ minX: a, maxX: b, minZ: fixed - half, maxZ: fixed + half });
        else              walls.push({ minX: fixed - half, maxX: fixed + half, minZ: a, maxZ: b });
      }
    };

    // 外墙
    addWall('x', -halfD, -halfW, halfW);                                // 北
    addWall('x',  halfD, -halfW, halfW);                                // 南
    addWall('z', -halfW, -halfD, halfD);                                // 西
    addWall('z',  halfW, -halfD, halfD);                                // 东

    // 内墙：南北分隔（z=-2 与 z=2 形成走廊）
    // 上区水平内墙（z=-2）：玩家卧室门 在 x=-7.5；爸妈卧室门 在 x=7.5
    addWall('x', -2, -halfW, 0, -7.5);                                  // 上区西半段（含玩家卧室门）
    addWall('x', -2, 0, halfW, 7.5);                                    // 上区东半段（含爸妈卧室门）
    // 下区水平内墙（z=2）：客厅门 在 x=-7.5；厨房门 在 x=7.5
    addWall('x',  2, -halfW, 0, -7.5);
    addWall('x',  2, 0, halfW, 7.5);

    // 上区垂直分隔（x=0, z 在 [-12,-2]）
    addWall('z', 0, -halfD, -2);
    // 下区垂直分隔（x=0, z 在 [2,12]）
    addWall('z', 0, 2, halfD);

    // 房间定义（用于物品分布）
    rooms.push(
      { name: '玩家卧室', bounds: { minX: -halfW + 0.3, maxX: -0.3, minZ: -halfD + 0.3, maxZ: -2.3 } },
      { name: '爸妈卧室', bounds: { minX:  0.3,  maxX: halfW - 0.3, minZ: -halfD + 0.3, maxZ: -2.3 } },
      { name: '客厅',     bounds: { minX: -halfW + 0.3, maxX: -0.3, minZ:  2.3, maxZ: halfD - 0.3 } },
      { name: '厨房',     bounds: { minX:  0.3,  maxX: halfW - 0.3, minZ:  2.3, maxZ: halfD - 0.3 } },
      { name: '走廊',     bounds: { minX: -halfW + 0.3, maxX: halfW - 0.3, minZ: -1.7, maxZ: 1.7 } },
    );

    // 家具（也作为碰撞 AABB）
    const addFurniture = (
      x: number, z: number, w: number, d: number, h: number, color: number
    ) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
      );
      m.position.set(x, h / 2, z);
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
      walls.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    };

    // 玩家卧室：床（要让玩家爬过去）
    const bedX = -12, bedZ = -9;
    const bedW = 2.6, bedD = 1.4, bedH = 0.5;
    addFurniture(bedX, bedZ, bedW, bedD, bedH, 0x6b3a2a);
    // 床上的枕头/被子（只是装饰，无碰撞）
    const blanket = new THREE.Mesh(
      new THREE.BoxGeometry(bedW * 0.95, 0.15, bedD * 0.9),
      new THREE.MeshStandardMaterial({ color: 0x3b6ea6, roughness: 0.6 })
    );
    blanket.position.set(bedX, bedH + 0.07, bedZ + 0.05);
    this.scene.add(blanket);
    const pillow = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.15, 0.45),
      new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 })
    );
    pillow.position.set(bedX - bedW * 0.4 + 0.35, bedH + 0.15, bedZ - bedD * 0.25);
    this.scene.add(pillow);
    // 床触发：床附近 1.2m 区域
    const bedTrigger: AABB = {
      minX: bedX - bedW / 2 - 0.6, maxX: bedX + bedW / 2 + 0.6,
      minZ: bedZ - bedD / 2 - 0.6, maxZ: bedZ + bedD / 2 + 0.6,
    };
    // 床头柜
    addFurniture(bedX - bedW / 2 - 0.5, bedZ - 0.4, 0.7, 0.7, 0.55, 0x4a352a);
    // 衣柜
    addFurniture(-3, -10.5, 1.6, 0.6, 2.0, 0x3a2a20);
    // 书桌
    addFurniture(-7, -3.5, 1.8, 0.8, 0.85, 0x4a352a);

    // 爸妈卧室
    addFurniture(8, -9, 3.2, 1.8, 0.55, 0x5a3a2a);    // 大床
    addFurniture(13, -3.5, 1.8, 0.8, 0.85, 0x4a352a); // 梳妆台
    addFurniture(3, -10.5, 1.6, 0.6, 2.0, 0x3a2a20);  // 衣柜

    // 客厅
    addFurniture(-12, 5.5, 4.0, 1.0, 0.7, 0x4a4530);  // 沙发
    addFurniture(-12, 9, 2.4, 0.6, 0.5, 0x2a1f15);    // 电视柜
    addFurniture(-7, 7, 1.4, 1.4, 0.4, 0x6a5a3a);     // 茶几

    // 厨房
    addFurniture(3, 3.5, 0.8, 4.0, 0.9, 0x6a6a6a);    // 厨台
    addFurniture(13, 3.5, 0.8, 4.0, 0.9, 0x6a6a6a);   // 厨台
    addFurniture(8, 11, 4.0, 0.7, 0.9, 0x6a6a6a);     // 厨台
    addFurniture(13, 9, 0.7, 0.7, 1.6, 0x303030);     // 冰箱

    // === 各房间夜灯（暖光锚点，提亮+定位）===
    const addNightLamp = (x: number, z: number, color: number, intensity: number, range: number) => {
      const lamp = new THREE.PointLight(color, intensity, range, 1.6);
      lamp.position.set(x, 2.3, z);
      this.scene.add(lamp);
      // 灯罩小球
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 12, 8),
        new THREE.MeshBasicMaterial({ color })
      );
      bulb.position.set(x, 2.3, z);
      this.scene.add(bulb);
    };
    addNightLamp(-9, -7, 0xffd080, 1.0, 9);    // 玩家卧室小夜灯
    addNightLamp( 9, -7, 0xffe0a0, 0.9, 9);    // 爸妈卧室
    addNightLamp(-9,  7, 0x90c0ff, 1.4, 12);   // 客厅（电视蓝光）
    addNightLamp( 9,  7, 0xfff0c0, 1.2, 11);   // 厨房
    addNightLamp( 0,  0, 0xc0d0ff, 0.6, 10);   // 走廊（月光）

    // 月光通过窗户（在玩家卧室外侧投射柔光）
    const win1 = new THREE.PointLight(0xa8c4ff, 0.5, 10, 1.4);
    win1.position.set(-13, 1.6, -11.5); this.scene.add(win1);
    const win2 = new THREE.PointLight(0xa8c4ff, 0.5, 10, 1.4);
    win2.position.set( 13, 1.6,  11.5); this.scene.add(win2);

    // 巡逻路径点（妈妈在这些点之间巡逻）
    const patrolWaypoints = [
      new THREE.Vector3(-10, 0, 0),
      new THREE.Vector3( 10, 0, 0),
      new THREE.Vector3(  6, 0, 8),    // 厨房中央
      new THREE.Vector3( 12, 0,-7),    // 爸妈卧室
      new THREE.Vector3(-10, 0, 0),
      new THREE.Vector3(-12, 0, 7),    // 客厅
    ];

    // === 隐藏机制：可互动物体 ===
    // 衣柜/躲藏点中心（玩家卧室衣柜、爸妈卧室衣柜、客厅沙发后、厨房冰箱旁）
    const closets = [
      { x: -3,  z: -10.5 },  // 玩家卧室衣柜
      { x:  3,  z: -10.5 },  // 爸妈卧室衣柜
      { x: -12, z:   5.5 },  // 客厅沙发后
      { x: 13,  z:   9   },  // 厨房冰箱旁
    ];
    // 走廊中央挂钟（贴在内墙 z≈-2 上方）
    const clockPos = { x: 0, z: -1.95 };
    // 客厅猫（出生在沙发旁）
    const catSpawn = { x: -10, z: 6.5 };
    const catRoomBounds: AABB = { minX: -14, maxX: -1, minZ: 3, maxZ: 11 };

    // 生成吱呀地板（在房间内随机放置，避开家具中心）
    const creakyFloors: { x: number; z: number }[] = [];
    const allRooms = [rooms[0], rooms[1], rooms[2], rooms[3]];
    for (let i = 0; i < 6; i++) {
      const room = allRooms[i % allRooms.length];
      let placed = false;
      for (let tries = 0; tries < 10 && !placed; tries++) {
        const px = room.bounds.minX + 1 + Math.random() * (room.bounds.maxX - room.bounds.minX - 2);
        const pz = room.bounds.minZ + 1 + Math.random() * (room.bounds.maxZ - room.bounds.minZ - 2);
        // 不和墙/家具重叠
        let ok = true;
        for (const w of walls) {
          const cx = Math.max(w.minX, Math.min(px, w.maxX));
          const cz = Math.max(w.minZ, Math.min(pz, w.maxZ));
          if ((px - cx) ** 2 + (pz - cz) ** 2 < 0.7 * 0.7) { ok = false; break; }
        }
        if (ok) { creakyFloors.push({ x: px, z: pz }); placed = true; }
      }
    }

    // 渲染：挂钟（圆面贴在墙上）
    const clockGroup = new THREE.Group();
    const clockBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, 0.12, 24),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.5 })
    );
    clockBody.rotation.x = Math.PI / 2;
    const clockFace = new THREE.Mesh(
      new THREE.CircleGeometry(0.36, 24),
      new THREE.MeshStandardMaterial({ color: 0xf5e6c8, emissive: 0x8a7048, emissiveIntensity: 0.4 })
    );
    clockFace.position.z = 0.07;
    this.clockGlowMat = clockFace.material as THREE.MeshStandardMaterial;
    // 时针/分针
    const handMat = new THREE.MeshBasicMaterial({ color: 0x202020 });
    const hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.01), handMat);
    hourHand.position.set(0, 0.04, 0.08);
    const minHand = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.28, 0.01), handMat);
    minHand.position.set(0, 0.08, 0.08); minHand.rotation.z = Math.PI / 3;
    clockGroup.add(clockBody, clockFace, hourHand, minHand);
    clockGroup.position.set(clockPos.x, 1.9, clockPos.z);
    this.scene.add(clockGroup);
    this.clockMesh = clockGroup;

    // 渲染：流浪猫（橙色身体 + 三角耳 + 白尾尖）
    const cat = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.22, 0.22),
      new THREE.MeshStandardMaterial({ color: 0xd87a2c, roughness: 0.6 })
    );
    body.position.y = 0.18;
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.2, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xe89040, roughness: 0.6 })
    );
    head.position.set(0.27, 0.27, 0);
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.05, 0.05),
      new THREE.MeshStandardMaterial({ color: 0xd87a2c })
    );
    tail.position.set(-0.3, 0.27, 0); tail.rotation.z = 0.6;
    const ear1 = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 4),
      new THREE.MeshStandardMaterial({ color: 0xd87a2c }));
    ear1.position.set(0.32, 0.4, 0.06);
    const ear2 = ear1.clone(); ear2.position.z = -0.06;
    cat.add(body, head, tail, ear1, ear2);
    cat.position.set(catSpawn.x, 0, catSpawn.z);
    this.scene.add(cat);
    this.catMesh = cat;

    this.map = {
      walls, rooms, patrolWaypoints,
      playerSpawn: new THREE.Vector3(bedX, PLAYER_HEIGHT_STAND, bedZ + 1.0),
      bedTrigger,
      size: { w: W, d: D },
      closets, catSpawn, catRoomBounds, clockPos, creakyFloors,
    };
    return this.map;
  }

  // === 收集物 ===
  spawnItems(items: { type: ItemType; roomIndex: number }[]) {
    for (const it of items) {
      const room = this.map.rooms[it.roomIndex] ?? this.map.rooms[0];
      const pos = randomPointIn(room.bounds, 0.4);
      const info = ITEM_INFO[it.type];
      const grp = new THREE.Group();
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, 0.25, 0.25),
        new THREE.MeshStandardMaterial({
          color: info.color, emissive: info.color, emissiveIntensity: 0.7, metalness: 0.2, roughness: 0.4
        })
      );
      cube.castShadow = true;
      grp.add(cube);
      // 光晕
      const halo = new THREE.PointLight(info.color, 0.6, 2.5, 1.5);
      grp.add(halo);
      grp.position.set(pos.x, 0.5, pos.z);
      this.scene.add(grp);

      this.itemSpawns.push({
        id: this.itemNextId++,
        type: it.type,
        pos: grp.position.clone(),
        mesh: grp,
        collected: false
      });
    }
  }

  collectItem(id: number) {
    const it = this.itemSpawns.find(s => s.id === id);
    if (!it || it.collected) return;
    it.collected = true;
    this.scene.remove(it.mesh);
  }

  // === 妈妈 ===
  spawnMom(spawnPos: THREE.Vector3): MomVisual {
    const group = new THREE.Group();
    let model: THREE.Object3D;
    let mixer: THREE.AnimationMixer | undefined;
    let walkAction: THREE.AnimationAction | undefined;
    let idleAction: THREE.AnimationAction | undefined;
    if (this.momModelTemplate) {
      model = SkeletonUtils.clone(this.momModelTemplate);
      // Michelle 模型默认大小约为 1.7m，缩放到合适
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const scale = 1.75 / Math.max(size.y, 0.01);
      model.scale.setScalar(scale);
      // 重新对齐 y=0 在脚底
      const newBox = new THREE.Box3().setFromObject(model);
      model.position.y -= newBox.min.y;
      mixer = new THREE.AnimationMixer(model);
      // 找名字含 walk / idle 的剪辑，没有则用第一个
      const findClip = (kw: string) =>
        this.momAnimations.find(c => c.name.toLowerCase().includes(kw));
      const idleClip = findClip('idle') ?? this.momAnimations[0];
      const walkClip = findClip('walk') ?? findClip('run') ?? this.momAnimations[1] ?? idleClip;
      if (idleClip) { idleAction = mixer.clipAction(idleClip); idleAction.play(); }
      if (walkClip && walkClip !== idleClip) { walkAction = mixer.clipAction(walkClip); }
    } else {
      // 占位符：胶囊
      const m = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.3, 1.2, 4, 8),
        new THREE.MeshStandardMaterial({ color: 0xb04040 })
      );
      m.position.y = 0.9;
      model = m;
    }
    group.add(model);

    // 视野锥可视化（地面贴片）
    const coneGeo = new THREE.CircleGeometry(7, 28, -Math.PI / 4, Math.PI / 2);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xffd060, transparent: true, opacity: 0.18,
      side: THREE.DoubleSide, depthWrite: false
    });
    const viewCone = new THREE.Mesh(coneGeo, coneMat);
    viewCone.rotation.x = -Math.PI / 2;
    viewCone.position.y = 0.02;
    group.add(viewCone);

    // 妈妈手电（朝前）
    const spotlight = new THREE.SpotLight(0xfff0c0, 0, 12, Math.PI * 0.22, 0.4, 1.4);
    spotlight.position.set(0, 1.4, 0.0);
    const spotTarget = new THREE.Object3D();
    spotTarget.position.set(0, 1.0, -2);
    group.add(spotlight); group.add(spotTarget);
    spotlight.target = spotTarget;

    // 警觉图标
    const alertMat = new THREE.SpriteMaterial({ map: this.suspTex, transparent: true, depthTest: false });
    const alertIcon = new THREE.Sprite(alertMat);
    alertIcon.scale.set(0.6, 0.6, 0.6);
    alertIcon.position.set(0, 2.2, 0);
    alertIcon.visible = false;
    group.add(alertIcon);

    group.position.copy(spawnPos);
    this.scene.add(group);

    const mv: MomVisual = {
      group, model, viewCone, alertIcon, spotlight, spotlightTarget: spotTarget,
      mixer, walkAction, idleAction
    };
    this.moms.push(mv);
    return mv;
  }

  setMomViewCone(mv: MomVisual, viewDist: number, viewAngleHalfRad: number, alarmLevel: 0 | 1 | 2) {
    // 重建几何（视野距离/角度变化时调用）
    mv.viewCone.geometry.dispose();
    mv.viewCone.geometry = new THREE.CircleGeometry(viewDist, 32, -viewAngleHalfRad, viewAngleHalfRad * 2);
    const mat = mv.viewCone.material as THREE.MeshBasicMaterial;
    if (alarmLevel === 0)      { mat.color.set(0xffd060); mat.opacity = 0.14; }
    else if (alarmLevel === 1) { mat.color.set(0xffa040); mat.opacity = 0.30; }
    else                       { mat.color.set(0xff3030); mat.opacity = 0.42; }
  }

  setMomAlertIcon(mv: MomVisual, kind: 'none' | 'susp' | 'alert') {
    if (kind === 'none') { mv.alertIcon.visible = false; return; }
    mv.alertIcon.visible = true;
    (mv.alertIcon.material as THREE.SpriteMaterial).map = kind === 'alert' ? this.alertTex : this.suspTex;
    (mv.alertIcon.material as THREE.SpriteMaterial).needsUpdate = true;
  }

  setMomLight(mv: MomVisual, intensity: number) { mv.spotlight.intensity = intensity; }

  // === 玩家相机 ===
  applyLook(yaw: number, pitch: number) {
    this.yawObject.rotation.y = yaw;
    this.pitchObject.rotation.x = pitch;
  }

  setPlayerPos(x: number, z: number, height: number) {
    this.yawObject.position.set(x, height, z);
  }

  setFlashlight(on: boolean) {
    this.flashlight.intensity = on ? 4.5 : 0;
  }

  // === 隐藏机制可视化辅助 ===
  setCatPos(x: number, z: number, yaw: number) {
    if (!this.catMesh) return;
    this.catMesh.position.set(x, 0, z);
    this.catMesh.rotation.y = yaw;
  }
  setClockChiming(on: boolean) {
    if (this.clockGlowMat) {
      this.clockGlowMat.emissiveIntensity = on ? 1.6 : 0.4;
      this.clockGlowMat.emissive.setHex(on ? 0xffd070 : 0x8a7048);
    }
  }

  // 每帧更新动画与浮动
  update(dt: number) {
    this.itemBobClock += dt;
    for (const it of this.itemSpawns) {
      if (it.collected) continue;
      it.mesh.position.y = 0.5 + Math.sin(this.itemBobClock * 2 + it.id) * 0.08;
      it.mesh.rotation.y += dt * 1.2;
    }
    for (const mv of this.moms) {
      mv.mixer?.update(dt);
    }
  }

  render() { this.renderer.render(this.scene, this.camera); }
}

// === 工具 ===
function randomPointIn(b: AABB, pad = 0): { x: number; z: number } {
  const x = b.minX + pad + Math.random() * (b.maxX - b.minX - pad * 2);
  const z = b.minZ + pad + Math.random() * (b.maxZ - b.minZ - pad * 2);
  return { x, z };
}

function makeIconTexture(text: string, color: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, 128, 128);
  ctx.font = 'bold 110px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 8; ctx.strokeStyle = '#000';
  ctx.strokeText(text, 64, 70);
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

export { PLAYER_HEIGHT_STAND, PLAYER_HEIGHT_CROUCH };
