/**
 * Native/shared entry: Skia works out of the box on iOS/Android - no
 * CanvasKit loading needed. Web overrides this via SkyMap.web.tsx
 * (Metro resolves the .web.tsx platform file first on web).
 */
export { SkyMapCanvas as SkyMap, default } from './SkyMapCanvas';
