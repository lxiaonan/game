/** Everything you hear is synthesised on the fly, so the game needs no audio files. */
export function createAudio() {
  let ctx = null;
  let master = null;
  let started = false;

  const noiseBuffer = (seconds = 2) => {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  };

  const positionAt = (pan, z) => {
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) panner.pan.value = Math.max(-1, Math.min(1, pan));
    return panner;
  };

  const start = () => {
    if (started) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    master.gain.exponentialRampToValueAtTime(0.85, ctx.currentTime + 2.5);

    // wind bed
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer(4);
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 420;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain).connect(windGain.gain);
    wind.connect(windFilter).connect(windGain).connect(master);
    wind.start();
    lfo.start();

    // leaf rustle bed
    const leaves = ctx.createBufferSource();
    leaves.buffer = noiseBuffer(3);
    leaves.loop = true;
    const leafFilter = ctx.createBiquadFilter();
    leafFilter.type = 'bandpass';
    leafFilter.frequency.value = 2400;
    leafFilter.Q.value = 0.7;
    const leafGain = ctx.createGain();
    leafGain.gain.value = 0.012;
    const leafLfo = ctx.createOscillator();
    leafLfo.frequency.value = 0.23;
    const leafLfoGain = ctx.createGain();
    leafLfoGain.gain.value = 0.01;
    leafLfo.connect(leafLfoGain).connect(leafGain.gain);
    leaves.connect(leafFilter).connect(leafGain).connect(master);
    leaves.start();
    leafLfo.start();

    started = true;
  };

  const chirp = (pan = 0, volume = 0.05) => {
    if (!started) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const base = 1500 + Math.random() * 1400;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.7), t + 0.06);
    osc.frequency.exponentialRampToValueAtTime(base * 0.85, t + 0.14);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    const panner = positionAt(pan);
    if (panner) {
      osc.connect(gain).connect(panner).connect(master);
    } else {
      osc.connect(gain).connect(master);
    }
    osc.start(t);
    osc.stop(t + 0.24);
  };

  const footstep = (running, surface = 'grass') => {
    if (!started) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.25);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = surface === 'dirt' ? 900 : 1500;
    const gain = ctx.createGain();
    const peak = (running ? 0.16 : 0.1) * (0.85 + Math.random() * 0.3);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (running ? 0.19 : 0.26));
    src.connect(filter).connect(gain).connect(master);
    src.start(t);
    src.stop(t + 0.3);
  };

  const pickup = () => {
    if (!started) return;
    const t = ctx.currentTime;
    [880, 1320, 1760].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      const at = t + i * 0.07;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(0.11, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
      osc.connect(gain).connect(master);
      osc.start(at);
      osc.stop(at + 0.6);
    });
  };

  const blip = (pitch = 520) => {
    if (!started) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = pitch;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.035, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + 0.12);
  };

  const fanfare = () => {
    if (!started) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1046].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      const at = t + i * 0.14;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(0.13, at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.75);
      osc.connect(gain).connect(master);
      osc.start(at);
      osc.stop(at + 0.8);
    });
  };

  return { start, chirp, footstep, pickup, blip, fanfare, isStarted: () => started };
}
