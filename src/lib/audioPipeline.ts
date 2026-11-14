function downsampleTo16k(input: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === 16000) {
    return input;
  }
  const ratio = sourceRate / 16000;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const result = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[Math.min(idx + 1, input.length - 1)] ?? s0;
    result[i] = s0 + (s1 - s0) * frac;
  }
  return result;
}

function float32ToBase64Pcm16(floatData: Float32Array): string {
  const pcm16 = new Int16Array(floatData.length);
  for (let i = 0; i < floatData.length; i++) {
    const clamped = Math.max(-1, Math.min(1, floatData[i]));
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64Pcm16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(bytes.length / 2);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const int16 = view.getInt16(i * 2, true);
    float32[i] = int16 / 32768;
  }
  return float32;
}

export class VoiceAudioPipeline {
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private silentGainNode: GainNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private nextStartTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private isMuted = false;

  async startCapture(onAudioChunk: (base64Pcm16: string) => void): Promise<void> {
    this.stopCapture();

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.inputCtx = new AudioCtx({ sampleRate: 16000 });
    if (this.inputCtx.state === 'suspended') {
      await this.inputCtx.resume();
    }

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.sourceNode = this.inputCtx.createMediaStreamSource(this.micStream);
    this.inputAnalyser = this.inputCtx.createAnalyser();
    this.inputAnalyser.fftSize = 256;
    this.inputAnalyser.smoothingTimeConstant = 0.75;

    this.processorNode = this.inputCtx.createScriptProcessor(4096, 1, 1);
    this.silentGainNode = this.inputCtx.createGain();
    this.silentGainNode.gain.value = 0;

    this.sourceNode.connect(this.inputAnalyser);
    this.inputAnalyser.connect(this.processorNode);
    this.processorNode.connect(this.silentGainNode);
    this.silentGainNode.connect(this.inputCtx.destination);

    const actualRate = this.inputCtx.sampleRate;
    this.processorNode.onaudioprocess = (event) => {
      if (this.isMuted) return;
      const channelData = event.inputBuffer.getChannelData(0);
      const resampled = downsampleTo16k(channelData, actualRate);
      const base64 = float32ToBase64Pcm16(resampled);
      onAudioChunk(base64);
    };
  }

  ensureOutputContext(): AudioContext {
    if (!this.outputCtx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.outputCtx = new AudioCtx({ sampleRate: 24000 });
      this.outputAnalyser = this.outputCtx.createAnalyser();
      this.outputAnalyser.fftSize = 256;
      this.outputAnalyser.smoothingTimeConstant = 0.75;
      this.outputAnalyser.connect(this.outputCtx.destination);
      this.nextStartTime = this.outputCtx.currentTime;
    }
    if (this.outputCtx.state === 'suspended') {
      void this.outputCtx.resume();
    }
    return this.outputCtx;
  }

  playAudioChunk(base64Pcm16: string): void {
    const ctx = this.ensureOutputContext();
    const samples = base64Pcm16ToFloat32(base64Pcm16);
    if (samples.length === 0) return;

    const buffer = ctx.createBuffer(1, samples.length, 24000);
    buffer.getChannelData(0).set(samples);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (this.outputAnalyser) {
      source.connect(this.outputAnalyser);
    } else {
      source.connect(ctx.destination);
    }

    const now = ctx.currentTime;
    if (this.nextStartTime < now) {
      this.nextStartTime = now + 0.02;
    }
    const startAt = this.nextStartTime;
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
    };
  }

  interruptPlayback(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Ignore already stopped source
      }
    }
    this.activeSources.clear();
    if (this.outputCtx) {
      this.nextStartTime = this.outputCtx.currentTime;
    }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.micStream) {
      for (const track of this.micStream.getAudioTracks()) {
        track.enabled = !muted;
      }
    }
  }

  getLevels(): { inputLevel: number; outputLevel: number; isAssistantSpeaking: boolean } {
    const computeRms = (analyser: AnalyserNode | null): number => {
      if (!analyser) return 0;
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const normalized = (data[i] - 128) / 128;
        sum += normalized * normalized;
      }
      return Math.min(1, Math.sqrt(sum / data.length) * 3.5);
    };

    const inputLevel = this.isMuted ? 0 : computeRms(this.inputAnalyser);
    const outputLevel = computeRms(this.outputAnalyser);
    return {
      inputLevel,
      outputLevel,
      isAssistantSpeaking: this.activeSources.size > 0 || outputLevel > 0.04,
    };
  }

  stopCapture(): void {
    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.silentGainNode) {
      this.silentGainNode.disconnect();
      this.silentGainNode = null;
    }
    if (this.inputAnalyser) {
      this.inputAnalyser.disconnect();
      this.inputAnalyser = null;
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        track.stop();
      }
      this.micStream = null;
    }
    if (this.inputCtx) {
      void this.inputCtx.close().catch(() => {});
      this.inputCtx = null;
    }
  }

  destroy(): void {
    this.stopCapture();
    this.interruptPlayback();
    if (this.outputAnalyser) {
      this.outputAnalyser.disconnect();
      this.outputAnalyser = null;
    }
    if (this.outputCtx) {
      void this.outputCtx.close().catch(() => {});
      this.outputCtx = null;
    }
  }
}
