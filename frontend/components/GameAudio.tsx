"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readLocalValue, writeLocalValue } from "@/lib/storage";

export type GameSound =
  | "relay"
  | "dossier"
  | "seal-order"
  | "transmission"
  | "alert"
  | "damage"
  | "corruption"
  | "ballot"
  | "ejection"
  | "blackbox";

type AudioControls = {
  enabled: boolean;
  toggle: () => void;
  play: (sound: GameSound) => void;
  setAmbience: (active: boolean, intensity?: number) => void;
};

const AudioControlContext = createContext<AudioControls | null>(null);
const SOUND_KEY = "mutiny:sound-enabled";

class MutinyAudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private ambienceSources: AudioScheduledSourceNode[] = [];
  private ambienceWanted = false;
  private ambienceIntensity = 0.25;
  private enabled = true;
  private reduced = false;
  private unavailable = false;

  setReducedMotion(reduced: boolean) {
    this.reduced = reduced;
  }

  private ensureContext() {
    if (this.context) return this.context;
    if (this.unavailable) throw new Error("Web Audio unavailable");
    const context = new AudioContext({ latencyHint: "interactive" });
    const master = context.createGain();
    master.gain.value = this.enabled ? 0.72 : 0;
    master.connect(context.destination);
    this.context = context;
    this.master = master;
    return context;
  }

  async unlock() {
    if (!this.enabled || this.unavailable) return;
    try {
      const context = this.ensureContext();
      if (context.state === "suspended") await context.resume();
      if (this.ambienceWanted) this.startAmbience();
    } catch {
      this.unavailable = true;
      this.context = null;
      this.master = null;
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(enabled ? 0.72 : 0, now + 0.08);
    if (enabled && this.ambienceWanted) {
      void this.unlock();
    } else if (!enabled) {
      this.stopAmbience(0.08);
    }
  }

  setAmbience(active: boolean, intensity = 0.25) {
    this.ambienceWanted = active;
    this.ambienceIntensity = Math.max(0, Math.min(1, intensity));
    if (!active) {
      this.stopAmbience(0.5);
      return;
    }
    if (this.context?.state === "running" && this.enabled) this.startAmbience();
    this.updateAmbienceLevel();
  }

  private updateAmbienceLevel() {
    if (!this.context || !this.ambienceGain) return;
    const level = (this.reduced ? 0.009 : 0.014) + this.ambienceIntensity * 0.01;
    this.ambienceGain.gain.cancelScheduledValues(this.context.currentTime);
    this.ambienceGain.gain.linearRampToValueAtTime(level, this.context.currentTime + 0.35);
  }

  private startAmbience() {
    if (!this.context || !this.master || this.ambienceSources.length || !this.ambienceWanted || !this.enabled) return;
    const context = this.context;
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);

    const engine = context.createOscillator();
    engine.type = "sine";
    engine.frequency.value = 43;
    const harmonic = context.createOscillator();
    harmonic.type = "triangle";
    harmonic.frequency.value = 86.2;
    const harmonicGain = context.createGain();
    harmonicGain.gain.value = 0.16;
    engine.connect(gain);
    harmonic.connect(harmonicGain).connect(gain);

    const buffer = this.noiseBuffer(3);
    const air = context.createBufferSource();
    air.buffer = buffer;
    air.loop = true;
    const airFilter = context.createBiquadFilter();
    airFilter.type = "lowpass";
    airFilter.frequency.value = 165;
    airFilter.Q.value = 0.7;
    const airGain = context.createGain();
    airGain.gain.value = 0.32;
    air.connect(airFilter).connect(airGain).connect(gain);

    engine.start();
    harmonic.start();
    air.start();
    this.ambienceSources = [engine, harmonic, air];
    this.ambienceGain = gain;
    this.updateAmbienceLevel();
  }

  private stopAmbience(fade = 0.25) {
    if (!this.context || !this.ambienceGain || !this.ambienceSources.length) return;
    const context = this.context;
    const gain = this.ambienceGain;
    const sources = this.ambienceSources;
    gain.gain.cancelScheduledValues(context.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, context.currentTime);
    gain.gain.linearRampToValueAtTime(0, context.currentTime + fade);
    sources.forEach((source) => source.stop(context.currentTime + fade + 0.05));
    this.ambienceSources = [];
    this.ambienceGain = null;
  }

  private noiseBuffer(seconds: number) {
    const context = this.ensureContext();
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) channel[index] = Math.random() * 2 - 1;
    return buffer;
  }

  private tone(frequency: number, duration: number, volume: number, start: number, type: OscillatorType = "sine", endFrequency?: number) {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency !== undefined) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(duration: number, volume: number, start: number, low = 180, high = 2400) {
    if (!this.context || !this.master) return;
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer(duration + 0.05);
    const highpass = this.context.createBiquadFilter();
    const lowpass = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    highpass.type = "highpass";
    highpass.frequency.value = low;
    lowpass.type = "lowpass";
    lowpass.frequency.value = high;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(highpass).connect(lowpass).connect(gain).connect(this.master);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  private quietAmbience(duration: number) {
    if (!this.context || !this.ambienceGain) return;
    const now = this.context.currentTime;
    const target = (this.reduced ? 0.009 : 0.014) + this.ambienceIntensity * 0.01;
    this.ambienceGain.gain.cancelScheduledValues(now);
    this.ambienceGain.gain.setValueAtTime(this.ambienceGain.gain.value, now);
    this.ambienceGain.gain.linearRampToValueAtTime(0.0001, now + 0.04);
    this.ambienceGain.gain.setValueAtTime(0.0001, now + duration);
    this.ambienceGain.gain.linearRampToValueAtTime(target, now + duration + 0.35);
  }

  play(sound: GameSound) {
    if (!this.enabled) return;
    void this.unlock().then(() => {
      if (!this.context) return;
      const now = this.context.currentTime + 0.01;
      const scale = this.reduced ? 0.68 : 1;

      if (sound === "relay") {
        this.tone(760, 0.035, 0.035 * scale, now, "square", 620);
        this.tone(390, 0.045, 0.022 * scale, now + 0.045, "triangle");
      }
      if (sound === "dossier") {
        this.noise(0.16, 0.025 * scale, now, 700, 4200);
        this.tone(168, 0.34, 0.026 * scale, now + 0.04, "triangle", 235);
        this.tone(337, 0.2, 0.014 * scale, now + 0.14, "sine");
      }
      if (sound === "seal-order") {
        this.noise(0.055, 0.04 * scale, now, 900, 5600);
        this.tone(520, 0.1, 0.035 * scale, now + 0.04, "square", 150);
        this.tone(112, 0.26, 0.032 * scale, now + 0.1, "triangle", 74);
      }
      if (sound === "transmission") {
        [0, 0.075, 0.15].forEach((offset, index) => this.tone(620 + index * 110, 0.055, 0.022 * scale, now + offset, "square"));
        this.noise(0.24, 0.012 * scale, now, 1200, 5400);
      }
      if (sound === "alert") {
        this.tone(560, 0.16, 0.038 * scale, now, "sine");
        this.tone(560, 0.16, 0.038 * scale, now + 0.24, "sine");
      }
      if (sound === "damage") {
        this.noise(0.3, 0.055 * scale, now, 32, 620);
        this.tone(92, 0.42, 0.052 * scale, now, "sawtooth", 43);
      }
      if (sound === "corruption") {
        this.noise(0.42, 0.035 * scale, now, 600, 6200);
        this.tone(930, 0.11, 0.028 * scale, now, "square", 410);
        this.tone(760, 0.09, 0.024 * scale, now + 0.17, "square", 250);
        this.tone(1180, 0.07, 0.02 * scale, now + 0.31, "square", 520);
      }
      if (sound === "ballot") {
        this.noise(0.13, 0.022 * scale, now, 1100, 5000);
        this.tone(245, 0.08, 0.03 * scale, now + 0.09, "square", 102);
      }
      if (sound === "ejection") {
        this.quietAmbience(0.42);
        this.tone(72, 0.62, 0.055 * scale, now + 0.43, "sawtooth", 31);
        this.noise(0.7, 0.06 * scale, now + 0.46, 42, 980);
        this.tone(34, 0.85, 0.035 * scale, now + 0.72, "sine", 22);
      }
      if (sound === "blackbox") {
        this.quietAmbience(0.58);
        this.noise(0.12, 0.026 * scale, now + 0.59, 800, 4800);
        this.tone(72, 0.8, 0.04 * scale, now + 0.62, "sine", 142);
        this.tone(214, 0.5, 0.028 * scale, now + 0.96, "triangle", 428);
        this.tone(428, 0.7, 0.022 * scale, now + 1.25, "sine");
      }
    }).catch(() => undefined);
  }

  close() {
    this.ambienceWanted = false;
    this.stopAmbience(0.05);
    void this.context?.close();
    this.context = null;
    this.master = null;
  }
}

