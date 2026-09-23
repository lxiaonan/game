const KEY = 'xionger-world-save-v1';

/**
 * Progress persistence.
 *
 * Deliberately tiny and defensive: a corrupt or half written entry must never
 * stop the game from booting, so every read is wrapped and every field is
 * validated before it is applied. Only progress is stored — where the bear is
 * standing is not worth restoring.
 */
export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const done = {};
    const progress = {};
    for (const [id, value] of Object.entries(data.done || {})) done[id] = Boolean(value);
    for (const [id, value] of Object.entries(data.progress || {})) {
      progress[id] = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
    }
    return {
      done,
      progress,
      bag: {
        cone: Math.max(0, Math.round(data.bag?.cone || 0)),
        honey: Math.max(0, Math.round(data.bag?.honey || 0)),
        shroom: Math.max(0, Math.round(data.bag?.shroom || 0)),
      },
      activeId: typeof data.activeId === 'string' ? data.activeId : null,
      introDone: Boolean(data.introDone),
    };
  } catch (error) {
    return null;
  }
}

export function writeSave(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...data, at: Date.now() }));
  } catch (error) {
    /* private mode, quota, whatever — losing a save is not worth a crash */
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch (error) {
    /* ignore */
  }
}
