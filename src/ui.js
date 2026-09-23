const DIRECTIONS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

export function createUI() {
  const $ = (id) => document.getElementById(id);
  const el = {
    hud: $('hud'),
    loading: $('loading'),
    loadBar: $('load-bar'),
    loadTip: $('load-tip'),
    start: $('start'),
    pause: $('pause'),
    win: $('win'),
    dialogue: $('dialogue'),
    dName: $('d-name'),
    dText: $('d-text'),
    prompt: $('prompt'),
    toast: $('toast'),
    qNow: $('q-now'),
    qTotal: $('q-total'),
    qBar: $('q-bar'),
    qHint: $('q-hint'),
    qTitle: $('q-title'),
    qLabel: $('q-label'),
    tracker: $('tracker'),
    trTri: $('tr-tri'),
    trLabel: $('tr-label'),
    trDist: $('tr-dist'),
    boss: $('boss'),
    bHp: $('b-hp'),
    tHp: $('t-hp'),
    bName: $('b-name'),
    tRow: $('t-row'),
    cDir: $('c-dir'),
    cPos: $('c-pos'),
    map: $('map'),
    touch: $('touch'),
    winText: $('win-text'),
    winStats: $('win-stats'),
    hp: $('v-hp'),
    hpText: $('v-hp-text'),
    sp: $('v-sp'),
    spText: $('v-sp-text'),
    bagCone: $('bag-cone'),
    bagHoney: $('bag-honey'),
    bagShroom: $('bag-shroom'),
    bagStars: $('bag-stars'),
    combo: $('combo'),
    flash: $('hitflash'),
    bigmap: $('bigmap'),
    bigmapCanvas: $('bigmap-canvas'),
    bigmapList: $('bigmap-list'),
    board: $('board'),
    boardList: $('board-list'),
    boardStars: $('board-stars'),
    stateChip: $('state-chip'),
  };
  const ctx = el.map.getContext('2d');
  const bigCtx = el.bigmapCanvas.getContext('2d');

  let toastTimer = 0;
  let typing = null;
  let dialogueOpen = false;
  let fullLine = '';
  let minimapStatic = null;
  let minimapLast = 0;
  let compassDir = '';
  let compassPos = '';
  let trackerOn = false;
  let trackerLabel = '';
  let trackerDist = '';
  let trackerDeg = NaN;
  let promptHtml = null;
  let flashTimer = 0;
  let comboShown = -1;
  let boardBuilt = false;
  let mapOpen = false;
  let boardOpen = false;
  const levelButtons = new Map();
  let onStartLevel = null;

  const api = {
    el,
    setLoading(ratio, tip) {
      el.loadBar.style.width = Math.round(ratio * 100) + '%';
      if (tip) el.loadTip.textContent = tip;
    },
    showStart() {
      el.loading.classList.add('hidden');
      el.start.classList.remove('hidden');
    },
    hideStart() { el.start.classList.add('hidden'); },
    showPause(on) { el.pause.classList.toggle('hidden', !on); },
    showWin(stats) {
      el.winText.textContent = stats.text;
      el.winStats.innerHTML = '';
      for (const [label, value] of Object.entries(stats.stats || {})) {
        const div = document.createElement('div');
        div.className = 'stat panel';
        div.innerHTML = `<b>${value}</b><span>${label}</span>`;
        el.winStats.appendChild(div);
      }
      el.win.classList.remove('hidden');
    },
    hideWin() { el.win.classList.add('hidden'); },
    setHud(on) { el.hud.classList.toggle('on', on); },
    setTouch(on) { el.touch.classList.toggle('on', on); },

    /** Stage driven quest card: title, hint and an optional progress bar. */
    setQuestCard({ title, hint, progress, total }) {
      if (title) el.qTitle.textContent = title;
      if (hint) el.qHint.textContent = hint;
      if (typeof progress === 'number' && total) {
        el.qLabel.textContent = '进度';
        el.qNow.textContent = progress;
        el.qTotal.textContent = total;
        el.qBar.style.width = Math.round((progress / total) * 100) + '%';
      } else {
        el.qLabel.textContent = '目标';
        el.qNow.textContent = '★';
        el.qTotal.textContent = '★';
        el.qBar.style.width = '100%';
      }
    },

    /** Boss panel; `info.tree === false` hides the tree bar (arena waves). */
    setBossBars(info) {
      if (!info) {
        el.boss.classList.remove('on');
        return;
      }
      el.boss.classList.add('on');
      el.bName.textContent = info.name || '光头强';
      el.bHp.style.width = Math.round((info.hp / info.maxHp) * 100) + '%';
      el.tRow.style.display = info.tree === false ? 'none' : '';
      if (info.tree !== false) {
        el.tHp.style.width = Math.round((info.treeHp / info.treeMaxHp) * 100) + '%';
      }
    },

    setTracker(rel) {
      if (!rel) {
        if (trackerOn) {
          el.tracker.classList.remove('on');
          trackerOn = false;
        }
        return;
      }
      if (!trackerOn) {
        el.tracker.classList.add('on');
        trackerOn = true;
      }
      if (rel.label !== trackerLabel) {
        el.trLabel.textContent = rel.label;
        trackerLabel = rel.label;
      }
      const dist = rel.distance < 1 ? '到了' : Math.round(rel.distance) + 'm';
      if (dist !== trackerDist) {
        el.trDist.textContent = dist;
        trackerDist = dist;
      }
      const deg = Math.round(rel.degrees);
      if (deg !== trackerDeg) {
        el.trTri.style.transform = 'rotate(' + deg + 'deg)';
        trackerDeg = deg;
      }
    },

    /** `html` is a full prompt body (already escaped by the caller), or null. */
    setPrompt(html) {
      if (html === promptHtml) return;
      promptHtml = html;
      if (html) {
        el.prompt.innerHTML = html;
        el.prompt.classList.add('on');
      } else {
        el.prompt.classList.remove('on');
      }
    },

    toast(text, ms = 2200) {
      el.toast.innerHTML = text;
      el.toast.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.toast.classList.remove('on'), ms);
    },

    /** Health / stamina readout. Values are only written when they change. */
    setVitals(v) {
      const hpPct = Math.round((v.hp / v.maxHp) * 100);
      if (el.hp.style.width !== hpPct + '%') el.hp.style.width = hpPct + '%';
      const hpLabel = Math.ceil(v.hp) + ' / ' + Math.round(v.maxHp);
      if (el.hpText.textContent !== hpLabel) el.hpText.textContent = hpLabel;
      el.hp.classList.toggle('low', v.hp / v.maxHp < 0.3);
      const spPct = Math.round((v.stamina / v.staminaMax) * 100);
      if (el.sp.style.width !== spPct + '%') el.sp.style.width = spPct + '%';
      const spLabel = v.wading ? '涉水中' : v.crouching ? '潜行' : v.rolling ? '翻滚' : '体力';
      if (el.spText.textContent !== spLabel) el.spText.textContent = spLabel;
    },

    setBag(counts) {
      const set = (node, value) => {
        if (node.textContent !== String(value)) node.textContent = value;
      };
      set(el.bagCone, counts.cone);
      set(el.bagHoney, counts.honey);
      set(el.bagShroom, counts.shroom);
      set(el.bagStars, counts.stars + '/' + counts.total);
    },

    setCombo(step) {
      if (step === comboShown) return;
      comboShown = step;
      if (!step) {
        el.combo.classList.remove('on');
        return;
      }
      el.combo.classList.add('on');
      el.combo.querySelectorAll('i').forEach((node, index) => {
        node.classList.toggle('hot', index < step);
      });
    },

    hitFlash() {
      el.flash.classList.add('on');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => el.flash.classList.remove('on'), 120);
    },

    /** The chapter list. Buttons are wired once; state updates are cheap. */
    setLevelBoard({ levels, state }) {
      if (!boardBuilt) {
        boardBuilt = true;
        el.boardList.innerHTML = '';
        for (const level of levels) {
          const card = document.createElement('div');
          card.className = 'lvcard panel';
          card.innerHTML = `
            <div class="lvhead"><span class="lvno">${level.index}</span>
              <span class="lvtitle">${level.title}</span>
              <span class="lvtag"></span></div>
            <div class="lvwhere">${level.where}</div>
            <p class="lvbrief">${level.brief}</p>
            <div class="lvfoot"><span class="lvprog"></span>
              <button class="lvgo" data-id="${level.id}">开始这一关</button></div>`;
          el.boardList.appendChild(card);
          const button = card.querySelector('.lvgo');
          button.addEventListener('click', () => {
            if (onStartLevel) onStartLevel(level.id);
          });
          levelButtons.set(level.id, { card, tag: card.querySelector('.lvtag'), prog: card.querySelector('.lvprog'), button });
        }
      }
      for (const level of levels) {
        const nodes = levelButtons.get(level.id);
        if (!nodes) continue;
        const done = state.done[level.id];
        const active = state.activeId === level.id;
        nodes.card.classList.toggle('done', done);
        nodes.card.classList.toggle('active', active);
        nodes.tag.textContent = done ? '已通关' : active ? '进行中' : '未完成';
        nodes.prog.textContent = level.need
          ? `${level.title}进度 ${state.progress[level.id]} / ${level.need}`
          : (done ? '已完成' : '待挑战');
        nodes.button.textContent = done ? '再挑战一次' : active ? '重新开始' : '开始这一关';
      }
      const stars = levels.filter((l) => state.done[l.id]).length;
      el.boardStars.textContent = `★ ${stars} / ${levels.length}`;
    },

    onStartLevel(handler) { onStartLevel = handler; },
    showBoard(on) {
      boardOpen = on;
      el.board.classList.toggle('hidden', !on);
    },
    isBoardOpen: () => boardOpen,
    showMap(on) {
      mapOpen = on;
      el.bigmap.classList.toggle('hidden', !on);
    },
    isMapOpen: () => mapOpen,

    /** The full screen map: regions, trails, every marker and the chapter list. */
    drawBigMap(world) {
      if (!mapOpen) return;
      const w = el.bigmapCanvas.width;
      const h = el.bigmapCanvas.height;
      const scale = (Math.min(w, h) / 2 - 26) / 215;
      const cx = w / 2;
      const cy = h / 2;
      const toX = (x) => cx + x * scale;
      const toY = (z) => cy + z * scale;

      bigCtx.clearRect(0, 0, w, h);
      bigCtx.fillStyle = '#101a0e';
      bigCtx.fillRect(0, 0, w, h);

      // regions as soft discs with a label each
      for (const region of world.regions) {
        const grad = bigCtx.createRadialGradient(toX(region.x), toY(region.z), 4, toX(region.x), toY(region.z), region.r * scale);
        const tint = region.id === 'swamp' ? '86,110,74'
          : region.id === 'highland' ? '118,124,140'
            : region.id === 'stones' ? '110,108,96'
              : '96,134,74';
        grad.addColorStop(0, `rgba(${tint},0.62)`);
        grad.addColorStop(1, `rgba(${tint},0.05)`);
        bigCtx.fillStyle = grad;
        bigCtx.beginPath();
        bigCtx.arc(toX(region.x), toY(region.z), region.r * scale, 0, Math.PI * 2);
        bigCtx.fill();
        bigCtx.fillStyle = 'rgba(255,246,221,0.9)';
        bigCtx.font = 'bold 13px "Microsoft YaHei", sans-serif';
        bigCtx.textAlign = 'center';
        bigCtx.fillText(region.name, toX(region.x), toY(region.z) - region.r * scale - 6);
      }

      // the river gorge
      bigCtx.fillStyle = 'rgba(96,178,196,0.85)';
      bigCtx.fillRect(toX(world.river.x - world.river.halfWidth), 0, world.river.halfWidth * 2 * scale, h);
      bigCtx.strokeStyle = '#e7c489';
      bigCtx.lineWidth = 5;
      bigCtx.beginPath();
      bigCtx.moveTo(toX(world.river.x - world.river.halfWidth), toY(world.river.bridgeZ));
      bigCtx.lineTo(toX(world.river.x + world.river.halfWidth), toY(world.river.bridgeZ));
      bigCtx.stroke();

      bigCtx.strokeStyle = 'rgba(196,164,110,0.7)';
      bigCtx.lineWidth = 3;
      bigCtx.lineCap = 'round';
      for (const path of world.paths) {
        bigCtx.beginPath();
        path.forEach(([x, z], i) => (i ? bigCtx.lineTo(toX(x), toY(z)) : bigCtx.moveTo(toX(x), toY(z))));
        bigCtx.stroke();
      }

      // level stones
      for (const totem of world.totems) {
        bigCtx.beginPath();
        bigCtx.arc(toX(totem.x), toY(totem.z), 7, 0, Math.PI * 2);
        bigCtx.fillStyle = totem.done ? 'rgba(150,230,140,0.95)' : totem.active ? '#ffb02e' : 'rgba(255,255,255,0.8)';
        bigCtx.fill();
        bigCtx.strokeStyle = 'rgba(0,0,0,0.5)';
        bigCtx.lineWidth = 1.4;
        bigCtx.stroke();
        bigCtx.fillStyle = 'rgba(255,246,221,0.92)';
        bigCtx.font = '11px "Microsoft YaHei", sans-serif';
        bigCtx.textAlign = 'center';
        bigCtx.fillText(totem.label, toX(totem.x), toY(totem.z) - 11);
      }

      // pickups, still out there
      for (const item of world.items) {
        if (item.collected) continue;
        bigCtx.beginPath();
        bigCtx.arc(toX(item.x), toY(item.z), 4, 0, Math.PI * 2);
        bigCtx.fillStyle = item.kind === 'cone' ? '#ffb02e' : item.kind === 'honey' ? '#ffd98a' : '#ff9f6a';
        bigCtx.fill();
        bigCtx.strokeStyle = 'rgba(255,255,255,0.85)';
        bigCtx.lineWidth = 1.2;
        bigCtx.stroke();
      }
      for (const crystal of world.crystals) {
        bigCtx.beginPath();
        bigCtx.arc(toX(crystal.x), toY(crystal.z), 4.6, 0, Math.PI * 2);
        bigCtx.fillStyle = crystal.lit ? '#9fe4ff' : 'rgba(140,170,190,0.6)';
        bigCtx.fill();
      }

      for (const npc of world.neighbours) {
        bigCtx.beginPath();
        bigCtx.arc(toX(npc.x), toY(npc.z), 3.2, 0, Math.PI * 2);
        bigCtx.fillStyle = npc.talked ? 'rgba(150,230,140,0.9)' : 'rgba(255,255,255,0.7)';
        bigCtx.fill();
      }

      if (world.objective && world.objective.show) {
        const ox = toX(world.objective.x);
        const oy = toY(world.objective.z);
        const pulse = 1 + Math.sin(performance.now() / 220) * 0.18;
        bigCtx.beginPath();
        bigCtx.arc(ox, oy, 11 * pulse, 0, Math.PI * 2);
        bigCtx.strokeStyle = '#ffe9a8';
        bigCtx.lineWidth = 2.6;
        bigCtx.stroke();
      }

      const px = toX(world.player.x);
      const py = toY(world.player.z);
      const heading = Math.atan2(Math.sin(world.player.yaw), -Math.cos(world.player.yaw));
      bigCtx.save();
      bigCtx.translate(px, py);
      bigCtx.rotate(heading);
      bigCtx.beginPath();
      bigCtx.moveTo(0, -13);
      bigCtx.lineTo(9, 10);
      bigCtx.lineTo(0, 5);
      bigCtx.lineTo(-9, 10);
      bigCtx.closePath();
      bigCtx.fillStyle = '#ff5b3a';
      bigCtx.fill();
      bigCtx.strokeStyle = 'rgba(255,255,255,0.95)';
      bigCtx.lineWidth = 1.6;
      bigCtx.stroke();
      bigCtx.restore();

      bigCtx.fillStyle = 'rgba(255,246,221,0.9)';
      bigCtx.font = 'bold 16px "Microsoft YaHei", sans-serif';
      bigCtx.textAlign = 'center';
      bigCtx.fillText('N', cx, 24);

      el.bigmapList.innerHTML = world.levelLines
        .map((line) => `<li class="${line.done ? 'done' : line.active ? 'active' : ''}">${line.text}</li>`)
        .join('');
    },

    setStateChip(text) {
      if (el.stateChip.textContent !== text) el.stateChip.textContent = text;
    },

    setCompass(yaw, x, z) {
      const heading = (Math.atan2(Math.sin(yaw), -Math.cos(yaw)) * 180) / Math.PI;
      const index = Math.round(((heading % 360) + 360) % 360 / 45) % 8;
      const dir = DIRECTIONS[index];
      const pos = Math.round(x) + ', ' + Math.round(z);
      if (dir !== compassDir) {
        el.cDir.textContent = dir;
        compassDir = dir;
      }
      if (pos !== compassPos) {
        el.cPos.textContent = pos;
        compassPos = pos;
      }
    },

    isDialogueOpen: () => dialogueOpen,
    openDialogue(name, line) {
      dialogueOpen = true;
      el.dialogue.classList.add('on');
      el.dName.textContent = name;
      fullLine = line;
      let i = 0;
      el.dText.textContent = '';
      clearInterval(typing);
      typing = setInterval(() => {
        i += 2;
        el.dText.textContent = fullLine.slice(0, i);
        if (i >= fullLine.length) {
          el.dText.textContent = fullLine;
          clearInterval(typing);
        }
      }, 22);
    },
    finishTyping() {
      if (typing) {
        clearInterval(typing);
        typing = null;
        el.dText.textContent = fullLine;
        return true;
      }
      return false;
    },
    closeDialogue() {
      dialogueOpen = false;
      clearInterval(typing);
      typing = null;
      el.dialogue.classList.remove('on');
    },

    drawMinimap(world) {
      // The paths, river, grid rings and landmark labels never move, so they are
      // painted once into an offscreen canvas; the moving dots only need a
      // handful of updates a second to read correctly.
      const now = performance.now();
      if (now - minimapLast < 90) return;
      minimapLast = now;

      const w = el.map.width;
      const c = w / 2;
      const scale = (w / 2) / 215;

      if (!minimapStatic || minimapStatic.width !== w) {
        minimapStatic = document.createElement('canvas');
        minimapStatic.width = minimapStatic.height = w;
        paintMinimapBase(minimapStatic.getContext('2d'), w, c, scale, world);
      }

      ctx.clearRect(0, 0, w, w);
      ctx.save();
      ctx.beginPath();
      ctx.arc(c, c, c - 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(minimapStatic, 0, 0);

      const toX = (x) => c + x * scale;
      const toY = (z) => c + z * scale;

      for (const item of world.items) {
        if (item.collected) continue;
        ctx.beginPath();
        ctx.arc(toX(item.x), toY(item.z), 4.4, 0, Math.PI * 2);
        ctx.fillStyle = item.kind === 'cone' ? '#ffb02e' : item.kind === 'honey' ? '#ffd98a' : '#ff9f6a';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }

      for (const totem of world.totems) {
        ctx.beginPath();
        ctx.arc(toX(totem.x), toY(totem.z), 5, 0, Math.PI * 2);
        ctx.fillStyle = totem.done ? 'rgba(150,230,140,0.95)' : totem.active ? '#ffb02e' : 'rgba(255,255,255,0.8)';
        ctx.fill();
      }

      for (const npc of world.neighbours) {
        ctx.beginPath();
        ctx.arc(toX(npc.x), toY(npc.z), 3.2, 0, Math.PI * 2);
        ctx.fillStyle = npc.talked ? 'rgba(150,230,140,0.9)' : 'rgba(255,255,255,0.7)';
        ctx.fill();
      }

      if (world.objective && world.objective.show) {
        const ox = toX(world.objective.x);
        const oy = toY(world.objective.z);
        const pulse = 1 + Math.sin(now / 220) * 0.18;
        ctx.beginPath();
        ctx.arc(ox, oy, 8 * pulse, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffe9a8';
        ctx.lineWidth = 2.4;
        ctx.stroke();
      }

      const px = toX(world.player.x);
      const py = toY(world.player.z);
      const heading = Math.atan2(Math.sin(world.player.yaw), -Math.cos(world.player.yaw));
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(heading);
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(6, 7);
      ctx.lineTo(0, 3.5);
      ctx.lineTo(-6, 7);
      ctx.closePath();
      ctx.fillStyle = '#ff5b3a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();

      ctx.restore();
    },
  };

  return api;
}

