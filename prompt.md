# 《半夜偷玩手机》— 完整项目提示词

## 一、游戏概念（核心创意）

这是一个**元游戏（Meta-Game）**：

- 你是一个半夜偷偷躺在床上玩手机的孩子
- 手机屏幕上运行着一个2D潜行收集小游戏（控制绿色小球收集光球、躲避巡逻机器人）
- 但真正的挑战在**卧室层面**——深夜时分妈妈会随机来查房
- 当你察觉到妈妈来了（通过3D环境视觉变化），必须立刻放下手机装作睡觉
- 如果被妈妈发现你在玩手机，游戏结束
- 随着关卡推进，妈妈查房频率增加，巡逻机器人变多，房间变复杂

## 二、视觉架构（双层渲染）

### 外层：3D卧室场景（Three.js WebGL）
- **玩家视角**：躺在床上，头部在枕头位置，眼睛看向手中举着的手机
- **可交互**：鼠标/触摸拖动可以左右环顾房间（360°查看门、窗户、家具等）
- **房间尺寸**：6m(宽) × 5m(深) × 3m(高)
- **灯光基调**：深夜月光 + 手机屏幕发光 + 极暗环境

### 内层：2D手机游戏（Canvas 2D 渲染到 Three.js CanvasTexture）
- 手机屏幕是一个 3D BoxGeometry，屏幕使用 CanvasTexture 实时纹理
- 游戏分辨率：1024×1536（高清，确保大屏手机可见）
- 所有游戏元素（玩家、敌人、光球）同比放大，确保清晰可读
- 手电筒聚光灯效果：只有玩家小球周围有光照亮

## 三、3D场景详细规格

### 房间结构
- 木地板（带木纹线条），深色 #3a2e1e
- 四面墙壁 + 天花板 + 地板，墙角有踢脚线
- 前墙（门所在墙）：有完整的门洞和门框
- 左墙：大窗户（带窗框十字分隔 + 窗帘 + 滑轨）
- 右墙：完整墙面
- 后墙：带海报装饰

### 家具清单（完整3D模型）

| 家具 | 3D构成 | 位置 | 材质 |
|------|--------|------|------|
| 床 | Box(床架) + Box(床垫) + Box(枕头) + Box(被子) + Box(床头板) + 4圆柱(床腿) | 房间中央偏前 | 深木色/蓝色床垫/紫色被子 |
| 衣柜 | Box(主体) + 线条(门缝) + 2球体(把手) | 右后角 | 深木色 |
| 书桌 | Box(桌面) + 4圆柱(桌腿) | 右侧墙边 | 木色桌面 |
| 台灯 | 圆柱(底座) + 圆柱(灯颈) + Cone(灯罩) + PointLight | 书桌上 | 黑色底座/暖色灯罩 |
| 书架 | Box(主体) + 2线条(隔板) + 15个Box(不同颜色书) | 左后角 | 木色 |
| 海报 | Plane(画面) + Box(相框) | 后墙中央 | 蓝色画面 |
| 地毯 | Plane(大地毯) + Plane(小地毯) | 地板中央 | 紫色系 |
| 窗帘 | 2个Plane(左右窗帘) + Cylinder(滑轨) | 窗户两侧 | 深蓝色布料 |
| 床头柜 | Box(主体) + 球体(把手) | 床左侧 | 木色 |
| 闹钟 | Cylinder(外壳) + Circle(表盘) | 床头柜上 | 黑色外壳/发光表盘 |
| 垃圾桶 | Cylinder | 右墙边 | 灰色金属 |
| 鞋子 | 2个Box | 床尾 | 深色 |

### 门系统（铰链动画）
- 门轴在左侧（铰链侧）
- 门面板：Box + 4个面板凹陷细节 + 球体把手
- 动画：rotation.y 从 0 到 Math.PI * 0.5 平滑过渡

