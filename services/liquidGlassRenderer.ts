/**
 * 液态玻璃渲染器 - 全屏 WebGL 背景层
 * 
 * 架构说明：
 * - 单一 WebGL Context，全屏渲染
 * - 接收来自 React DOM 的玻璃区域注册信息
 * - 使用全屏背景纹理，实现真实的透视效果
 */

export interface GlassRegion {
  id: string;
  x: number;        // 相对于视口的 x 坐标
  y: number;        // 相对于视口的 y 坐标
  width: number;    // 宽度（像素）
  height: number;   // 高度（像素）
  cornerRadius?: number;
  ior?: number;     // 折射率
  thickness?: number;
  normalStrength?: number;
  blurRadius?: number;
  highlightWidth?: number;
}

export class LiquidGlassRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private program: WebGLProgram | null = null;
  private bgProgram: WebGLProgram | null = null;
  private backgroundTexture: WebGLTexture | null = null;
  private regions: Map<string, GlassRegion> = new Map();
  private animationFrameId: number | null = null;
  private isInitialized = false;

  // Shader sources (从原版 app.js 移植)
  private readonly vsSource = `
    precision mediump float;
    attribute vec2 a_position;
    uniform vec2 u_resolution;
    uniform vec2 u_mousePos;
    uniform vec2 u_glassSize;
    varying vec2 v_screenTexCoord;
    varying vec2 v_shapeCoord;

    void main() {
      vec2 screenPos = u_mousePos + a_position * u_glassSize;
      vec2 clipSpacePos = (screenPos / u_resolution) * 2.0 - 1.0;
      gl_Position = vec4(clipSpacePos * vec2(1.0, -1.0), 0.0, 1.0);
      v_screenTexCoord = screenPos / u_resolution;
      v_screenTexCoord.y = 1.0 - v_screenTexCoord.y;
      v_shapeCoord = a_position;
    }
  `;

  private readonly fsSource = `
    precision mediump float;
    uniform sampler2D u_backgroundTexture;
    uniform vec2 u_resolution;
    uniform vec2 u_glassSize;
    uniform float u_cornerRadius;
    uniform float u_ior;
    uniform float u_glassThickness;
    uniform float u_normalStrength;
    uniform float u_displacementScale;
    uniform float u_heightTransitionWidth;
    uniform float u_sminSmoothing;
    uniform float u_blurRadius;
    uniform float u_highlightWidth;
    varying vec2 v_screenTexCoord;
    varying vec2 v_shapeCoord;

    float smin_polynomial(float a, float b, float k) {
      if (k <= 0.0) return min(a, b);
      float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
      return mix(b, a, h) - k * h * (1.0 - h);
    }

    float smax_polynomial(float a, float b, float k) {
      if (k <= 0.0) return max(a, b);
      float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
      return mix(b, a, h) + k * h * (1.0 - h);
    }

    float sdRoundedBoxSmooth(vec2 p, vec2 b, float r, float k_smooth) {
      if (k_smooth <= 0.0) {
        vec2 q = abs(p) - b + r;
        return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
      }
      vec2 q = abs(p) - b + r;
      float termA_smooth = smax_polynomial(q.x, q.y, k_smooth);
      float termB_smooth = smin_polynomial(termA_smooth, 0.0, k_smooth * 0.5);
      vec2 q_for_length_smooth = vec2(
        smax_polynomial(q.x, 0.0, k_smooth),
        smax_polynomial(q.y, 0.0, k_smooth)
      );
      float termC_smooth = length(q_for_length_smooth);
      return termB_smooth + termC_smooth - r;
    }

    float getHeightFromSDF(vec2 p_pixel_space, vec2 b_pixel_space, float r_pixel, float k_s, float transition_w) {
      float dist_sample = sdRoundedBoxSmooth(p_pixel_space, b_pixel_space, r_pixel, k_s);
      float normalized_dist = dist_sample / transition_w;
      const float steepness_factor = 6.0;
      float height = 1.0 - (1.0 / (1.0 + exp(-normalized_dist * steepness_factor)));
      return clamp(height, 0.0, 1.0);
    }

    void main() {
      float actualCornerRadius = min(u_cornerRadius, min(u_glassSize.x, u_glassSize.y) / 2.0);
      vec2 current_p_pixel = v_shapeCoord * u_glassSize;
      vec2 glass_half_size_pixel = u_glassSize / 2.0;
      float dist_for_shape_boundary = sdRoundedBoxSmooth(current_p_pixel, glass_half_size_pixel, actualCornerRadius, u_sminSmoothing);
      
      // 抗锯齿：使用平滑的 alpha 过渡替代硬性 discard
      // 边缘抗锯齿宽度（像素）
      float antialiasWidth = 1.5;
      float edgeAlpha = 1.0 - smoothstep(-antialiasWidth, antialiasWidth, dist_for_shape_boundary);
      
      // 如果完全在边界外，提前退出（性能优化）
      if (edgeAlpha <= 0.0) {
        discard;
      }

      vec2 pixel_step_in_norm_space = vec2(1.0 / u_glassSize.x, 1.0 / u_glassSize.y);
      float norm_step_x1 = pixel_step_in_norm_space.x * 0.75;
      float norm_step_y1 = pixel_step_in_norm_space.y * 0.75;
      float norm_step_x2 = pixel_step_in_norm_space.x * 1.5;
      float norm_step_y2 = pixel_step_in_norm_space.y * 1.5;

      float h_px1 = getHeightFromSDF((v_shapeCoord + vec2(norm_step_x1, 0.0)) * u_glassSize, glass_half_size_pixel, actualCornerRadius, u_sminSmoothing, u_heightTransitionWidth);
      float h_nx1 = getHeightFromSDF((v_shapeCoord - vec2(norm_step_x1, 0.0)) * u_glassSize, glass_half_size_pixel, actualCornerRadius, u_sminSmoothing, u_heightTransitionWidth);
      float h_px2 = getHeightFromSDF((v_shapeCoord + vec2(norm_step_x2, 0.0)) * u_glassSize, glass_half_size_pixel, actualCornerRadius, u_sminSmoothing, u_heightTransitionWidth);
      float h_nx2 = getHeightFromSDF((v_shapeCoord - vec2(norm_step_x2, 0.0)) * u_glassSize, glass_half_size_pixel, actualCornerRadius, u_sminSmoothing, u_heightTransitionWidth);

      float grad_x1 = (h_px1 - h_nx1) / (2.0 * norm_step_x1 * u_glassSize.x);
      float grad_x2 = (h_px2 - h_nx2) / (2.0 * norm_step_x2 * u_glassSize.x);
      float delta_x = mix(grad_x1, grad_x2, 0.5);

      float h_py1 = getHeightFromSDF((v_shapeCoord + vec2(0.0, norm_step_y1)) * u_glassSize, glass_half_size_pixel, actualCornerRadius, u_sminSmoothing, u_heightTransitionWidth);
      float h_ny1 = getHeightFromSDF((v_shapeCoord - vec2(0.0, norm_step_y1)) * u_glassSize, glass_half_size_pixel, actualCornerRadius, u_sminSmoothing, u_heightTransitionWidth);
      float h_py2 = getHeightFromSDF((v_shapeCoord + vec2(0.0, norm_step_y2)) * u_glassSize, glass_half_size_pixel, actualCornerRadius, u_sminSmoothing, u_heightTransitionWidth);
      float h_ny2 = getHeightFromSDF((v_shapeCoord - vec2(0.0, norm_step_y2)) * u_glassSize, glass_half_size_pixel, actualCornerRadius, u_sminSmoothing, u_heightTransitionWidth);

      float grad_y1 = (h_py1 - h_ny1) / (2.0 * norm_step_y1 * u_glassSize.y);
      float grad_y2 = (h_py2 - h_ny2) / (2.0 * norm_step_y2 * u_glassSize.y);
      float delta_y = mix(grad_y1, grad_y2, 0.5);

      vec3 surfaceNormal3D = normalize(vec3(-delta_x * u_normalStrength, -delta_y * u_normalStrength, 1.0));

      vec3 incidentLightDir = normalize(vec3(0.0, 0.0, -1.0));
      vec3 refractedIntoGlass = refract(incidentLightDir, surfaceNormal3D, 1.0 / u_ior);
      vec3 refractedOutOfGlass = refract(refractedIntoGlass, -surfaceNormal3D, u_ior);

      vec2 offset_in_pixels = refractedOutOfGlass.xy * u_glassThickness;
      vec2 offset = (offset_in_pixels / u_resolution) * u_displacementScale;
      vec2 refractedTexCoord = v_screenTexCoord + offset;
      refractedTexCoord = clamp(refractedTexCoord, 0.001, 0.999);

      vec4 blurredColor = vec4(0.0);
      vec2 texelSize = 1.0 / u_resolution;
      float blurPixelRadius = u_blurRadius;

      blurredColor += texture2D(u_backgroundTexture, refractedTexCoord + vec2(-1.0, -1.0) * blurPixelRadius * texelSize);
      blurredColor += texture2D(u_backgroundTexture, refractedTexCoord + vec2( 0.0, -1.0) * blurPixelRadius * texelSize);
      blurredColor += texture2D(u_backgroundTexture, refractedTexCoord + vec2( 1.0, -1.0) * blurPixelRadius * texelSize);
      blurredColor += texture2D(u_backgroundTexture, refractedTexCoord + vec2(-1.0,  0.0) * blurPixelRadius * texelSize);
      blurredColor += texture2D(u_backgroundTexture, refractedTexCoord + vec2( 0.0,  0.0) * blurPixelRadius * texelSize);
      blurredColor += texture2D(u_backgroundTexture, refractedTexCoord + vec2( 1.0,  0.0) * blurPixelRadius * texelSize);
      blurredColor += texture2D(u_backgroundTexture, refractedTexCoord + vec2(-1.0,  1.0) * blurPixelRadius * texelSize);
      blurredColor += texture2D(u_backgroundTexture, refractedTexCoord + vec2( 0.0,  1.0) * blurPixelRadius * texelSize);
      blurredColor += texture2D(u_backgroundTexture, refractedTexCoord + vec2( 1.0,  1.0) * blurPixelRadius * texelSize);
      blurredColor /= 9.0;

      float height_val = getHeightFromSDF(current_p_pixel, glass_half_size_pixel, actualCornerRadius, u_sminSmoothing, u_heightTransitionWidth);
      vec4 finalColor = mix(blurredColor, vec4(1.0, 1.0, 1.0, 1.0), height_val * 0.15);

      float highlight_dist = abs(dist_for_shape_boundary);
      float highlight_alpha = 1.0 - smoothstep(0.0, u_highlightWidth, highlight_dist);
      highlight_alpha = max(0.0, highlight_alpha);
      float directionalFactor = (surfaceNormal3D.x * surfaceNormal3D.y + 1.0) * 0.5;
      float finalHighlightAlpha = highlight_alpha * directionalFactor;

      gl_FragColor = mix(finalColor, vec4(1.0, 1.0, 1.0, 1.0), finalHighlightAlpha);
    }
  `;

  private readonly bgVsSource = `
    attribute vec2 a_position;
    varying vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = (a_position + 1.0) / 2.0;
    }
  `;

  private readonly bgFsSource = `
    precision mediump float;
    uniform sampler2D u_backgroundTexture;
    varying vec2 v_texCoord;
    void main() {
      gl_FragColor = texture2D(u_backgroundTexture, v_texCoord);
    }
  `;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    
    // 尝试获取 WebGL 上下文，支持多种方式
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl', { 
        alpha: true, 
        antialias: true,
        preserveDrawingBuffer: false,
        premultipliedAlpha: false // 确保 alpha 混合正确
      }) as WebGLRenderingContext;
    } catch (e) {
      console.warn('Failed to get webgl context with options:', e);
    }
    
    // Fallback: 尝试 experimental-webgl
    if (!gl) {
      try {
        gl = canvas.getContext('experimental-webgl') as WebGLRenderingContext;
      } catch (e) {
        console.warn('Failed to get experimental-webgl context:', e);
      }
    }
    
    if (!gl) {
      const error = new Error('WebGL not supported in this browser/environment');
      console.error('[LiquidGlassRenderer]', error);
      throw error;
    }
    
    this.gl = gl;
    console.log('[LiquidGlassRenderer] WebGL context created successfully', {
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION)
    });
  }

  async initialize(backgroundImageUrl?: string): Promise<void> {
    if (this.isInitialized) {
      console.log('Renderer already initialized');
      return;
    }

    console.log('Initializing LiquidGlassRenderer...');
    
    // 编译着色器
    this.program = this.createProgram(this.vsSource, this.fsSource);
    this.bgProgram = this.createProgram(this.bgVsSource, this.bgFsSource);
    
    if (!this.program || !this.bgProgram) {
      throw new Error('Failed to create shader programs');
    }
    
    console.log('Shaders compiled successfully');

    // 创建背景纹理
    this.backgroundTexture = this.gl.createTexture();
    if (!this.backgroundTexture) {
      throw new Error('Failed to create texture');
    }

    // 加载背景图片
    if (backgroundImageUrl) {
      try {
        await this.loadBackgroundTexture(backgroundImageUrl);
        console.log('Background texture loaded successfully');
      } catch (error) {
        console.warn('Failed to load background texture (will use default):', error);
        // 使用默认背景作为后备（不抛出错误，让渲染器继续工作）
        this.setDefaultTexture();
        console.log('Using default texture as fallback');
      }
    } else {
      // 使用默认背景
      this.setDefaultTexture();
    }

    this.isInitialized = true;
    this.startRenderLoop();
  }

  private createShader(type: number, source: string): WebGLShader | null {
    const shader = this.gl.createShader(type);
    if (!shader) return null;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private createProgram(vsSource: string, fsSource: string): WebGLProgram {
    const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vsSource);
    const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fsSource);
    if (!vertexShader || !fragmentShader) {
      throw new Error('Failed to create shaders');
    }

    const program = this.gl.createProgram();
    if (!program) {
      throw new Error('Failed to create program');
    }

    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      console.error('Program link error:', this.gl.getProgramInfoLog(program));
      throw new Error('Program link error');
    }

    return program;
  }

  private async loadBackgroundTexture(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      
      // 尝试设置 CORS，但如果失败则继续（某些环境可能不支持）
      try {
        image.crossOrigin = 'anonymous';
      } catch (e) {
        console.warn('Could not set crossOrigin, trying without CORS:', e);
      }
      
      // 设置超时（10秒）
      const timeout = setTimeout(() => {
        console.warn('Image load timeout, using default texture');
        image.onload = null;
        image.onerror = null;
        reject(new Error('Image load timeout'));
      }, 10000);
      
      image.onload = () => {
        clearTimeout(timeout);
        if (!this.backgroundTexture) {
          reject(new Error('Texture was destroyed'));
          return;
        }
        
        try {
          this.gl.bindTexture(this.gl.TEXTURE_2D, this.backgroundTexture);
          this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
          this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, image);
          
          // 设置纹理参数
          if (this.isPowerOf2(image.width) && this.isPowerOf2(image.height)) {
            this.gl.generateMipmap(this.gl.TEXTURE_2D);
          } else {
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
          }
          console.log(`Background texture loaded: ${image.width}x${image.height}`);
          resolve();
        } catch (error) {
          console.error('Error uploading texture to GPU:', error);
          reject(error);
        }
      };
      
      image.onerror = (error) => {
        clearTimeout(timeout);
        console.error('Image load error (CORS or network issue):', error, 'URL:', url);
        // 不直接 reject，让调用者决定是否使用默认纹理
        reject(new Error(`Failed to load image: ${url}. This might be a CORS issue.`));
      };
      
      // 开始加载
      try {
        image.src = url;
      } catch (error) {
        clearTimeout(timeout);
        reject(new Error(`Invalid image URL: ${url}`));
      }
    });
  }

  private isPowerOf2(value: number): boolean {
    return (value & (value - 1)) === 0;
  }

  private setDefaultTexture(): void {
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.backgroundTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      1,
      1,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      new Uint8Array([100, 150, 200, 255]) // 浅蓝色背景
    );
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
  }

  // 注册/更新玻璃区域
  registerRegion(region: GlassRegion): void {
    this.regions.set(region.id, region);
    console.log(`[LiquidGlassRenderer] Region registered: ${region.id}`, {
      count: this.regions.size,
      region: { x: region.x, y: region.y, width: region.width, height: region.height }
    });
  }

  // 注销玻璃区域
  unregisterRegion(id: string): void {
    this.regions.delete(id);
  }

  // 更新背景纹理（用于捕获页面背景）
  updateBackgroundTexture(imageUrl: string): void {
    this.loadBackgroundTexture(imageUrl);
  }

  private startRenderLoop(): void {
    const render = () => {
      this.render();
      this.animationFrameId = requestAnimationFrame(render);
    };
    render();
  }

  private render(): void {
    // 更新 canvas 尺寸 - 使用 window 尺寸确保正确
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }

    // 如果 canvas 尺寸为 0，跳过渲染
    if (width === 0 || height === 0) return;

    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    if (!this.program || !this.bgProgram || !this.backgroundTexture) {
      console.warn('Renderer not fully initialized:', {
        program: !!this.program,
        bgProgram: !!this.bgProgram,
        texture: !!this.backgroundTexture
      });
      return;
    }

    // 绘制背景
    this.renderBackground();

    // 绘制所有玻璃区域
    this.regions.forEach(region => {
      this.renderGlassRegion(region);
    });
  }

  private renderBackground(): void {
    if (!this.bgProgram || !this.backgroundTexture) return;

    const positions = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
    const positionBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(positions), this.gl.STATIC_DRAW);

    this.gl.useProgram(this.bgProgram);
    const positionLoc = this.gl.getAttribLocation(this.bgProgram, 'a_position');
    this.gl.enableVertexAttribArray(positionLoc);
    this.gl.vertexAttribPointer(positionLoc, 2, this.gl.FLOAT, false, 0, 0);

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.backgroundTexture);
    const textureLoc = this.gl.getUniformLocation(this.bgProgram, 'u_backgroundTexture');
    this.gl.uniform1i(textureLoc, 0);

    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }

  private renderGlassRegion(region: GlassRegion): void {
    if (!this.program || !this.backgroundTexture) return;

    const positions = [-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5];
    const positionBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(positions), this.gl.STATIC_DRAW);

    this.gl.useProgram(this.program);

    // 设置 attributes
    const positionLoc = this.gl.getAttribLocation(this.program, 'a_position');
    this.gl.enableVertexAttribArray(positionLoc);
    this.gl.vertexAttribPointer(positionLoc, 2, this.gl.FLOAT, false, 0, 0);

    // 设置 uniforms
    const resolutionLoc = this.gl.getUniformLocation(this.program, 'u_resolution');
    const mousePosLoc = this.gl.getUniformLocation(this.program, 'u_mousePos');
    const glassSizeLoc = this.gl.getUniformLocation(this.program, 'u_glassSize');
    const cornerRadiusLoc = this.gl.getUniformLocation(this.program, 'u_cornerRadius');
    const iorLoc = this.gl.getUniformLocation(this.program, 'u_ior');
    const thicknessLoc = this.gl.getUniformLocation(this.program, 'u_glassThickness');
    const normalStrengthLoc = this.gl.getUniformLocation(this.program, 'u_normalStrength');
    const displacementScaleLoc = this.gl.getUniformLocation(this.program, 'u_displacementScale');
    const heightTransitionLoc = this.gl.getUniformLocation(this.program, 'u_heightTransitionWidth');
    const sminSmoothingLoc = this.gl.getUniformLocation(this.program, 'u_sminSmoothing');
    const blurRadiusLoc = this.gl.getUniformLocation(this.program, 'u_blurRadius');
    const highlightWidthLoc = this.gl.getUniformLocation(this.program, 'u_highlightWidth');

    this.gl.uniform2f(resolutionLoc, this.canvas.width, this.canvas.height);
    this.gl.uniform2f(mousePosLoc, region.x + region.width / 2, region.y + region.height / 2);
    this.gl.uniform2f(glassSizeLoc, region.width, region.height);
    // 使用从 demo 调优的参数作为默认值
    this.gl.uniform1f(cornerRadiusLoc, region.cornerRadius ?? 32);
    this.gl.uniform1f(iorLoc, region.ior ?? 1.1);
    this.gl.uniform1f(thicknessLoc, region.thickness ?? 30.2);
    this.gl.uniform1f(normalStrengthLoc, region.normalStrength ?? 4);
    this.gl.uniform1f(displacementScaleLoc, 3.6); // Displacement Scale
    this.gl.uniform1f(heightTransitionLoc, 13.0); // Height Transition (px)
    this.gl.uniform1f(sminSmoothingLoc, 30.0); // SDF Smoothing (k) - 增加以改善圆角平滑度
    this.gl.uniform1f(blurRadiusLoc, region.blurRadius ?? 3);
    this.gl.uniform1f(highlightWidthLoc, region.highlightWidth ?? 1);

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.backgroundTexture);
    const textureLoc = this.gl.getUniformLocation(this.program, 'u_backgroundTexture');
    this.gl.uniform1i(textureLoc, 0);

    // 启用混合以实现透明效果（优化抗锯齿）
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    // 使用更平滑的混合模式以改善边缘
    this.gl.blendEquation(this.gl.FUNC_ADD);

    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

    this.gl.disable(this.gl.BLEND);
  }

  destroy(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.regions.clear();
    if (this.backgroundTexture) {
      this.gl.deleteTexture(this.backgroundTexture);
    }
    if (this.program) {
      this.gl.deleteProgram(this.program);
    }
    if (this.bgProgram) {
      this.gl.deleteProgram(this.bgProgram);
    }
  }
}
