/**
 * Skia all-sky map canvas: dark dome with the horizon rim, stars sized by
 * magnitude, planets and Moon highlighted, and asterism figure lines.
 * On web this must be imported ONLY after CanvasKit is loaded - the
 * platform split (SkyMap.web.tsx / SkyMap.native.tsx) guarantees that.
 */

import React, { useMemo } from 'react';
import { GestureResponderEvent, StyleSheet, Text as RNText, View } from 'react-native';
import { Canvas, Circle, Line } from '@shopify/react-native-skia';
import { buildSkyMapData, hitTest, type MapPoint, type SkyMapData } from '@/sky/mapData';
import type { SkyContext } from '@/sky/types';

export interface SkyMapProps {
  ctx: SkyContext;
  size: number;
  onPressObject?: (point: MapPoint) => void;
  selectedId?: string | null;
}

export function SkyMapCanvas({ ctx, size, onPressObject, selectedId }: SkyMapProps) {
  const data: SkyMapData = useMemo(() => buildSkyMapData(ctx), [ctx.lat, ctx.lon, ctx.now.getTime()]);

  const R = size / 2;

  const px = (u: number) => u * size;
  const starR = (mag: number | null) => {
    if (mag === null) return 1.5;
    return Math.max(1, 3.2 - mag * 0.55);
  };

  const handleTap = (e: GestureResponderEvent) => {
    const native = e.nativeEvent;
    const x = native.locationX / size;
    const y = native.locationY / size;
    const hit = hitTest(data, x, y);
    if (hit && onPressObject) onPressObject(hit);
  };

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Canvas
        style={{ width: size, height: size }}
        onStartShouldSetResponder={() => true}
        onResponderRelease={handleTap}
      >
        {/* sky dome */}
        <Circle cx={R} cy={R} r={R} color="#0A0F22" />
        {/* horizon rim */}
        <Circle cx={R} cy={R} r={R - 1} style="stroke" strokeWidth={1.5} color="#3A466E" />

        {/* asterism figure lines */}
        {data.lines.map((l, i) => (
          <Line
            key={i}
            p1={{ x: px(l.x1), y: px(l.y1) }}
            p2={{ x: px(l.x2), y: px(l.y2) }}
            color="#39508A"
            style="stroke"
            strokeWidth={1}
          />
        ))}

        {/* stars and objects */}
        {data.points.map((p) => {
          const cx = px(p.x);
          const cy = px(p.y);
          const selected = selectedId === p.id;
          const isBright = (p.mag ?? 99) <= 1.6;
          const color =
            p.kind === 'planet'
              ? '#F2C14E'
              : p.kind === 'moon'
                ? '#E8ECFF'
                : selected
                  ? '#7FD4FF'
                  : isBright
                    ? '#DCE4FF'
                    : '#8D99C4';
          return (
            <Circle
              key={`${p.kind}:${p.id}`}
              cx={cx}
              cy={cy}
              r={p.kind === 'moon' ? 6 : selected ? 5 : starR(p.mag)}
              color={color}
            />
          );
        })}
      </Canvas>

      {/* cardinal labels overlay (crisper than SkText without a font) */}
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