### 3D妈妈角色
- 头：Sphere（黑色，emissive红色微弱发光）+ Sphere发髻
- 身体：Cylinder（深紫色，收腰设计）
- 裙子：Cone（深紫色裙摆）
- 手臂：2个Cylinder（自然下垂）
- 腿：2个Cylinder + Box鞋子
- 眼睛：2个Sphere（红色 #ff0000，BasicMaterial强烈发光）
- 可选：正面 Billboard Plane 贴妈妈纹理图
- 动画：从走廊走向门口，再走进房间，lookAt始终朝向床

## 四、灯光系统（8个独立光源）

| 光源 | 类型 | 颜色 | 强度 | 位置 | 作用 |
|------|------|------|------|------|------|
| ambient | AmbientLight | #223366 | 0.3 | 全局 | 基础环境亮度 |
| moon | DirectionalLight | #88aaff | 0.6 | (-5,3,1) | 月光从窗户照入，投射阴影 |
| phone | PointLight | #ffffff | 1.2 | 跟随手机 | 手机屏幕照亮面部 |
| window | PointLight | #4466aa | 0.4 | (-2.5,1,-0.5) | 窗户蓝色氛围光 |
| corridor | PointLight | #ffaa44 | 动态 | (-2,1,4) | 走廊灯光从门下渗入 |
| redWarning | PointLight | #ff0000 | 动态 | (-1,1.5,2) | 妈妈预警红色脉冲光 |
| mom | PointLight | #ff0000 | 动态 | 跟随妈妈 | 妈妈自身红色发光 |
| lightning | PointLight | #aaaaff | 动态 | (-3,3,-1) | 闪电全屏闪光 |

## 五、妈妈检查系统

### 完整流程（6个阶段）

| 阶段 | 3D视觉表现 | 灯光变化 | 持续时间 |
|------|-----------|----------|----------|
| **IDLE**（安全期） | 门关着，房间安静 | 正常月光+手机光 | 8~18秒随机 |
| **APPROACHING**（远处接近） | 门缝下透出微弱走廊黄光 | corridorLight: 0→0.2，redWarning: 微弱脉冲0.1~0.5 | 1秒 |
| **AT_DOOR**（到门口） | 门慢慢打开(rotation.y: 0→0.25)，妈妈影子出现 | corridorLight: 0.6，redWarning: 脉冲0.6~1.0，phoneLight闪烁 | 0.5秒 |
| **PEEKING**（探头） | 妈妈头部出现在门缝，红色眼睛发光 | redWarning: 强脉冲1.0~1.5，momLight: 1.0 | 1秒 |
| **CHECKING**（进门检查） | 妈妈走进房间，站在床边观察 | redWarning: 最大1.5，corridorLight: 1.2，momLight: 2.0（最强） | 3.5秒 |
| **LEAVING**（离开） | 妈妈转身走回门口，门慢慢关闭 | 所有异常灯光逐渐消退 | 1.5秒 |

### 玩家反应机制
- **预警窗口**：从 AT_DOOR 到 ENTERING 之间有 **2.5秒** 反应时间
- **放下手机**
- **成功**：进入 SLEEPING → MOM_CHECKING → 妈妈离开后恢复 IDLE
- **失败**：2.5秒内未放下 → 妈妈走进来 → CAUGHT → 游戏结束

### 手机放下动画
- 起始：position(0, -0.15, 0.35), rotation(-0.8, 0, 0) — 手中举着
- 目标：position(0.6, -0.48, 0.7), rotation(-1.5, 0.5, 0.3) — 翻转放在床侧
- 过渡：smooth lerp，dt * 4 速度
- 屏幕：transitionProgress > 0.85 时隐藏屏幕内容
- 关键：**放下后手机完全不遮挡看向妈妈的视线**

## 六、天气系统

### 雨滴（室外）
- 1000个粒子，BufferGeometry + Points
- 属性：position（Float32Array）、velocity
- 每帧更新Y坐标（速度3~9），到底部重置到顶部
- 颜色：#8899cc，大小0.025，opacity 0.35，AdditiveBlending

