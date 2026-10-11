/**
 * Skia all-sky map canvas: dark dome with the horizon rim, stars sized by
 * magnitude, planets and Moon highlighted, and asterism figure lines.
 * On web this must be imported ONLY after CanvasKit is loaded - the
 * platform split (SkyMap.web.tsx / SkyMap.native.tsx) guarantees that.
 *
 * Points are batched into one path per color, so the canvas mounts a
 * handful of draw nodes instead of one React element per star.
 */

import React, { useMemo } from 'react';
import { GestureResponderEvent, StyleSheet, Text as RNText, View } from 'react-native';
import { Canvas, Circle, Path, Skia, type SkPath, type SkPathBuilder } from '@shopify/react-native-skia';
import { buildSkyMapData, hitTest, type MapPoint, type SkyMapData } from '@/sky/mapData';
import type { SkyContext } from '@/sky/types';

export interface SkyMapProps {
  ctx: SkyContext;
  size: number;
  /** Precomputed map for `ctx`; computed here when omitted. */
  data?: SkyMapData;
  onPressObject?: (point: MapPoint) => void;
  selectedId?: string | null;
}

const COLORS = {
  planet: '#F2C14E',
  moon: '#E8ECFF',
  selected: '#7FD4FF',
  bright: '#DCE4FF',
  dim: '#8D99C4',
} as const;

type ColorKey = keyof typeof COLORS;

function starRadius(mag: number | null): number {
  if (mag === null) return 1.5;
  return Math.max(1, 3.2 - mag * 0.55);
}

function colorKey(p: MapPoint, selectedId: string | null | undefined): ColorKey {
  if (p.kind === 'planet') return 'planet';
  if (p.kind === 'moon') return 'moon';
  if (selectedId === p.id) return 'selected';
  return (p.mag ?? 99) <= 1.6 ? 'bright' : 'dim';
}

export function SkyMapCanvas({ ctx, size, data: given, onPressObject, selectedId }: SkyMapProps) {
  const data: SkyMapData = useMemo(
    () => given ?? buildSkyMapData(ctx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [given, ctx.lat, ctx.lon, ctx.now.getTime()],
  );

  const R = size / 2;

  const linePath = useMemo(() => {
    const builder = Skia.PathBuilder.Make();
    for (const l of data.lines) {
      builder.moveTo(l.x1 * size, l.y1 * size);
      builder.lineTo(l.x2 * size, l.y2 * size);
    }
    return builder.detach();
  }, [data, size]);

  const pointPaths = useMemo(() => {
    const builders: Record<ColorKey, SkPathBuilder> = {
      dim: Skia.PathBuilder.Make(),
      bright: Skia.PathBuilder.Make(),
      planet: Skia.PathBuilder.Make(),
      moon: Skia.PathBuilder.Make(),
      selected: Skia.PathBuilder.Make(),
    };
    for (const p of data.points) {
      // Constellation/asterism centers are tap targets, not drawn stars.
      if (p.kind === 'constellation' || p.kind === 'asterism') continue;
      const key = colorKey(p, selectedId);
      const r = p.kind === 'moon' ? 6 : key === 'selected' ? 5 : starRadius(p.mag);
      builders[key].addCircle(p.x * size, p.y * size, r);
    }
    const paths = {} as Record<ColorKey, SkPath>;
    for (const key of Object.keys(builders) as ColorKey[]) paths[key] = builders[key].detach();
    return paths;
  }, [data, size, selectedId]);

  const handleTap = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    const hit = hitTest(data, locationX / size, locationY / size);
    if (hit && onPressObject) onPressObject(hit);
  };

  return (
    <View
      style={[styles.wrap, { width: size, height: size }]}
      onStartShouldSetResponder={() => true}
      onResponderRelease={handleTap}
    >
      <Canvas style={{ width: size, height: size }}>
        <Circle cx={R} cy={R} r={R} color="#0A0F22" />
        <Circle cx={R} cy={R} r={R - 1} style="stroke" strokeWidth={1.5} color="#3A466E" />
        <Path path={linePath} color="#39508A" style="stroke" strokeWidth={1} />
        {(Object.keys(COLORS) as ColorKey[]).map((key) => (
          <Path key={key} path={pointPaths[key]} color={COLORS[key]} />
        ))}
      </Canvas>

      <View style={styles.labelN} pointerEvents="none">
        <RNText style={styles.labelText}>N</RNText>
      </View>
      <View style={styles.labelE} pointerEvents="none">
        <RNText style={styles.labelText}>E</RNText>
      </View>
      <View style={styles.labelS} pointerEvents="none">
        <RNText style={styles.labelText}>S</RNText>
      </View>
      <View style={styles.labelW} pointerEvents="none">
        <RNText style={styles.labelText}>W</RNText>
      </View>
    </View>
  );
}

export default SkyMapCanvas;

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
    justifyContent: 'center',
  },
  labelN: { position: 'absolute', top: 2, alignSelf: 'center' },
  labelS: { position: 'absolute', bottom: 2, alignSelf: 'center' },
  labelE: { position: 'absolute', right: 6, top: '50%' },
  labelW: { position: 'absolute', left: 6, top: '50%' },
  labelText: { color: '#7FD4FF', fontSize: 12, fontWeight: '700' },
});