export function GameAudioProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(true);
  const engine = useMemo(() => new MutinyAudioEngine(), []);

  useEffect(() => {
    const saved = readLocalValue(SOUND_KEY);
    const next = saved === null ? true : saved === "true";
    setEnabled(next);
    engine.setEnabled(next);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => engine.setReducedMotion(motion.matches);
    updateMotion();
    motion.addEventListener("change", updateMotion);
    const unlock = () => void engine.unlock().catch(() => undefined);
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      motion.removeEventListener("change", updateMotion);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      engine.close();
    };
  }, [engine]);

  const toggle = useCallback(() => {
    setEnabled((current) => {
      const next = !current;
      writeLocalValue(SOUND_KEY, String(next));
      engine.setEnabled(next);
      if (next) engine.play("relay");
      return next;
    });
  }, [engine]);
  const play = useCallback((sound: GameSound) => engine.play(sound), [engine]);
  const setAmbience = useCallback((active: boolean, intensity = 0.25) => engine.setAmbience(active, intensity), [engine]);
  const value = useMemo(() => ({ enabled, toggle, play, setAmbience }), [enabled, play, setAmbience, toggle]);

  return <AudioControlContext.Provider value={value}>{children}</AudioControlContext.Provider>;
}

export function useGameAudio() {
  const controls = useContext(AudioControlContext);
  if (!controls) throw new Error("GameAudioProvider is missing");
  return controls;
}

export function SoundControl() {
  const { enabled, toggle } = useGameAudio();
  return (
    <button
      type="button"
      className={`sound-control ${enabled ? "is-enabled" : ""}`}
      aria-pressed={enabled}
      aria-label={enabled ? "Mute vessel audio" : "Enable vessel audio"}
      onClick={toggle}
    >
      <span aria-hidden="true"><i /><i /><i /></span>
      <b>{enabled ? "AUDIO" : "MUTED"}</b>
    </button>
  );
}