/** The unchanging half of the minimap, painted once and reused as a bitmap. */
function paintMinimapBase(ctx, w, c, scale, world) {
  const grad = ctx.createRadialGradient(c, c, 10, c, c, c);
  grad.addColorStop(0, '#4d6b34');
  grad.addColorStop(1, '#26361b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, w);

  const toX = (x) => c + x * scale;
  const toY = (z) => c + z * scale;

  // region tints first, so the river and trails draw on top of them
  for (const region of world.regions || []) {
    ctx.beginPath();
    ctx.arc(toX(region.x), toY(region.z), region.r * scale, 0, Math.PI * 2);
    ctx.fillStyle = region.id === 'swamp' ? 'rgba(70,96,60,0.55)'
      : region.id === 'highland' ? 'rgba(120,126,142,0.4)'
        : region.id === 'stones' ? 'rgba(108,106,94,0.45)'
          : 'rgba(120,160,88,0.3)';
    ctx.fill();
  }

  if (world.river) {
    ctx.fillStyle = 'rgba(96,178,196,0.85)';
    ctx.fillRect(
      toX(world.river.x - world.river.halfWidth), 0,
      world.river.halfWidth * 2 * scale, w,
    );
    ctx.strokeStyle = '#e7c489';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(toX(world.river.x - world.river.halfWidth), toY(world.river.bridgeZ));
    ctx.lineTo(toX(world.river.x + world.river.halfWidth), toY(world.river.bridgeZ));
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(196,164,110,0.75)';
  ctx.lineWidth = Math.max(1, 5 * scale);
  ctx.lineCap = 'round';
  for (const path of world.paths) {
    ctx.beginPath();
    path.forEach(([x, z], i) => (i ? ctx.lineTo(toX(x), toY(z)) : ctx.moveTo(toX(x), toY(z))));
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let r = 50; r <= 200; r += 50) {
    ctx.beginPath();
    ctx.arc(c, c, r * scale, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.font = '11px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  for (const lm of world.landmarks) {
    ctx.fillStyle = '#ffe6ae';
    ctx.beginPath();
    ctx.arc(toX(lm.x), toY(lm.z), 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(c, c, c - 2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,214,130,0.6)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.font = 'bold 15px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = 'rgba(255,246,221,0.9)';
  ctx.textAlign = 'center';
  ctx.fillText('N', c, 20);
}
