# 液态玻璃效果架构说明

## ✅ 正确的架构实现

根据你的分析，我们采用了**分层渲染架构**，而不是错误的组件化封装。

### 核心架构

```
┌─────────────────────────────────────┐
│  顶层：React DOM 交互层 (z-index: 1+) │
│  - PostCard 组件（透明背景）          │
│  - 处理所有用户交互                   │
│  - 将位置信息传递给 WebGL 层          │
└─────────────────────────────────────┘
              ↓ 注册玻璃区域
┌─────────────────────────────────────┐
│  底层：WebGL 渲染层 (z-index: -1)    │
│  - 全屏固定 Canvas                   │
│  - 单一 WebGL Context                │
│  - 渲染所有液态玻璃效果               │
│  - 使用全屏背景纹理                   │
└─────────────────────────────────────┘
```

## 为什么这个架构是正确的？

### 1. **解决视觉隔离问题**
- ✅ WebGL Canvas 使用全屏背景纹理，可以"看到"整个页面背景
- ✅ 不是每个组件加载自己的静态图片，而是统一使用一个背景源

### 2. **解决坐标系问题**
- ✅ 使用视口坐标系（Viewport Coordinates）
- ✅ 每个 PostCard 通过 `getBoundingClientRect()` 获取相对于视口的位置
- ✅ WebGL Shader 使用 `v_screenTexCoord` 正确映射到全屏背景

### 3. **解决性能问题**
- ✅ 单一 WebGL Context，所有玻璃效果在一个渲染循环中处理
- ✅ 多个 PostCard 共享同一个渲染器实例
- ✅ 通过注册系统管理多个玻璃区域，而不是创建多个 Context

## 文件结构

```
services/
  └── liquidGlassRenderer.ts    # WebGL 渲染器核心类
components/
  └── LiquidGlassBackground.tsx  # 全屏背景层组件
hooks/
  └── useLiquidGlass.ts          # React Hook，用于注册玻璃区域
components/
  └── PostCard.tsx               # 修改后的卡片组件（透明 + 注册）
App.tsx                          # 集成点
```

## 使用方法

### 1. 启用液态玻璃效果

在 App.tsx 中，点击 "Glass" 按钮即可切换效果。

### 2. PostCard 自动注册

当 `enableLiquidGlass={true}` 时，每个 PostCard 会：
- 自动注册到 WebGL 渲染器
- 在滚动时自动更新位置
- 移除 CSS glassmorphism 样式，改为透明

### 3. 自定义参数

可以在 `useLiquidGlass` hook 中自定义参数：

```typescript
register({
  x: rect.left,
  y: rect.top,
  width: rect.width,
  height: rect.height,
  cornerRadius: 32,      // 圆角半径
  ior: 1.1,             // 折射率
  thickness: 41,         // 玻璃厚度
  normalStrength: 6.4,   // 法线强度
  blurRadius: 0.0,       // 模糊半径（磨砂效果）
  highlightWidth: 3.5,   // 高光宽度
});
```

## 技术细节

### 背景纹理加载

目前使用 Unsplash 图片作为背景。未来可以：
1. 使用 `html2canvas` 捕获页面背景
2. 或者直接使用 CSS `background-image` 的 URL

### 性能优化

- 自动更新间隔：100ms（可在 `useLiquidGlass` 中调整）
- 仅在启用时渲染
- 使用 `requestAnimationFrame` 优化渲染循环

### 响应式处理

- 监听 `scroll` 和 `resize` 事件
- 自动更新所有注册区域的位置
- 窗口大小变化时自动调整 Canvas 尺寸

## 与错误架构的对比

| 错误架构（组件化） | 正确架构（分层渲染） |
|------------------|-------------------|
| ❌ 每个组件一个 Canvas | ✅ 单一全屏 Canvas |
| ❌ 每个组件一个 WebGL Context | ✅ 单一 WebGL Context |
| ❌ 组件内加载静态背景图 | ✅ 全屏背景纹理 |
| ❌ 局部坐标系混乱 | ✅ 统一的视口坐标系 |
| ❌ 性能灾难（多个 Context） | ✅ 高性能（一次渲染） |

## 下一步优化

1. **背景捕获**：使用 `html2canvas` 或类似工具实时捕获页面背景
2. **性能监控**：添加 FPS 监控，优化渲染性能
3. **更多形状**：支持圆形、自定义路径等
4. **交互增强**：鼠标悬停时的动态效果
