/**
 * Web entry: load the CanvasKit WASM (from the CDN version matching the
 * installed canvaskit-wasm) BEFORE importing anything that touches Skia.
 * Without this the package's eager `Skia` initialization sees an unset
 * `CanvasKit` global and every map render crashes.
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
// @ts-ignore - deep web-only path, resolved by Metro on the web platform
import { WithSkiaWeb } from '@shopify/react-native-skia/lib/module/web/WithSkiaWeb';
import type { SkyMapProps } from './SkyMapCanvas';

function Loading({ size }: { size: number }) {
  return (
    <View style={[styles.box, { width: size, height: size }]}>
      <ActivityIndicator color="#7FD4FF" />
    </View>
  );
}

export default function SkyMap(props: SkyMapProps) {
  return (
    <WithSkiaWeb
      getComponent={() => import('./SkyMapCanvas')}
      componentProps={props}
      fallback={<Loading size={props.size} />}
      opts={{
        locateFile: (file: string) =>
          `https://unpkg.com/canvaskit-wasm@0.41.0/bin/full/${file}`,
      }}
    />
  );
}

export { SkyMap };

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
});
