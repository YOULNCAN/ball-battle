import { type World } from "./sim";
export type Track = World["mapType"] | "battle" | "victory";
export const TRACK_NAMES: Record<Track, string> = {
  grassland: "草原 · 王国初曦",
  desert: "沙漠 · 黄沙军旗",
  snow: "雪原 · 冰霜王冠",
  forest: "森林 · 林间誓约",
  valley: "山谷 · 群峰号角",
  islands: "群岛 · 海上诸国",
  battle: "激战 · 战鼓与钢铁",
  victory: "胜利 · 诸国归一",
};
export class MusicDirector {
  battle = false;
  private sinceSwitch = 0;
  private hot = 0;
  private cold = 0;
  update(rate: number, dt: number) {
    this.sinceSwitch += dt;
    this.hot = rate >= 30 ? this.hot + dt : 0;
    this.cold = rate < 10 ? this.cold + dt : 0;
    if (
      this.sinceSwitch >= 20 &&
      ((!this.battle && this.hot >= 3) || (this.battle && this.cold >= 10))
    ) {
      this.battle = !this.battle;
      this.sinceSwitch = 0;
      this.hot = 0;
      this.cold = 0;
    }
    return this.battle;
  }
}
interface Voice {
  track: Track;
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  offset: number;
  started: number;
  ended: boolean;
}
export class MusicEngine {
  director = new MusicDirector();
  current: Voice | null = null;
  private fading: Voice[] = [];
  private buffers = new Map<Track, Promise<AudioBuffer>>();
  private loading: Track | null = null;
  private generation = 0;
  private running = false;
  private volume = 0.25;
  private hits = 0;
  private elapsed = 0;
  private previousHits = 0;
  private context: AudioContext | null = null;
  constructor(private report: (message: string) => void) {}
  attach(context: AudioContext) {
    this.context = context;
  }
  reset() {
    this.generation++;
    this.loading = null;
    this.director = new MusicDirector();
    this.hits = this.elapsed = this.previousHits = 0;
    for (const v of [...this.fading, ...(this.current ? [this.current] : [])]) {
      try {
        v.source?.stop();
      } catch {}
      v.gain.disconnect();
    }
    this.current = null;
    this.fading = [];
  }
  private buffer(track: Track): Promise<AudioBuffer> {
    const cached = this.buffers.get(track);
    if (cached) return cached;
    const request = fetch(`${import.meta.env.BASE_URL}music/${track}.mp3`)
      .then(async (response) => {
        if (!response.ok) throw new Error("无法加载本地音乐");
        const decoded = await this.context!.decodeAudioData(
          await response.arrayBuffer(),
        );
        if (track === "victory") return decoded;
        // Remove a two-second head and crossfade it into the tail for a continuous loop.
        const overlap = Math.min(
          Math.floor(decoded.sampleRate * 2),
          Math.floor(decoded.length / 4),
        );
        const loop = this.context!.createBuffer(
          decoded.numberOfChannels,
          decoded.length - overlap,
          decoded.sampleRate,
        );
        for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
          const input = decoded.getChannelData(channel),
            output = loop.getChannelData(channel);
          output.set(input.subarray(overlap));
          for (let i = 0; i < overlap; i++) {
            const alpha = i / overlap,
              at = output.length - overlap + i;
            output[at] = output[at] * (1 - alpha) + input[i] * alpha;
          }
        }
        return loop;
      })
      .catch((error) => {
        this.report(
          `${TRACK_NAMES[track]}：${error.message}，其他游戏功能仍可使用。`,
        );
        throw error;
      });
    this.buffers.set(track, request);
    return request;
  }
  private startVoice(v: Voice) {
    if (!this.context || v.source || v.ended) return;
    const source = this.context.createBufferSource();
    source.buffer = v.buffer;
    source.loop = v.track !== "victory";
    source.connect(v.gain);
    v.started = this.context.currentTime;
    v.source = source;
    source.onended = () => {
      if (v.source === source) {
        v.source = null;
        v.ended = true;
      }
    };
    source.start(0, v.offset);
  }
  private pauseVoice(v: Voice) {
    if (!this.context || !v.source) return;
    v.offset += this.context.currentTime - v.started;
    if (v.track !== "victory") v.offset %= v.buffer.duration;
    else if (v.offset >= v.buffer.duration) v.ended = true;
    const source = v.source;
    v.source = null;
    source.stop();
    source.disconnect();
  }
  private async select(track: Track) {
    if (!this.context || this.loading === track) return;
    const token = ++this.generation;
    this.loading = track;
    try {
      const buffer = await this.buffer(track);
      if (token !== this.generation) return;
      if (this.current) {
        this.fading.push(this.current);
        this.current.gain.gain.cancelScheduledValues(this.context.currentTime);
        this.current.gain.gain.setTargetAtTime(
          0,
          this.context.currentTime,
          0.5,
        );
      }
      const gain = this.context.createGain();
      gain.gain.value = 0;
      gain.connect(this.context.destination);
      this.current = {
        track,
        buffer,
        gain,
        source: null,
        offset: 0,
        started: 0,
        ended: false,
      };
      if (this.running) this.startVoice(this.current);
    } catch {
      /* buffer() reports each failed track once. */
    } finally {
      if (token === this.generation) this.loading = null;
    }
  }
  update(w: World, running: boolean, dt: number) {
    this.running = running;
    this.volume = w.settings.musicVolume;
    if (running) {
      this.elapsed += dt;
      this.hits += Math.max(0, w.combatHits - this.previousHits);
      if (this.elapsed >= 1) {
        this.director.update(this.hits / this.elapsed, this.elapsed);
        this.hits = this.elapsed = 0;
      }
    }
    this.previousHits = w.combatHits;
    if (!this.context) return;
    const desired: Track =
      w.winner !== null
        ? "victory"
        : this.director.battle
          ? "battle"
          : w.mapType;
    if (
      this.current?.track !== desired &&
      this.loading !== desired &&
      running &&
      this.volume > 0
    )
      void this.select(desired);
    if (this.current) {
      if (running && this.volume > 0 && this.context.state === "running")
        this.startVoice(this.current);
      else this.pauseVoice(this.current);
      this.current.gain.gain.setTargetAtTime(
        this.volume,
        this.context.currentTime,
        0.4,
      );
    }
    this.fading = this.fading.filter((v) => {
      if (!running || v.gain.gain.value < 0.002) {
        this.pauseVoice(v);
        v.gain.disconnect();
        return false;
      }
      return true;
    });
  }
  get diagnostics() {
    return {
      track: this.current?.track ?? null,
      playing: !!this.current?.source,
      offset: this.current
        ? this.current.offset +
          (this.current.source && this.context
            ? this.context.currentTime - this.current.started
            : 0)
        : 0,
      volume: this.volume,
      decodedTracks: this.buffers.size,
      loading: this.loading,
    };
  }
}
