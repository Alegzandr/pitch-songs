import { memo, useEffect, useRef } from 'react';
import { animatedBackdropAllowed } from './motion';
import { detectGpuTier } from './webgl/gpu';
import { IDLE_FRAME_MS, frameDeltaSeconds } from './frameClock';
import { createMoodPaletteCache, readEnergyVar } from './paletteReader';

/**
 * The living layer of the ambient scene - aurora veils breathing over the
 * photo backdrop, drawn by a WebGL2 fragment shader and fed by the music.
 *
 * A domain-warped fbm field renders slow curtains of light tinted between the
 * mood's ambient and accent colours. While a track plays, the calibrated
 * `--audio-*` variables (inline-style reads, published by useAudioReactivity)
 * drive it: bass swells the field, mids quicken its drift, treble sprinkles a
 * fine shimmer, overall level lifts the veil's luminance. Idle, it settles to
 * a barely-there breath - a living wallpaper, never a visualiser.
 *
 * Fallback chain, by construction: this component renders nothing under
 * `prefers-reduced-motion` / touch (animatedBackdropAllowed), on the software
 * GPU tier, or when WebGL2 is unavailable - in every one of those worlds the
 * scene keeps today's CSS haze exactly as it was. The canvas renders at ~40%
 * resolution (the field is cloud-soft, upscaling is free quality) and pauses
 * whenever the tab is hidden.
 */

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uColorA;   /* mood accent */
uniform vec3 uColorB;   /* mood ambient */
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uLevel;
out vec4 outColor;

