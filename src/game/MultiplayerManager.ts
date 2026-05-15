// 多人联机管理器：纯 WebRTC DataChannel，无需任何服务器
// 连接流程：
//   主机：createOffer() → 邀请码 → 粘贴对方回复码 → finalizeAnswer()
//   客机：acceptOffer(邀请码) → 回复码 → 等待连接建立（自动）

export type NetRole = 'host' | 'guest';

export type NetMsg =
  | { t: 'pos'; x: number; y: number; z: number; yaw: number; pitch: number }
  | { t: 'shot'; ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }
  | { t: 'hit'; dmg: number }
  | { t: 'die' }
  | { t: 'respawn'; x: number; z: number };

export interface MpCallbacks {
  onConnected: () => void;
  onDisconnected: () => void;
  onMessage: (msg: NetMsg) => void;
  onError: (err: string) => void;
}

// 混用国内外 STUN + TURN 中继（解决不同网络下 NAT 穿透失败问题）
const ICE_SERVERS: RTCIceServer[] = [
  // STUN（尽量用国内可达的）
  { urls: 'stun:stun.qq.com:3478' },
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // TURN 中继 — openrelay.metered.ca 免费公共服务器
  // turns: 走 TLS 443 端口，穿透严格防火墙能力最强
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:80?transport=tcp',
      'turns:openrelay.metered.ca:443',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

const ICE_TIMEOUT_MS = 6000;

export class MultiplayerManager {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  cb: MpCallbacks;
  role: NetRole | null = null;
  connected = false;

  constructor(cb: MpCallbacks) {
    this.cb = cb;
  }

  private _mkPC(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    return pc;
  }

  private _setupDC(dc: RTCDataChannel) {
    this.dc = dc;
    dc.onopen = () => { this.connected = true; this.cb.onConnected(); };
    dc.onclose = () => { this.connected = false; this.cb.onDisconnected(); };
    dc.onerror = (e) => this.cb.onError(String(e));
    dc.onmessage = (e) => {
      try { this.cb.onMessage(JSON.parse(e.data as string) as NetMsg); } catch { /* ignore */ }
    };
  }

  private _gatherSDP(pc: RTCPeerConnection): Promise<string> {
    return new Promise((resolve, reject) => {
      if (pc.iceGatheringState === 'complete' && pc.localDescription) {
        resolve(btoa(JSON.stringify(pc.localDescription.toJSON())));
        return;
      }
      const done = () => {
        if (pc.localDescription) resolve(btoa(JSON.stringify(pc.localDescription.toJSON())));
        else reject(new Error('无法获取本地描述，请刷新重试'));
      };
      const timer = setTimeout(done, ICE_TIMEOUT_MS);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') { clearTimeout(timer); done(); }
      };
    });
  }

  /** 主机第 1 步：生成邀请码（Base64 Offer SDP） */
  async createOffer(): Promise<string> {
    this.role = 'host';
    const pc = this._mkPC();
    const dc = pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 });
    this._setupDC(dc);
    await pc.setLocalDescription(await pc.createOffer());
    return this._gatherSDP(pc);
  }

  /** 客机：接受邀请码，生成回复码（Base64 Answer SDP） */
  async acceptOffer(offerB64: string): Promise<string> {
    this.role = 'guest';
    const pc = this._mkPC();
    pc.ondatachannel = (e) => this._setupDC(e.channel);
    const clean = offerB64.replace(/\s/g, '');
    const offer = JSON.parse(atob(clean)) as RTCSessionDescriptionInit;
    await pc.setRemoteDescription(offer);
    await pc.setLocalDescription(await pc.createAnswer());
    return this._gatherSDP(pc);
  }

  /** 主机第 2 步：接受回复码，握手完成（DataChannel open 后自动触发 onConnected） */
  async finalizeAnswer(answerB64: string): Promise<void> {
    // 剥除所有空白（微信/QQ 传输长字符串时可能插入换行）
    const clean = answerB64.replace(/\s/g, '');
    const answer = JSON.parse(atob(clean)) as RTCSessionDescriptionInit;
    await this.pc!.setRemoteDescription(answer);
  }

  send(msg: NetMsg) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(msg));
  }

  dispose() {
    try { this.dc?.close(); } catch { /* ignore */ }
    try { this.pc?.close(); } catch { /* ignore */ }
    this.dc = null;
    this.pc = null;
    this.connected = false;
  }
}
