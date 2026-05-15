// 多人联机管理器：基于 PeerJS WebRTC P2P（无需服务器）
import { Peer } from 'peerjs';
import type { DataConnection } from 'peerjs';

export type NetRole = 'host' | 'guest';

/** 所有网络消息类型（精简编码以降低带宽） */
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

function genCode(): string {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

const PEER_PREFIX = 'msneak2024-';

export class MultiplayerManager {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  cb: MpCallbacks;
  role: NetRole | null = null;
  roomCode = '';
  connected = false;

  constructor(cb: MpCallbacks) {
    this.cb = cb;
  }

  /** 创建房间（主机方） */
  createRoom(onCode: (code: string) => void) {
    this.roomCode = genCode();
    this.role = 'host';
    this.peer = new Peer(PEER_PREFIX + this.roomCode);
    this.peer.on('open', () => onCode(this.roomCode));
    this.peer.on('connection', (conn) => {
      this.conn = conn;
      this._setup(conn, () => {
        this.connected = true;
        this.cb.onConnected();
      });
    });
    this.peer.on('error', (e) => this.cb.onError((e as Error).message ?? String(e)));
  }

  /** 加入房间（客户方） */
  joinRoom(code: string, onConnected: () => void) {
    this.roomCode = code.trim().toUpperCase();
    this.role = 'guest';
    this.peer = new Peer();
    this.peer.on('open', () => {
      const conn = this.peer!.connect(PEER_PREFIX + this.roomCode, { reliable: false, serialization: 'json' });
      this.conn = conn;
      this._setup(conn, () => {
        this.connected = true;
        onConnected();
        this.cb.onConnected();
      });
    });
    this.peer.on('error', (e) => this.cb.onError((e as Error).message ?? String(e)));
  }

  private _setup(conn: DataConnection, onOpen: () => void) {
    conn.on('open', onOpen);
    conn.on('data', (d) => this.cb.onMessage(d as NetMsg));
    conn.on('close', () => { this.connected = false; this.cb.onDisconnected(); });
    conn.on('error', (e) => this.cb.onError(String(e)));
  }

  send(msg: NetMsg) {
    if (this.conn?.open) this.conn.send(msg);
  }

  dispose() {
    this.conn?.close();
    this.peer?.destroy();
    this.conn = null;
    this.peer = null;
    this.connected = false;
  }
}