/* iq-style value noise + fbm - cheap, smooth, good enough for veils. */
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.0, 9.0);
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = vec2(uv.x * uRes.x / uRes.y, uv.y);
  float t = uTime;

  /* Domain warp: the veils fold instead of scrolling. Bass inflates the field. */
  vec2 q = vec2(
    fbm(p * 1.3 + vec2(0.0, t * 0.045)),
    fbm(p * 1.3 + vec2(5.2, t * 0.036))
  );
  float f = fbm(p * (1.5 + uBass * 0.55) + q * (1.5 + uMid * 0.5) + vec2(t * 0.028, -t * 0.015));

  /* Curtain body (tight ramp = readable folds) + a treble shimmer riding it. */
  float veil = smoothstep(0.48, 0.86, f);
  float shimmer = noise(p * 6.0 + vec2(t * 0.6, t * 0.45)) * uTreble;

  vec3 col = mix(uColorB, uColorA, clamp(f * 1.4 - 0.25 + uMid * 0.25, 0.0, 1.0));

  /* Luminance: a quiet base so the idle scene still breathes, lifted by the
     track's level and bass. Vertical mask keeps the top/bottom edges calm. */
  float lum = veil * (0.06 + uLevel * 0.16 + uBass * 0.12) + shimmer * veil * 0.24;
  float mask = smoothstep(0.02, 0.30, uv.y) * smoothstep(1.05, 0.55, uv.y);

  outColor = vec4(col * lum * mask, 0.0); /* additive: colour IS the light */
}
`;

const parseTriplet = (value: string, fallback: [number, number, number]): [number, number, number] => {
  const m = value.split(',').map((x) => parseFloat(x));
  if (m.length < 3 || m.some((n) => Number.isNaN(n))) return fallback;
  return [m[0] / 255, m[1] / 255, m[2] / 255];
};

export const SceneAurora = memo(function SceneAurora() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Gate once per mount: reduced-motion/touch and the software tier never pay
  // for a context; the CSS haze is their whole experience.
  const allowed = animatedBackdropAllowed() && detectGpuTier() !== 'software';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !allowed) return;
    // Hidden until an init succeeds: a WebGL canvas whose context is dead (or
    // never came up) composites as an opaque white sheet - never show one.
    canvas.style.display = 'none';
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    });
    if (!gl) return;

    type Loc = Record<'res' | 'time' | 'colorA' | 'colorB' | 'bass' | 'mid' | 'treble' | 'level', WebGLUniformLocation | null>;
    let loc: Loc | null = null;
    // GPU handles kept for explicit deletion: contexts survive unmount (see the
    // cleanup note below), so without this the program/buffer of every
    // daybreak↔photo switch would linger until the canvas itself is GC'd.
    let prog: WebGLProgram | null = null;
    let buf: WebGLBuffer | null = null;

    const releaseGpuResources = () => {
      if (prog) {
        gl.deleteProgram(prog);
        prog = null;
      }
      if (buf) {
        gl.deleteBuffer(buf);
        buf = null;
      }
    };

    // (Re)build the whole pipeline on the current context. Returns false when
    // the context is unusable (lost, compile failure) - the canvas stays hidden.
    const setup = (): boolean => {
      if (gl.isContextLost()) return false;
      releaseGpuResources(); // context-restore path: drop stale handles first
      const compile = (type: number, src: string) => {
        const sh = gl.createShader(type);
        if (!sh) return null;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          gl.deleteShader(sh);
          return null;
        }
        return sh;
      };
      const vs = compile(gl.VERTEX_SHADER, VERT);
      const fs = compile(gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) {
        if (vs) gl.deleteShader(vs);
        if (fs) gl.deleteShader(fs);
        return false;
      }
      prog = gl.createProgram();
      if (!prog) return false;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      // Shaders are owned by the program once linked (pass or fail) - flag them
      // for deletion now so they free together with it.
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        releaseGpuResources();
        return false;
      }
      gl.useProgram(prog);

      // One full-screen triangle - no index buffer, no overdraw seams.
      buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE); // pure light over the photo

      loc = {
        res: gl.getUniformLocation(prog, 'uRes'),
        time: gl.getUniformLocation(prog, 'uTime'),
        colorA: gl.getUniformLocation(prog, 'uColorA'),
        colorB: gl.getUniformLocation(prog, 'uColorB'),
        bass: gl.getUniformLocation(prog, 'uBass'),
        mid: gl.getUniformLocation(prog, 'uMid'),
        treble: gl.getUniformLocation(prog, 'uTreble'),
        level: gl.getUniformLocation(prog, 'uLevel'),
      };
      return true;
    };

    // Palette: refreshed only on a mood change (or during the cross-fade) -
    // getComputedStyle is a style flush, never a steady-state per-frame cost.
    let colorA: [number, number, number] = [1, 0.6, 0.7];
    let colorB: [number, number, number] = [0.3, 0.75, 0.97];
    const palette = createMoodPaletteCache(() => {
      const cs = getComputedStyle(canvas);
      colorA = parseTriplet(cs.getPropertyValue('--color-accent').trim(), colorA);
      colorB = parseTriplet(cs.getPropertyValue('--color-ambient').trim(), colorB);
    });

    let raf = 0;
    let disposed = false;
    let time = 0;
    let lastNow = -1;
    let lastIdleDraw = 0;

    // Layout size cached outside the frame loop: reading clientWidth/Height per
    // frame is a layout query that can force a reflow while styles are churning
    // (the --audio-* vars invalidate style every frame during playback).
    let viewW = 0;
    let viewH = 0;
    const measure = () => {
      viewW = canvas.clientWidth;
      viewH = canvas.clientHeight;
    };
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    resizeObserver?.observe(canvas);

    const frame = (now: number) => {
      if (disposed || !loc) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;

      const level = readEnergyVar('--audio-level');
      // Idle throttle: without music the veils drift slowly - 30fps is plenty.
      const live = level > 0.015;
      if (!live && now - lastIdleDraw < IDLE_FRAME_MS) return;
      lastIdleDraw = now;

      const dt = frameDeltaSeconds(now, lastNow);
      lastNow = now;

      const mid = readEnergyVar('--audio-mid');
      // Mids quicken the drift; the clock itself breathes with the music.
      time += dt * (1 + mid * 1.6);

      palette.ensure();

      // ~40% render scale; the field is cloud-soft so upscaling is invisible.
      const w = Math.max(2, Math.round(viewW * 0.4));
      const h = Math.max(2, Math.round(viewH * 0.4));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }

      gl.uniform2f(loc.res, w, h);
      gl.uniform1f(loc.time, time);
      gl.uniform3f(loc.colorA, colorA[0], colorA[1], colorA[2]);
      gl.uniform3f(loc.colorB, colorB[0], colorB[1], colorB[2]);
      gl.uniform1f(loc.bass, readEnergyVar('--audio-bass'));
      gl.uniform1f(loc.mid, mid);
      gl.uniform1f(loc.treble, readEnergyVar('--audio-treble'));
      gl.uniform1f(loc.level, level);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const start = () => {
      if (disposed) return;
      if (!setup()) return; // stays hidden - the CSS haze is the experience
      canvas.style.display = '';
      // One direct read now that the canvas is displayed (a hidden canvas
      // measures 0×0); the ResizeObserver keeps it fresh from here on.
      measure();
      lastNow = -1;
      raf = requestAnimationFrame(frame);
    };

    const onLost = (e: Event) => {
      e.preventDefault();
      stop();
      canvas.style.display = 'none';
    };
    const onRestored = () => start();
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    if (gl.isContextLost()) {
      // A prior cleanup (React StrictMode re-runs effects on the same node) or
      // a driver reset left this canvas's context dead - ask for it back; init
      // resumes on 'webglcontextrestored'.
      gl.getExtension('WEBGL_lose_context')?.restoreContext();
    } else {
      start();
    }

    return () => {
      disposed = true;
      stop();
      resizeObserver?.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      // Free the GPU-side objects eagerly; a daybreak↔photo switch would
      // otherwise leave each unmounted canvas's program/buffer alive until GC.
      releaseGpuResources();
      // Deliberately NO loseContext here: killing the context in cleanup turns
      // the canvas into a dead white surface when React StrictMode re-runs the
      // effect on the same node. The context is reclaimed with the canvas when
      // it actually leaves the DOM.
    };
  }, [allowed]);

  if (!allowed) return null;

  return <canvas ref={canvasRef} className="scene-aurora-veil" aria-hidden="true" />;
});