### 闪电
- 随机触发概率：0.001/帧
- 持续：0.1~0.25秒
- 效果：lightningLight intensity 0→8，moonLight +3，ambientLight +0.6，windowLight +1
- 全房间瞬间变白再恢复

## 七、2D手机游戏机制

### 玩家
- 绿色发光小球，半径36px
- 物理：加速度1100，最大速度700，摩擦力0.92
- 视觉：径向渐变高光 + 绿色发光阴影，滚动时高光旋转

### 光球（收集物）
- 黄色发光小球，半径22px
- 呼吸动画：scale 0.8~1.2，周期1.5秒
- 收集效果：8个金色粒子向四周爆散

### 巡逻机器人（敌人）
- 灰色机器人，半径42px
- AI：水平/垂直来回巡逻，碰到墙壁/家具反弹
- 碰到即游戏结束 + 屏幕震动

### 家具障碍物
- 床(140×180)、衣柜(120×70)、书桌(160×90)
- 物理：AABB碰撞，贴墙滑动

### 关卡设计（10关）
基础参数（困难难度倍率前）：
| 关卡 | 光球 | 敌人 | 敌人速度 | 妈妈间隔 | 时限 | 障碍数 |
|------|------|------|----------|----------|------|--------|
| 1 | 5 | 0 | 0 | 15s | 60s | 2 |
| 2 | 8 | 1 | 100 | 12s | 60s | 3 |
| 3 | 10 | 2 | 120 | 10s | 70s | 4 |
| 4 | 12 | 3 | 130 | 10s | 80s | 5 |
| 5 | 15 | 3 | 150 | 8s | 90s | 5 |
| 6 | 15 | 3 | 140 | 9s | 90s | 6 |
| 7 | 18 | 4 | 180 | 8s | 80s | 6 |
| 8 | 20 | 5 | 140 | 7s | 100s | 7 |
| 9 | 20 | 5 | 160 | 5s | 90s | 7 |
| 10 | 25 | 6 | 200 | 6s | 120s | 8 |

### 难度倍率
| 难度 | 速度倍率 | 妈妈倍率 | 时限倍率 | 光球倍率 |
|------|----------|----------|----------|----------|
| 简单 | 0.6 | 1.5 | 1.5 | 0.7 |
| 普通 | 0.8 | 1.2 | 1.2 | 0.85 |
| 困难 | 1.0 | 1.0 | 1.0 | 1.0 |
| 噩梦 | 1.3 | 0.7 | 0.85 | 1.15 |
| 地狱 | 1.6 | 0.5 | 0.7 | 1.3 |

## 八、UI/HUD系统

### 游戏内HUD
- 左上角：第 X 关
- 顶部中央：✦ 收集进度 Y/Z
- 右上角：倒计时 MM:SS（最后10秒变红闪烁）
- 暂停按钮：右上角

### 妈妈预警时
- 无文字提示！
- 底部显示"放下手机装作睡觉"按钮（带呼吸脉冲动画）
- 空格键快捷操作

### 菜单画面
- 深色渐变背景 + 粒子效果
- 标题"半夜偷玩手机"（绿色发光呼吸）
- 5个难度选择按钮（彩色发光边框）
- 开始游戏 / 游戏教程 / 设置

### 游戏结束
- 妈妈抓到："被妈妈发现了！妈妈走进房间..."
- 敌人抓到："被巡逻机器人抓住了！"
- 时间到："时间到了！天快亮了..."

## 九、技术栈

### 前端
- React 18 + TypeScript + Vite
- Tailwind CSS（菜单UI）
- Three.js（3D场景渲染）
- HTML5 Canvas 2D（手机游戏画面）
- Web Audio API（音效播放）
- localStorage（存档：关卡进度、难度设置、音效开关）

