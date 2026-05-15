import { useEffect, useRef, useState } from 'react';
import './App.css';
import { GameManager, type ManagerState } from './game/GameManager';
import {
  type Difficulty, type GameState,
  DIFFICULTY_LABELS, DIFFICULTY_COLORS, LEVELS, ITEM_INFO,
} from './game/constants';
import { loadSave, saveData, isMobile, fmtTime } from './game/utils';
import { audio } from './game/audio';
import { type InputManager } from './game/InputManager';
import { ArenaGame, type ArenaState } from './game/ArenaGame';
import { MultiplayerManager } from './game/MultiplayerManager';

export default function App() {
  const [save, setSave] = useState(loadSave);
  const [state, setState] = useState<GameState>('MENU');
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [mState, setMState] = useState<ManagerState | null>(null);
  const [endInfo, setEndInfo] = useState<{ kind: 'win' | 'lose'; reason?: string; score?: number; badges?: string[] } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<GameManager | null>(null);
  const mobile = isMobile();
  const [isPortrait, setIsPortrait] = useState(
    () => mobile && window.matchMedia('(orientation: portrait)').matches
  );
  const [dismissedPortrait, setDismissedPortrait] = useState(false);

  // ===== 多人竞技 =====
  const [arenaPhase, setArenaPhase] = useState<'none' | 'lobby' | 'playing' | 'ended'>('none');
  const [arenaIsHost, setArenaIsHost] = useState(false);
  const [arenaRoomCode, setArenaRoomCode] = useState('');
  const [arenaConnected, setArenaConnected] = useState(false);
  const [arenaError, setArenaError] = useState('');
  const [arenaSt, setArenaSt] = useState<ArenaState | null>(null);
  const [arenaEndInfo, setArenaEndInfo] = useState<{ won: boolean; myKills: number; enemyKills: number } | null>(null);
  const arenaGameRef = useRef<ArenaGame | null>(null);
  const netRef = useRef<MultiplayerManager | null>(null);
  const arenaContainerRef = useRef<HTMLDivElement>(null);

  // 监听屏幕方向变化
  useEffect(() => {
    if (!mobile) return;
    const mq = window.matchMedia('(orientation: portrait)');
    const handler = (e: MediaQueryListEvent) => setIsPortrait(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mobile]);

  useEffect(() => { audio.setEnabled(save.soundEnabled); }, [save.soundEnabled]);

  // 请求全屏并锁定横屏（移动端）— 必须同步调用以保留用户手势上下文
  function requestLandscapeFullscreen() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fs = (document.documentElement as any).requestFullscreen
      ?? (document.documentElement as any).webkitRequestFullscreen;
    if (fs) {
      (fs as () => Promise<void>)
        .call(document.documentElement)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then(() => (screen.orientation as any).lock?.('landscape-primary').catch?.(() => {}))
        .catch(() => {});
    }
  }

  function startGame(level: number, difficulty: Difficulty) {
    audio.init(); audio.resume();
    if (mobile) requestLandscapeFullscreen();
    setDismissedPortrait(false);  // 重置，新局再提示一次
    setSave(s => { const n = { ...s, difficulty }; saveData(n); return n; });
    setSelectedLevel(level);
    setEndInfo(null);
    setState('PLAYING');
    requestAnimationFrame(() => {
      if (!containerRef.current) return;
      managerRef.current?.dispose();
      managerRef.current = new GameManager(containerRef.current, level, difficulty, {
        onWin: (score, badges) => {
          setEndInfo({ kind: 'win', score, badges });
          setState('WIN');
          setSave(s => {
            const n = { ...s };
            n.highestLevel = Math.max(n.highestLevel, level + 1);
            n.bestScores[level] = Math.max(n.bestScores[level] ?? 0, score);
            saveData(n);
            return n;
          });
        },
        onLose: (reason) => { setEndInfo({ kind: 'lose', reason }); setState('LOSE'); },
        onState: (info) => setMState(info),
      });
    });
  }

  function exitToMenu() {
    managerRef.current?.dispose();
    managerRef.current = null;
    setState('MENU');
    setMState(null);
    if (mobile && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  useEffect(() => () => {
    managerRef.current?.dispose();
    arenaGameRef.current?.dispose();
    netRef.current?.dispose();
  }, []);

  // ===== 多人竞技函数 =====
  function openArenaLobby() {
    audio.click();
    setArenaPhase('lobby');
    setArenaConnected(false);
    setArenaRoomCode('');
    setArenaError('');
    setArenaIsHost(false);
  }

  async function doCreateOffer(): Promise<string> {
    setArenaError('');
    const net = new MultiplayerManager({
      onConnected: () => setArenaConnected(true),
      onDisconnected: () => { setArenaConnected(false); setArenaError('对手已断线'); },
      onMessage: () => {},
      onError: (e) => setArenaError(e),
    });
    netRef.current = net;
    setArenaIsHost(true);
    try {
      return await net.createOffer();
    } catch (e) {
      setArenaError(String(e));
      throw e;
    }
  }

  async function doAcceptOffer(b64: string): Promise<string> {
    setArenaError('');
    const net = new MultiplayerManager({
      onConnected: () => setArenaConnected(true),
      onDisconnected: () => { setArenaConnected(false); setArenaError('对手已断线'); },
      onMessage: () => {},
      onError: (e) => setArenaError(e),
    });
    netRef.current = net;
    setArenaIsHost(false);
    try {
      return await net.acceptOffer(b64);
    } catch (e) {
      setArenaError(String(e));
      throw e;
    }
  }

  function doFinalizeAnswer(b64: string) {
    netRef.current?.finalizeAnswer(b64).catch(e => setArenaError(String(e)));
  }

  function launchArena() {
    if (!netRef.current || !arenaContainerRef.current) return;
    if (mobile) requestLandscapeFullscreen();
    setDismissedPortrait(false);
    setArenaPhase('playing');
    requestAnimationFrame(() => {
      if (!arenaContainerRef.current || !netRef.current) return;
      arenaGameRef.current?.dispose();
      arenaGameRef.current = new ArenaGame(
        arenaContainerRef.current,
        netRef.current,
        {
          onState: (s) => setArenaSt(s),
          onEnd: (won, myKills, enemyKills) => {
            setArenaEndInfo({ won, myKills, enemyKills });
            setArenaPhase('ended');
          },
        },
        arenaIsHost,
      );
    });
  }

  function exitArena() {
    arenaGameRef.current?.dispose();
    arenaGameRef.current = null;
    netRef.current?.dispose();
    netRef.current = null;
    setArenaPhase('none');
    setArenaConnected(false);
    setArenaRoomCode('');
    setArenaError('');
    setArenaSt(null);
    setArenaEndInfo(null);
    if (mobile && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  const inArena = arenaPhase !== 'none';

  const inGame = state === 'PLAYING' || state === 'PAUSED' || state === 'WIN' || state === 'LOSE';

  return (
    <div className="app">
      {/* 移动端竖屏提示 */}
      {mobile && isPortrait && (inGame || arenaPhase === 'playing') && !dismissedPortrait && (
        <div className="portrait-overlay">
          <div className="portrait-icon">📱</div>
          <div className="portrait-text">建议横屏游玩<br /><span>体验更佳</span></div>
          <button className="portrait-dismiss" onClick={() => setDismissedPortrait(true)}>我知道了，继续</button>
        </div>
      )}

      {/* ====== 菜单 ====== */}
      {state === 'MENU' && !inArena && (
        <div className="menu">
          <h1 className="menu-title">深夜潜行</h1>
          <div className="menu-sub">— Midnight Sneak FPS —</div>
          <p className="menu-blurb">深夜偷溜出房间收集战利品（漫画/零食/游戏卡带），别被巡逻的妈妈发现，最后回到自己床上。</p>

          <div className="diff-row-label">选择难度</div>
          <div className="diff-row">
            {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map(d => (
              <button key={d}
                className={`diff-btn ${save.difficulty === d ? 'active' : ''}`}
                style={{ color: DIFFICULTY_COLORS[d], borderColor: DIFFICULTY_COLORS[d] }}
                onClick={() => { audio.click(); setSave(s => { const n = { ...s, difficulty: d }; saveData(n); return n; }); }}>
                {DIFFICULTY_LABELS[d]}
              </button>
            ))}
          </div>

          <div className="diff-row-label">选择关卡（已通关 {Math.max(0, save.highestLevel - 1)} 关）</div>
          <div className="level-row">
            {LEVELS.map(lv => {
              const unlocked = lv.level <= save.highestLevel;
              return (
                <button key={lv.level}
                  className={`level-btn ${unlocked ? 'unlocked' : ''} ${selectedLevel === lv.level ? 'sel' : ''}`}
                  disabled={!unlocked}
                  onClick={() => { audio.click(); setSelectedLevel(lv.level); }}>
                  {lv.level}
                </button>
              );
            })}
          </div>

          <div className="menu-btns">
            <button className="menu-btn" onClick={() => { audio.click(); startGame(selectedLevel, save.difficulty); }}>
              ▶ 开始（第 {selectedLevel} 关 · {DIFFICULTY_LABELS[save.difficulty]}）
            </button>
            <button className="menu-btn arena-entry" onClick={openArenaLobby}>
              ⚔️ 多人竞技对枪
            </button>
            <button className="menu-btn secondary" onClick={() => { audio.click(); setShowTutorial(true); }}>📖 操作说明</button>
            <button className="menu-btn secondary" onClick={() => {
              setSave(s => { const n = { ...s, soundEnabled: !s.soundEnabled }; saveData(n); return n; });
            }}>🔊 音效：{save.soundEnabled ? '开' : '关'}</button>
          </div>

          {showTutorial && <TutorialModal onClose={() => setShowTutorial(false)} mobile={mobile} />}
        </div>
      )}

      {/* ====== 游戏 ====== */}
      {inGame && (
        <div className="game-root">
          <div className="three-container" ref={containerRef} />

          {mState && (
            <>
              {/* 顶部状态栏 */}
              <div className="hud-top">
                <div className="left">
                  <span className="label">第</span><span className="value">{selectedLevel}</span><span className="label">关</span>
                  <span className="label" style={{ marginLeft: 14 }}>📦</span>
                  <span className="value">{mState.itemsCollected}/{mState.itemsToCollect}</span>
                  {mState.currentRoomName && (
                    <span className="room-name">📍 {mState.currentRoomName}</span>
                  )}
                </div>
                <div className="right">
                  <span className="label">⏱</span>
                  <span className="value" style={{ color: mState.timeLeft < 30 ? '#ff4040' : undefined }}>
                    {fmtTime(mState.timeLeft)}
                  </span>
                  <button className="icon-btn" onClick={() => managerRef.current?.togglePause()}>⏸</button>
                  <button className="icon-btn" onClick={exitToMenu}>✕</button>
                </div>
              </div>

              {/* 全局警戒指示 */}
              <div className={`alarm-banner alarm-${mState.maxAlarm}`}>
                {mState.maxAlarm === 0 && '😴 安全'}
                {mState.maxAlarm === 1 && '👀 妈妈起疑'}
                {mState.maxAlarm === 2 && '🚨 被发现！快躲！'}
                <div className="susp-bar-bg">
                  <div className="susp-bar-fill" style={{
                    width: `${mState.maxSuspicion}%`,
                    background: mState.maxAlarm === 2 ? '#ef4444' : mState.maxAlarm === 1 ? '#f97316' : '#4ade80'
                  }} />
                </div>
              </div>

              {/* 准星 */}
              <div className="crosshair">+</div>

              {/* 姿态 / 噪音 */}
              <div className="stance-hud">
                <div className="stance-pill">
                  {mState.stance === 'CROUCH' ? '🦆 蹲行' : mState.isRunning ? '🏃 跑步' : '🚶 走路'}
                </div>
                <div className="noise-pill" title="妈妈的听觉范围">
                  🔊 噪音 {mState.noiseRadius.toFixed(1)}m
                </div>
                {mState.flashlightOn && <div className="noise-pill light">🔦 手电</div>}
              </div>

              {/* 体力条 */}
              <div className="stamina-bar-wrap" title="体力（跑步消耗，蹲行恢复最快）">
                <span className="stamina-label">⚡</span>
                <div className="stamina-track">
                  <div className="stamina-fill"
                    style={{
                      width: `${mState.stamina}%`,
                      background: mState.stamina < 25 ? '#ef4444'
                                : mState.stamina < 55 ? '#f97316'
                                : '#4ade80',
                    }}
                  />
                </div>
              </div>

              {/* 拾取提示 */}
              {mState.nearbyItem && (
                <div className="interact-hint">
                  按 [<b>E</b>] 拾取 {mState.nearbyItem.emoji} {mState.nearbyItem.name}
                </div>
              )}

              {/* === 隐藏机制 HUD === */}
              {/* 钟声进度 / 倒计时 */}
              <div className={`clock-hud ${mState.clockChiming ? 'chiming' : ''}`}>
                {mState.clockChiming
                  ? <>🕐 <b>钟声中</b> · 妈妈听不见你（{(mState.clockNextIn).toFixed(1)}s）</>
                  : <>🕐 下次钟声：{Math.max(0, Math.ceil(mState.clockNextIn - 0)) }s</>
                }
              </div>
              {/* 衣柜提示 */}
              {!mState.hidden && mState.nearbyHideSpot && (
                <div className="interact-hint hint-hide">按 [<b>E</b>] 钻进衣柜躲藏 🚪</div>
              )}
              {/* 撸猫提示 */}
              {mState.nearbyCatPet && (
                <div className="interact-hint hint-cat">蹲着按 [<b>E</b>] 撸猫 🐱（+{200}）</div>
              )}
              {/* 吱呀地板瞬时警示 */}
              {mState.creakNotice > 0.05 && (
                <div className="creak-flash" style={{ opacity: mState.creakNotice }}>
                  🪵 吱呀！— 一块旧地板响了
                </div>
              )}
              {/* 衣柜中：暗角遮罩 */}
              {mState.hidden && (
                <>
                  <div className="hide-overlay" />
                  <div className="hide-hint">🚪 你藏在衣柜里 — 按 [<b>E</b>] 出来</div>
                </>
              )}

              {/* 床上完成提示 */}
              {mState.canFinish && (
                <div className={`finish-hint ${mState.inBedZone ? 'in-bed' : ''}`}>
                  {mState.inBedZone ? '🛏️ 已回到床上 — 通关！' : '🛏️ 回到自己卧室的床边完成关卡'}
                </div>
              )}

              {/* PointerLock 提示 */}
              {!mobile && !mState.pointerLocked && state === 'PLAYING' && !mState.paused && (
                <div className="lock-hint">
                  <div>🖥️ 点击画面开始<br /><b>WASD</b> 移动 · <b>鼠标</b>看 · <b>Ctrl</b>跑 · <b>Shift</b>蹲 · <b>空格</b>跳 · <b>E</b>拾取 · <b>F</b>手电 · <b>Esc</b>暂停</div>
                </div>
              )}

              {/* 控制提示（角落）*/}
              {!mobile && mState.pointerLocked && (
                <div className="controls-hint">
                  <b>WASD</b> 移动 · <b>Ctrl</b> 跑 · <b>Shift</b> 蹲 · <b>空格</b> 跳 · <b>E</b> 拾取 · <b>F</b> 手电 · <b>Esc</b> 暂停
                </div>
              )}

              {/* 小地图 */}
              <Minimap st={mState} />

              {/* 移动端控件 + 虚拟摇杆 */}
              {mobile && (
                <>
                  <MobileJoystick input={managerRef.current?.input} />
                  <MobileControls input={managerRef.current?.input} />
                </>
              )}
            </>
          )}

          {mState?.paused && (
            <div className="modal">
              <h2>⏸ 已暂停</h2>
              <button className="menu-btn" onClick={() => managerRef.current?.togglePause()}>继续游戏</button>
              <button className="menu-btn secondary" style={{ marginTop: 12 }} onClick={exitToMenu}>退出关卡</button>
            </div>
          )}

          {state === 'WIN' && endInfo?.kind === 'win' && (
            <div className="modal">
              <h2 style={{ color: '#4ade80' }}>🎉 顺利潜回床上！</h2>
              <p>得分：<b style={{ color: '#fbbf24' }}>{endInfo.score}</b></p>
              {endInfo.badges && endInfo.badges.length > 0 && (
                <div className="badges-row">
                  {endInfo.badges.includes('ghost')     && <div className="badge ghost">👻 幽灵潜行 · +1500</div>}
                  {endInfo.badges.includes('catfriend') && <div className="badge cat">🐱 猫咪挚友 · +200</div>}
                </div>
              )}
              <button className="menu-btn" onClick={() => {
                if (selectedLevel < LEVELS.length) startGame(selectedLevel + 1, save.difficulty);
                else exitToMenu();
              }}>
                {selectedLevel < LEVELS.length ? `下一关（第 ${selectedLevel + 1} 关）` : '回到菜单'}
              </button>
              <button className="menu-btn secondary" style={{ marginTop: 12 }} onClick={exitToMenu}>返回菜单</button>
            </div>
          )}

          {state === 'LOSE' && endInfo?.kind === 'lose' && (
            <div className="modal">
              <h2 style={{ color: '#ef4444' }}>💀 被发现了！</h2>
              <p>{endInfo.reason === 'caught_mom' ? '"我就知道你又偷偷跑出来！"妈妈一把抓住了你。'
                  : '⏰ 天快亮了…明天没法上学了。'}</p>
              <button className="menu-btn" onClick={() => startGame(selectedLevel, save.difficulty)}>重试</button>
              <button className="menu-btn secondary" style={{ marginTop: 12 }} onClick={exitToMenu}>返回菜单</button>
            </div>
          )}
        </div>
      )}

      {/* ====== 多人竞技大厅 ====== */}
      {inArena && arenaPhase === 'lobby' && (
        <ArenaLobby
          connected={arenaConnected}
          error={arenaError}
          onCreateOffer={doCreateOffer}
          onAcceptOffer={doAcceptOffer}
          onFinalizeAnswer={doFinalizeAnswer}
          onLaunch={launchArena}
          onBack={exitArena}
        />
      )}

      {/* ====== 竞技场游戏 ====== */}
      {(arenaPhase === 'playing' || arenaPhase === 'ended') && (
        <div className="game-root">
          <div className="three-container" ref={arenaContainerRef} />

          {arenaSt && arenaPhase === 'playing' && (
            <>
              {/* 准星 */}
              <div className={`arena-crosshair ${arenaSt.hitmarker > 0 ? 'hit' : ''}`}>+</div>
              {/* 受击红屏 */}
              {arenaSt.hitFlash > 0.05 && (
                <div className="arena-hit-overlay" style={{ opacity: arenaSt.hitFlash * 0.55 }} />
              )}
              {/* 顶部比分 */}
              <div className="arena-scoreboard">
                <div className="arena-score mine">🟢 {arenaSt.myKills}</div>
                <div className="arena-timer" style={{ color: arenaSt.timeLeft < 30 ? '#ef4444' : undefined }}>
                  ⏱ {fmtTime(arenaSt.timeLeft)}
                </div>
                <div className="arena-score enemy">🔴 {arenaSt.enemyKills}</div>
              </div>
              {/* 底部状态：HP + 弹药 */}
              <div className="arena-bottom-hud">
                <div className="arena-hp-wrap">
                  <span className="arena-hp-label">❤️</span>
                  <div className="arena-hp-track">
                    <div className="arena-hp-fill" style={{
                      width: `${arenaSt.hp}%`,
                      background: arenaSt.hp < 30 ? '#ef4444' : arenaSt.hp < 60 ? '#f97316' : '#4ade80',
                    }} />
                  </div>
                  <span className="arena-hp-num">{arenaSt.hp}</span>
                </div>
                <div className="arena-ammo-wrap">
                  {arenaSt.reloading ? (
                    <div className="arena-reload-bar">
                      <div className="arena-reload-fill" style={{ width: `${arenaSt.reloadPct * 100}%` }} />
                      <span>换弹中…</span>
                    </div>
                  ) : (
                    <div className="arena-ammo">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className={`arena-bullet ${i < arenaSt.ammo ? 'full' : 'empty'}`} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {/* 死亡复活提示 */}
              {!arenaSt.isAlive && (
                <div className="arena-dead-overlay">
                  <div className="arena-dead-text">💀 阵亡</div>
                  <div className="arena-dead-sub">{Math.ceil(arenaSt.respawnT)}s 后复活</div>
                </div>
              )}
              {/* PointerLock 提示 */}
              {!mobile && !arenaSt.pointerLocked && (
                <div className="lock-hint">
                  <div>🖥️ 点击画面开始<br /><b>WASD</b> 移动 · <b>鼠标移动</b>视角 · <b>鼠标左键</b>射击 · <b>R/E</b>换弹 · <b>Ctrl</b>跑步</div>
                </div>
              )}
              {/* 控制提示 */}
              {!mobile && arenaSt.pointerLocked && (
                <div className="controls-hint">
                  <b>鼠标左键</b>射击 · <b>R/E</b>换弹 · <b>WASD</b>移动 · <b>Ctrl</b>跑 · <b>Esc</b>释放鼠标
                </div>
              )}
            </>
          )}

          {arenaPhase === 'ended' && arenaEndInfo && (
            <div className="modal">
              <h2 style={{ color: arenaEndInfo.won ? '#4ade80' : '#ef4444' }}>
                {arenaEndInfo.won ? '🏆 你赢了！' : '💀 对手获胜'}
              </h2>
              <p style={{ fontSize: '1.2em' }}>
                <span style={{ color: '#4ade80' }}>你的击杀：{arenaEndInfo.myKills}</span>
                {'　vs　'}
                <span style={{ color: '#ef4444' }}>对手击杀：{arenaEndInfo.enemyKills}</span>
              </p>
              <button className="menu-btn" onClick={launchArena} style={{ marginBottom: 10 }}>
                🔄 再来一局
              </button>
              <button className="menu-btn secondary" onClick={exitArena}>返回菜单</button>
            </div>
          )}

          {/* 退出按钮 */}
          {arenaPhase === 'playing' && (
            <button className="arena-exit-btn" onClick={exitArena} title="退出竞技场">✕</button>
          )}
        </div>
      )}
    </div>
  );
}

// ===== 虚拟摇杆 =====
function MobileJoystick({ input }: { input: InputManager | null | undefined }) {
  const [joy, setJoy] = useState({ active: false, baseX: 0, baseY: 0, dx: 0, dy: 0 });

  useEffect(() => {
    if (!input) return;
    let rafId: number;
    const poll = () => { setJoy(input.getJoystick()); rafId = requestAnimationFrame(poll); };
    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [input]);

  if (!joy.active) return null;
  return (
    <div className="joystick-wrap" style={{ left: joy.baseX, top: joy.baseY }}>
      <div className="joystick-base" />
      <div className="joystick-thumb" style={{ transform: `translate(${joy.dx}px, ${joy.dy}px)` }} />
    </div>
  );
}

// ===== 移动端控件 =====
function MobileControls({ input }: { input: any }) {
  return (
    <>
      <button className="m-btn m-run"
        onTouchStart={e => { e.preventDefault(); input?.setMobileRun(true); }}
        onTouchEnd={e => { e.preventDefault(); input?.setMobileRun(false); }}>跑</button>
      <button className="m-btn m-crouch"
        onTouchStart={e => { e.preventDefault(); input?.setMobileCrouch(true); }}
        onTouchEnd={e => { e.preventDefault(); input?.setMobileCrouch(false); }}>蹲</button>
      <button className="m-btn m-jump" onClick={() => input?.triggerJump()}>跳</button>
      <button className="m-btn m-act" onClick={() => input?.triggerInteract()}>E</button>
      <button className="m-btn m-light" onClick={() => input?.triggerFlashlight()}>🔦</button>
    </>
  );
}

// ===== 教程 =====
function TutorialModal({ onClose, mobile }: { onClose: () => void; mobile: boolean }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="tutorial" onClick={e => e.stopPropagation()}>
        <h2>📖 操作说明</h2>
        <h3>🎯 目标</h3>
        <p>趁妈妈睡前最后一轮巡逻，溜出房间收集足够的战利品（漫画书、零食、游戏卡带等），然后<b>回到自己卧室的床上</b>结束关卡。</p>
        <h3>🎮 操作（{mobile ? '移动端' : '电脑端'}）</h3>
        {mobile ? (
          <p>
            <code>左半屏</code> 拖动 = 移动（虚拟摇杆）<br />
            <code>右半屏</code> 拖动 = 视角<br />
            <code>跑</code>/<code>蹲</code>/<code>E</code>/<code>🔦</code> 按钮分别对应跑步、蹲下、拾取、手电
          </p>
        ) : (
          <p>
            <code>WASD</code> 移动 · <code>鼠标</code>看 (点画面进入鼠标锁定)<br />
            <code>Ctrl</code> 跑步（噪音大）· <code>Shift</code> 蹲下（无声）<br />
            <code>空格</code> 跳跃（落地会出声）· <code>E</code> 拾取 · <code>F</code> 手电筒（会暴露位置）<br />
            <code>Esc</code> 暂停 / 释放鼠标
          </p>
        )}
        <h3>👁 妈妈的侦测</h3>
        <p>
          <b>视野锥</b>（地上黄色扇形）：被照到 = 怀疑度上升，进入视线 = 极快被发现<br />
          <b>听觉</b>：跑步=9米噪音、走路=4米、<b>蹲行=完全无声</b><br />
          <b>视线遮挡</b>：墙体和家具会挡住妈妈视线，绕背包抄是关键<br />
          <b>手电筒</b>：很方便但会立刻被妈妈看到，谨慎使用
        </p>
        <h3>🧠 妈妈状态</h3>
        <p>
          🟡 <b>巡逻</b>：在房子内固定路线巡游 — 安全<br />
          🟠 <b>调查</b>：听到声音/瞥见你 — 走向可疑位置查看，原地张望<br />
          🔴 <b>追逐</b>：发现你了 — 高速冲过来，被抓住 = Game Over
        </p>
        <h3>💡 物品</h3>
        <p>
          {(['manga','snack','cola','charger','headphone','cartridge','battery','controller'] as const).map(t => (
            <span key={t} style={{ marginRight: 10 }}>{ITEM_INFO[t].emoji} {ITEM_INFO[t].name}</span>
          ))}
        </p>
        <h3>⭐ 评分</h3>
        <p>每件物品 100 分 + 时间奖励（剩余每秒 5 分）+ 潜行奖励（妈妈怀疑度始终低于 30 → +500）</p>
        <h3>🤫 隐藏机制（自己摸索更有趣！）</h3>
        <p>
          🐱 客厅有只<b>橘猫</b>，撞到它会"喵！"惊动妈妈；蹲着按 E 撸它 → 加分且变成跟班<br />
          🪵 房间里随机藏着<b>吱呀地板</b>，站着踩到会响 — 蹲行经过则无声<br />
          🕐 走廊有<b>挂钟</b>，每 50 秒响 4 秒，钟声中妈妈"耳聋"且呆立<br />
          🚪 4 个<b>衣柜/沙发后</b>可按 E 钻进去躲藏，妈妈完全无视你<br />
          👻 全程怀疑度 &lt; 15、不开手电、不踩吱呀板 → <b>幽灵潜行</b>称号 +1500
        </p>
        <button className="menu-btn" style={{ marginTop: 16 }} onClick={onClose}>知道了！</button>
      </div>
    </div>
  );
}

// ===== 小地图 =====
function Minimap({ st }: { st: ManagerState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const W = c.width, H = c.height;
    const mapW = st.mapW, mapD = st.mapD;
    const sx = W / mapW, sz = H / mapD;
    const toX = (x: number) => (x + mapW / 2) * sx;
    const toZ = (z: number) => (z + mapD / 2) * sz;

    // 背景
    ctx.fillStyle = 'rgba(15,18,30,0.85)';
    ctx.fillRect(0, 0, W, H);
    // 边框
    ctx.strokeStyle = '#445'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    // 墙壁
    ctx.fillStyle = '#7a6a55';
    for (const w of st.wallsForMap) {
      const x1 = toX(w.minX), z1 = toZ(w.minZ);
      const x2 = toX(w.maxX), z2 = toZ(w.maxZ);
      ctx.fillRect(x1, z1, Math.max(1, x2 - x1), Math.max(1, z2 - z1));
    }

    // 床（终点）
    ctx.fillStyle = '#3b6ea6';
    const bx = toX(st.bedX), bz = toZ(st.bedZ);
    ctx.beginPath(); ctx.arc(bx, bz, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🛏', bx, bz);

    // 物品
    for (const it of st.itemsForMap) {
      if (it.collected) continue;
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath(); ctx.arc(toX(it.x), toZ(it.z), 2.5, 0, Math.PI * 2); ctx.fill();
    }

    // 流浪猫
    {
      const cx = toX(st.catX), cz = toZ(st.catZ);
      ctx.fillStyle = '#d87a2c';
      ctx.beginPath(); ctx.arc(cx, cz, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🐱', cx, cz);
    }

    // 妈妈（带视野朝向）
    for (const m of st.momsForMap) {
      const mx = toX(m.x), mz = toZ(m.z);
      const color = m.alarm === 2 ? '#ef4444' : m.alarm === 1 ? '#f97316' : '#fbbf24';
      // 视野扇形
      ctx.fillStyle = color + '55';
      ctx.beginPath();
      ctx.moveTo(mx, mz);
      const r = 18;
      const a0 = m.yaw - Math.PI / 2 - 0.5;
      const a1 = m.yaw - Math.PI / 2 + 0.5;
      ctx.arc(mx, mz, r, a0, a1);
      ctx.closePath(); ctx.fill();
      // 妈妈点
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(mx, mz, 4, 0, Math.PI * 2); ctx.fill();
    }

    // 玩家（带朝向三角）
    const px = toX(st.playerX), pz = toZ(st.playerZ);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(st.playerYaw);
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(-5, 5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }, [st]);

  return (
    <div className="minimap">
      <canvas ref={ref} width={180} height={144} />
      <div className="minimap-legend">
        <span><i style={{ background: '#4ade80' }} />我</span>
        <span><i style={{ background: '#fbbf24' }} />物品</span>
        <span><i style={{ background: '#ef4444' }} />妈妈</span>
        <span><i style={{ background: '#3b6ea6' }} />床</span>
      </div>
    </div>
  );
}

// ===== 多人竞技大厅 =====
interface ArenaLobbyProps {
  connected: boolean;
  error: string;
  onCreateOffer: () => Promise<string>;
  onAcceptOffer: (b64: string) => Promise<string>;
  onFinalizeAnswer: (b64: string) => void;
  onLaunch: () => void;
  onBack: () => void;
}
function ArenaLobby({ connected, error, onCreateOffer, onAcceptOffer, onFinalizeAnswer, onLaunch, onBack }: ArenaLobbyProps) {
  const [mode, setMode] = useState<'choose' | 'host' | 'guest'>('choose');
  const [loading, setLoading] = useState(false);
  const [mySDP, setMySDP] = useState('');
  const [peerInput, setPeerInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const [connectTimeout, setConnectTimeout] = useState(false); // 超时标志

  // 确认回复码后启动 15 秒超时
  useEffect(() => {
    if (!finalized || connected || connectTimeout) return;
    const t = setTimeout(() => setConnectTimeout(true), 15000);
    return () => clearTimeout(t);
  }, [finalized, connected, connectTimeout]);

  // 连接成功后清除超时标志
  useEffect(() => {
    if (connected) setConnectTimeout(false);
  }, [connected]);

  function doCopy(text: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* old browsers */ });
  }

  async function handleHostStart() {
    setMode('host');
    setLoading(true);
    setMySDP('');
    try {
      const offer = await onCreateOffer();
      setMySDP(offer);
    } catch { /* error shown via App state */ }
    setLoading(false);
  }

  async function handleGuestJoin() {
    if (!peerInput.trim()) return;
    setLoading(true);
    setMySDP('');
    try {
      const answer = await onAcceptOffer(peerInput.trim());
      setMySDP(answer);
    } catch { /* error shown via App state */ }
    setLoading(false);
  }

  function handleFinalize() {
    if (!peerInput.trim()) return;
    onFinalizeAnswer(peerInput.trim());
    setFinalized(true);
    setPeerInput('');
  }

  return (
    <div className="arena-lobby">
      <div className="arena-lobby-card">
        <h2 className="arena-lobby-title">⚔️ 多人竞技对枪</h2>
        <p className="arena-lobby-desc">
          1v1 闪光枪竞技 · 先 <b>5 杀</b>或 5 分钟内最多击杀胜出<br />
          <small>每局 6 发弹匣 · 爆头 2 发击杀 · 身体 4 发击杀</small>
        </p>

        {/* ---- 选择角色 ---- */}
        {mode === 'choose' && (
          <div className="arena-lobby-btns">
            <button className="menu-btn" onClick={handleHostStart}>🏠 创建房间（主机）</button>
            <button className="menu-btn" onClick={() => setMode('guest')}>🔗 加入房间（输入邀请码）</button>
            <button className="menu-btn secondary" onClick={onBack}>← 返回主菜单</button>
          </div>
        )}

        {/* ---- 主机流程 ---- */}
        {mode === 'host' && (
          <div className="arena-lobby-host">
            {loading && <div className="arena-lobby-status anim">⏳ 正在生成邀请码（约 6 秒）…</div>}

            {!loading && mySDP && !connected && (
              <>
                <div className="arena-sdp-label">① 把邀请码发给对手（可通过微信/QQ等发送）：</div>
                <div className="arena-sdp-wrap">
                  <textarea className="arena-sdp-box" readOnly value={mySDP} onClick={e => (e.target as HTMLTextAreaElement).select()} />
                  <button className="arena-copy-btn" onClick={() => doCopy(mySDP)}>
                    {copied ? '✅已复制' : '复制'}
                  </button>
                </div>

                {!finalized ? (
                  <>
                    <div className="arena-sdp-label" style={{ marginTop: 14 }}>② 等对手发来回复码，粘贴到这里：</div>
                    <textarea
                      className="arena-sdp-box input"
                      placeholder="粘贴对方回复码…"
                      value={peerInput}
                      onChange={e => setPeerInput(e.target.value)}
                    />
                    <button className="menu-btn" style={{ marginTop: 8 }} onClick={handleFinalize} disabled={!peerInput.trim()}>
                      确认连接
                    </button>
                  </>
                ) : !connectTimeout ? (
                  <div className="arena-lobby-status anim">⏳ 正在建立 P2P 连接…（最长约 15 秒）</div>
                ) : (
                  <div className="arena-lobby-error">
                    ❌ 连接超时。常见原因：<br/>
                    • 两设备需在<b>同一 WiFi</b>，或<br/>
                    • 双方均开启同一代理/VPN<br/>
                    <button className="menu-btn secondary" style={{ marginTop: 8 }} onClick={onBack}>返回重试</button>
                  </div>
                )}
              </>
            )}

            {connected && (
              <>
                <div className="arena-lobby-status ok">✅ 连接成功！</div>
                <button className="menu-btn" style={{ marginTop: 16 }} onClick={onLaunch}>🚀 开始游戏</button>
              </>
            )}

            {error && <div className="arena-lobby-error" style={{ marginTop: 8 }}>❌ {error}</div>}
            <button className="menu-btn secondary" style={{ marginTop: 12 }} onClick={onBack}>← 取消</button>
          </div>
        )}

        {/* ---- 客机流程 ---- */}
        {mode === 'guest' && (
          <div className="arena-lobby-guest">
            {!mySDP && !loading && (
              <>
                <div className="arena-sdp-label">粘贴主机发来的邀请码：</div>
                <textarea
                  className="arena-sdp-box input"
                  placeholder="粘贴邀请码…"
                  value={peerInput}
                  onChange={e => setPeerInput(e.target.value)}
                />
                <button className="menu-btn" style={{ marginTop: 8 }} onClick={handleGuestJoin} disabled={!peerInput.trim()}>
                  解析并加入
                </button>
              </>
            )}

            {loading && <div className="arena-lobby-status anim">⏳ 正在生成回复码…</div>}

            {!loading && mySDP && !connected && (
              <>
                <div className="arena-sdp-label">把回复码发回给主机：</div>
                <div className="arena-sdp-wrap">
                  <textarea className="arena-sdp-box" readOnly value={mySDP} onClick={e => (e.target as HTMLTextAreaElement).select()} />
                  <button className="arena-copy-btn" onClick={() => doCopy(mySDP)}>
                    {copied ? '✅已复制' : '复制'}
                  </button>
                </div>
                {!connectTimeout
                  ? <div className="arena-lobby-status anim">⏳ 等待主机确认连接…</div>
                  : <div className="arena-lobby-error">❌ 连接超时，请让主机点"确认连接"后重试</div>
                }
              </>
            )}

            {connected && <div className="arena-lobby-status ok">✅ 已连接！等待主机开始游戏…</div>}

            {error && <div className="arena-lobby-error" style={{ marginTop: 8 }}>❌ {error}</div>}
            <button className="menu-btn secondary" style={{ marginTop: 12 }} onClick={onBack}>← 取消</button>
          </div>
        )}
      </div>
    </div>
  );
}
