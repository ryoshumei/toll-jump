// Post-processing: 4x MSAA HDR target -> RenderPass -> half-res UnrealBloom -> vignette/grain/chromatic
// aberration (grows with speed) -> OutputPass (ACES tone mapping + sRGB).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uAberr: { value: 0.002 },
    uVig: { value: 0.42 },
    uGrain: { value: 0.045 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uAberr; uniform float uVig; uniform float uGrain;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float d = length(c);
      vec2 off = c * d * uAberr;
      float r = texture2D(tDiffuse, vUv + off).r;
      vec4 mid = texture2D(tDiffuse, vUv);
      float b = texture2D(tDiffuse, vUv - off).b;
      vec3 col = vec3(r, mid.g, b);
      col *= 1.0 - uVig * smoothstep(0.28, 0.95, d * 1.3);
      float n = hash(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5;
      col *= 1.0 + n * uGrain;
      gl_FragColor = vec4(col, mid.a);
    }`,
};

export class Post {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private readonly finalPass: ShaderPass;
  private readonly bloomScale: number;

  constructor(
    private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
    w: number, h: number, dpr: number, samples: number, bloomScale: number,
  ) {
    this.bloomScale = bloomScale;
    const rt = new THREE.WebGLRenderTarget(w * dpr, h * dpr, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.renderTarget2.samples = 0; // only the scene target needs MSAA; the swaps are even
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w * dpr * 0.5, h * dpr * 0.5), 0.5 * bloomScale, 0.55, 0.9);
    this.composer.addPass(this.bloom);
    this.finalPass = new ShaderPass(FinalShader);
    this.composer.addPass(this.finalPass);
    this.composer.addPass(new OutputPass());
    this.setSize(w, h, dpr);
  }

  setSize(w: number, h: number, dpr: number): void {
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.bloom.setSize(Math.round(w * dpr * 0.5), Math.round(h * dpr * 0.5)); // bloom at half resolution
  }

  /** speed01: 0..1 of top speed. */
  setSpeed(speed01: number): void {
    this.finalPass.uniforms.uAberr.value = 0.0016 + speed01 * 0.0042;
  }

  setBloomStrength(s: number): void {
    this.bloom.strength = s * this.bloomScale;
  }

  render(dt: number, time: number): void {
    this.finalPass.uniforms.uTime.value = time;
    this.composer.render(dt);
  }
}
