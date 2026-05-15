// FPS 输入：PointerLock 鼠标 + 键盘 + 触摸
import { isMobile } from './utils';

export interface InputState {
  moveX: number; moveY: number;   // [-1,1] 局部相对前向
  run: boolean;
  crouch: boolean;
  lookDX: number; lookDY: number; // 帧增量（弧度）
  interact: boolean;              // E
  flashlight: boolean;            // F (toggle)
  pause: boolean;                 // Esc
  jump: boolean;                  // 暂未用
}

export class InputManager {
  state: InputState = { moveX: 0, moveY: 0, run: false, crouch: false, lookDX: 0, lookDY: 0, interact: false, flashlight: false, pause: false, jump: false };
  private keys = new Set<string>();
  private dom: HTMLElement;
  isMobile = isMobile();

  // 一次性按键
  private pendingInteract = false;
  private pendingFlashlight = false;
  private pendingPause = false;
  private pendingJump = false;

  // PointerLock 状态
  pointerLocked = false;

  // 触摸（左半屏摇杆，右半屏视角）
  private joyId = -1; private joyStart = { x: 0, y: 0 }; private joyCur = { x: 0, y: 0 };
  private lookId = -1; private lookLast = { x: 0, y: 0 };
  private mobileRunHeld = false;
  private mobileCrouchHeld = false;
  private mobileJumpRequested = false;

  // 鼠标灵敏度
  sensitivity = 0.0022;

  constructor(dom: HTMLElement) {
    this.dom = dom;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onLockChange);
    dom.addEventListener('click', this.requestLock);
    dom.addEventListener('touchstart', this.onTouchStart, { passive: false });
    dom.addEventListener('touchmove', this.onTouchMove, { passive: false });
    dom.addEventListener('touchend', this.onTouchEnd, { passive: false });
    dom.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
    window.addEventListener('contextmenu', e => e.preventDefault());
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.dom.removeEventListener('click', this.requestLock);
    this.dom.removeEventListener('touchstart', this.onTouchStart);
    this.dom.removeEventListener('touchmove', this.onTouchMove);
    this.dom.removeEventListener('touchend', this.onTouchEnd);
    this.dom.removeEventListener('touchcancel', this.onTouchEnd);
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  private requestLock = () => {
    if (this.isMobile) return;
    if (document.pointerLockElement !== this.dom) {
      this.dom.requestPointerLock?.();
    }
  };

  private onLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.dom;
  };

  releaseLock() { if (document.pointerLockElement === this.dom) document.exitPointerLock(); }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'Escape') this.pendingPause = true;
    if (e.code === 'KeyE') this.pendingInteract = true;
    if (e.code === 'KeyF') this.pendingFlashlight = true;
    if (e.code === 'Space') { this.pendingJump = true; e.preventDefault?.(); }
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked) return;
    this.state.lookDX -= e.movementX * this.sensitivity;
    this.state.lookDY -= e.movementY * this.sensitivity;
  };

  // 触摸（移动端）
  private onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    const w = window.innerWidth;
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < w / 2 && this.joyId < 0) {
        this.joyId = t.identifier;
        this.joyStart = { x: t.clientX, y: t.clientY };
        this.joyCur = { x: t.clientX, y: t.clientY };
      } else if (t.clientX >= w / 2 && this.lookId < 0) {
        this.lookId = t.identifier;
        this.lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  };
  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.joyId) {
        this.joyCur = { x: t.clientX, y: t.clientY };
      } else if (t.identifier === this.lookId) {
        const dx = t.clientX - this.lookLast.x, dy = t.clientY - this.lookLast.y;
        this.lookLast = { x: t.clientX, y: t.clientY };
        this.state.lookDX -= dx * 0.005;
        this.state.lookDY -= dy * 0.005;
      }
    }
  };
  private onTouchEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.joyId) { this.joyId = -1; this.joyCur = this.joyStart; }
      if (t.identifier === this.lookId) this.lookId = -1;
    }
  };

  // 移动端按钮
  triggerInteract()  { this.pendingInteract = true; }
  triggerFlashlight(){ this.pendingFlashlight = true; }
  triggerPause()     { this.pendingPause = true; }
  triggerJump()      { this.pendingJump = true; }
  setMobileRun(v: boolean)    { this.mobileRunHeld = v; }
  setMobileCrouch(v: boolean) { this.mobileCrouchHeld = v; }

  poll(): InputState {
    const s = this.state;
    let kx = 0, ky = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft'))  kx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp'))    ky -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown'))  ky += 1;
    let tx = 0, ty = 0;
    if (this.joyId >= 0) {
      const dx = this.joyCur.x - this.joyStart.x, dy = this.joyCur.y - this.joyStart.y;
      const m = Math.hypot(dx, dy); const max = 80;
      if (m > 0) { const r = Math.min(1, m / max); tx = (dx / m) * r; ty = (dy / m) * r; }
    }
    s.moveX = kx + tx; s.moveY = ky + ty;
    if (s.moveX !== 0 || s.moveY !== 0) {
      const m = Math.hypot(s.moveX, s.moveY);
      if (m > 1) { s.moveX /= m; s.moveY /= m; }
    }
    s.run = this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.mobileRunHeld;
    s.crouch = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.keys.has('KeyC') || this.mobileCrouchHeld;
    s.interact   = this.pendingInteract;   this.pendingInteract = false;
    s.flashlight = this.pendingFlashlight; this.pendingFlashlight = false;
    s.pause      = this.pendingPause;      this.pendingPause = false;
    s.jump       = this.pendingJump;       this.pendingJump = false;

    const out: InputState = { ...s };
    s.lookDX = 0; s.lookDY = 0;
    return out;
  }

  getJoystick() {
    if (this.joyId < 0) return { active: false, baseX: 0, baseY: 0, dx: 0, dy: 0 };
    const dx = this.joyCur.x - this.joyStart.x, dy = this.joyCur.y - this.joyStart.y;
    const m = Math.hypot(dx, dy), max = 80;
    const r = m > max ? max / m : 1;
    return { active: true, baseX: this.joyStart.x, baseY: this.joyStart.y, dx: dx * r, dy: dy * r };
  }
}
