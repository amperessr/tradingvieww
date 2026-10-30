// 內建錄影：用瀏覽器的分頁擷取（getDisplayMedia）錄下目前的分頁，
// 可以只錄圖表區（Element Capture / Region Capture），停止後自動下載影片檔。

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find(m => MediaRecorder.isTypeSupported(m)) || '';
}

export class Recorder {
  // opts: { getTarget: () => Element, fileName: () => string, onState(state), toast(title, text, kind) }
  constructor(opts) {
    Object.assign(this, opts);
    this.recording = false;
    this.startedAt = 0;
  }

  get supported() {
    return !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined';
  }

  async start({ area = 'chart', fps = 60, scale = 1 } = {}) {
    if (this.recording) return;
    if (!this.supported) {
      this.toast('無法錄影', '這個瀏覽器不支援分頁錄影，請改用最新版的 Chrome 或 Edge', 'err');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        // 不給上限的話 Chrome 常會把分頁畫面縮小，這裡允許最高 4K
        video: { frameRate: { ideal: fps, max: fps }, displaySurface: 'browser', width: { max: 3840 }, height: { max: 2160 } },
        audio: false,
        preferCurrentTab: true,          // Chrome / Edge：直接詢問要不要錄「這個分頁」
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        monitorTypeSurfaces: 'exclude',
      });
    } catch (err) {
      if (err?.name !== 'NotAllowedError') this.toast('無法錄影', String(err?.message || err), 'err');
      return;
    }
    const [track] = stream.getVideoTracks();

    // 只錄圖表區：優先用 Element Capture（只錄元素本身，蓋在上面的提示框不會被錄進去），不支援時改用 Region Capture 裁切
    this.areaMode = 'page';
    if (area === 'chart') {
      const el = this.getTarget();
      try {
        if (window.RestrictionTarget && track.restrictTo) {
          await track.restrictTo(await RestrictionTarget.fromElement(el));
          this.areaMode = 'element';
        } else if (window.CropTarget && track.cropTo) {
          await track.cropTo(await CropTarget.fromElement(el));
          this.areaMode = 'crop';
        }
      } catch {
        try {
          if (window.CropTarget && track.cropTo) { await track.cropTo(await CropTarget.fromElement(el)); this.areaMode = 'crop'; }
        } catch { /* 錄整個畫面 */ }
      }
      if (this.areaMode === 'page') this.toast('錄影', '沒辦法只裁切圖表區（可能選了別的分頁或瀏覽器不支援），會錄下整個畫面', 'info');
    }

    // 瀏覽器預設會把分頁畫面縮小（常常只有 800 寬），這裡要求用錄影範圍的實際像素大小錄
    const box = this.areaMode === 'page' ? { width: innerWidth, height: innerHeight } : this.getTarget().getBoundingClientRect();
    // 不用 devicePixelRatio：Chrome 擷取分頁時會自動把它拉高到 2，影片會變得很大
    const even = v => Math.max(2, Math.round((v * scale) / 2) * 2);   // H.264 需要偶數尺寸
    await new Promise(r => setTimeout(r, 300));   // 裁切剛套用時尺寸還沒更新，稍等一下再設定
    try {
      await track.applyConstraints({ width: even(box.width), height: even(box.height), resizeMode: 'crop-and-scale', frameRate: { ideal: fps, max: fps } });
    } catch { /* 用瀏覽器預設大小 */ }

    this.mime = pickMime();
    const rec = new MediaRecorder(stream, { ...(this.mime ? { mimeType: this.mime } : {}), videoBitsPerSecond: scale > 1 ? 24_000_000 : 12_000_000 });
    this.chunks = [];
    rec.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    rec.onstop = () => this._save();
    track.addEventListener('ended', () => this.stop());   // 使用者按了瀏覽器的「停止分享」
    rec.start(1000);
    this.rec = rec;
    this.stream = stream;
    this.recording = true;
    this.startedAt = performance.now();
    this.onState?.({ recording: true, areaMode: this.areaMode });
    this._tick = setInterval(() => this.onState?.({ recording: true, areaMode: this.areaMode, elapsed: this.elapsed }), 250);
  }

  get elapsed() { return this.recording ? (performance.now() - this.startedAt) / 1000 : 0; }

  stop() {
    if (!this.recording) return;
    this.recording = false;
    clearInterval(this._tick);
    try { this.rec.state !== 'inactive' && this.rec.stop(); } catch { /* 已停止 */ }
    this.stream.getTracks().forEach(t => t.stop());
    this.onState?.({ recording: false });
  }

  _save() {
    const type = this.rec.mimeType || this.mime || 'video/webm';
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(this.chunks, { type });
    this.chunks = [];
    if (!blob.size) { this.toast('錄影', '沒有錄到任何畫面', 'err'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.fileName()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    this.lastFile = { name: a.download, size: blob.size, type };
    this.toast('錄影已儲存', `${a.download}（${(blob.size / 1048576).toFixed(1)} MB）`, 'ok');
  }
}