### 3D渲染管线
```
每帧：
1. 用 Canvas 2D 渲染手机游戏画面到 off-screen canvas
2. 将 canvas 更新到 Three.js CanvasTexture
3. Three.js 渲染3D场景（卧室+手机+妈妈+天气+灯光）
4. requestAnimationFrame 循环
```

### 相机控制
- 默认角度：theta=0.3, phi=0.25（看向手机）
- 拖动：水平改变theta（环顾），垂直改变phi（抬头/低头）
- 限制：phi: [-0.5, 0.8]（不能看地板或天花板）
- 平滑：target angle + lerp 0.08 插值

## 十、完整资产清单

### AI生成图像
| 文件名 | 用途 | 格式 | 比例 | 透明背景 |
|--------|------|------|------|----------|
| enemy_robot.png | 巡逻敌人 | PNG | 1:1 | 是 |
| furniture_bed.png | 床铺障碍 | PNG | 3:2 | 是 |
| furniture_wardrobe.png | 衣柜障碍 | PNG | 2:3 | 是 |
| furniture_desk.png | 书桌障碍 | PNG | 3:2 | 是 |
| bedroom_view.jpg | 3D场景参考 | JPG | 9:16 | 否 |
| mom_full.png | 妈妈角色纹理 | PNG | 2:3 | 是 |
| mom_peek.png | 妈妈探头（旧版备用） | PNG | 1:1 | 是 |
| phone_frame.png | 手机边框 | PNG | 2:3 | 是 |
| window_rain.jpg | 窗外雨景 | JPG | 3:4 | 否 |
| wall_left.jpg | 墙面纹理 | JPG | 3:4 | 否 |
| corridor.jpg | 走廊纹理 | JPG | 1:1 | 否 |

### AI生成音效
| 文件名 | 用途 | 时长 |
|--------|------|------|
| sfx_collect.mp3 | 收集光球 | 0.5s |
| sfx_heartbeat.mp3 | 妈妈检查心跳 | 4s |
| sfx_door_creak.mp3 | 门开启声 | 3s |
| sfx_caught.mp3 | 被抓到 | 1.5s |
| sfx_click.mp3 | 按钮点击 | 0.5s |
| sfx_thunder.mp3 | 雷声 | 5s |
| sfx_lightning.mp3 | 闪电 | 3s |

## 十一、代码文件结构

```
src/
  App.tsx              — React主组件（状态机+UI覆盖层）
  App.css              — 完整样式（动画/响应式/特效）
  game/
    ThreeScene.ts      — Three.js 3D场景（卧室/手机/妈妈/天气/灯光）
    Game3DManager.ts   — 游戏逻辑整合（2D游戏+3D场景+妈妈状态机）
    constants.ts       — 所有游戏常量和关卡配置
    utils.ts           — 工具函数（存档/格式化/难度计算）
  types/
    game.ts            — TypeScript类型定义
  main.tsx             — React入口
  index.css            — Tailwind引入
```

## 十二、关键实现细节

### CanvasTexture 翻转修复
```typescript
const texture = new THREE.CanvasTexture(canvas);
texture.flipY = false; // 关键！确保渲染方向正确
```

### 妈妈状态机切换
```
IDLE → [countdown<=0] → MOM_WARNING
MOM_WARNING → [putDownPhone()] → SLEEPING → MOM_CHECKING
MOM_WARNING → [timer<=0] → CAUGHT (game over)
MOM_CHECKING → [timer<=0] → MOM_LEAVING → [timer<=0] → IDLE
```

### 灯光脉冲算法
```typescript
const pulse = 0.5 + Math.sin(performance.now() * frequency) * 0.5;
light.intensity = baseIntensity + pulse * amplitude;
// frequency: 0.006(远处) → 0.015(进门)
```

### 存档结构
```typescript
interface SaveData {
  levels: Record<number, { unlocked: boolean; completed: boolean; stars: 0|1|2|3; bestTime: number }>;
  currentDifficulty: 'easy'|'normal'|'hard'|'nightmare'|'hell';
  soundEnabled: boolean;
}
```